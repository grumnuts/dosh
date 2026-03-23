import type { DatabaseSync } from 'node:sqlite'

export type ConditionField = 'date' | 'account' | 'payee' | 'description' | 'category' | 'amount'
export type ActionField = 'date' | 'account' | 'payee' | 'description' | 'category' | 'amount'
export type Operator = 'is' | 'is_not' | 'contains' | 'starts_with' | 'ends_with'
export type ConditionLogic = 'AND' | 'OR'

export interface RuleCondition {
  field: ConditionField
  operator: Operator
  value: string
}

export interface RuleAction {
  field: ActionField
  value: string
}

export interface LoadedRule {
  id: number
  name: string
  condition_logic: ConditionLogic
  conditions: RuleCondition[]
  actions: RuleAction[]
}

export interface TransactionInput {
  date: string
  accountId: number
  payee: string | null
  description: string | null
  amount: number // integer cents
  categoryId: number | null
}

function getFieldValue(field: ConditionField, tx: TransactionInput): string {
  switch (field) {
    case 'date': return tx.date
    case 'account': return String(tx.accountId)
    case 'payee': return tx.payee ?? ''
    case 'description': return tx.description ?? ''
    case 'category': return tx.categoryId != null ? String(tx.categoryId) : ''
    case 'amount': return String(Math.abs(tx.amount) / 100)
  }
}

function matchCondition(cond: RuleCondition, tx: TransactionInput): boolean {
  const rawValue = getFieldValue(cond.field, tx)

  // Amount: numeric comparison only
  if (cond.field === 'amount') {
    const txAmount = Math.abs(tx.amount) / 100
    const condAmount = parseFloat(cond.value)
    if (isNaN(condAmount)) return false
    switch (cond.operator) {
      case 'is': return Math.abs(txAmount - condAmount) < 0.005
      case 'is_not': return Math.abs(txAmount - condAmount) >= 0.005
      default: return false
    }
  }

  // Account/category: ID equality only
  if (cond.field === 'account' || cond.field === 'category') {
    switch (cond.operator) {
      case 'is': return rawValue === cond.value
      case 'is_not': return rawValue !== cond.value
      default: return false
    }
  }

  // Text fields (date, payee, description): case-insensitive string ops
  const rawLower = rawValue.toLowerCase()
  const condLower = cond.value.toLowerCase()
  if (condLower === '' && cond.operator !== 'is' && cond.operator !== 'is_not') return false

  switch (cond.operator) {
    case 'is': return rawLower === condLower
    case 'is_not': return rawLower !== condLower
    case 'contains': return rawLower.includes(condLower)
    case 'starts_with': return rawLower.startsWith(condLower)
    case 'ends_with': return rawLower.endsWith(condLower)
  }
}

function ruleMatches(rule: LoadedRule, tx: TransactionInput): boolean {
  if (rule.conditions.length === 0) return false
  if (rule.condition_logic === 'AND') {
    return rule.conditions.every((c) => matchCondition(c, tx))
  }
  return rule.conditions.some((c) => matchCondition(c, tx))
}

function applyActions(actions: RuleAction[], tx: TransactionInput): TransactionInput {
  const result = { ...tx }
  for (const action of actions) {
    switch (action.field) {
      case 'date':
        result.date = action.value
        break
      case 'account': {
        const id = parseInt(action.value, 10)
        if (!isNaN(id)) result.accountId = id
        break
      }
      case 'payee':
        result.payee = action.value || null
        break
      case 'description':
        result.description = action.value || null
        break
      case 'category':
        result.categoryId = action.value ? parseInt(action.value, 10) : null
        break
      case 'amount': {
        const parsed = parseFloat(action.value)
        if (!isNaN(parsed)) {
          const sign = tx.amount <= 0 ? -1 : 1
          result.amount = Math.round(parsed * 100) * sign
        }
        break
      }
    }
  }
  return result
}

export function loadEnabledRules(db: DatabaseSync): LoadedRule[] {
  const ruleRows = db
    .prepare(`SELECT id, name, condition_logic FROM rules WHERE is_enabled = 1 ORDER BY sort_order, id`)
    .all() as Array<{ id: number; name: string; condition_logic: string }>

  if (ruleRows.length === 0) return []

  const ids = ruleRows.map((r) => r.id)
  const placeholders = ids.map(() => '?').join(',')

  const condRows = db
    .prepare(
      `SELECT rule_id, field, operator, value FROM rule_conditions WHERE rule_id IN (${placeholders}) ORDER BY id`,
    )
    .all(...ids) as Array<{ rule_id: number; field: string; operator: string; value: string }>

  const actionRows = db
    .prepare(
      `SELECT rule_id, field, value FROM rule_actions WHERE rule_id IN (${placeholders}) ORDER BY id`,
    )
    .all(...ids) as Array<{ rule_id: number; field: string; value: string }>

  const condsByRule = new Map<number, RuleCondition[]>()
  for (const c of condRows) {
    const arr = condsByRule.get(c.rule_id) ?? []
    arr.push({ field: c.field as ConditionField, operator: c.operator as Operator, value: c.value })
    condsByRule.set(c.rule_id, arr)
  }

  const actionsByRule = new Map<number, RuleAction[]>()
  for (const a of actionRows) {
    const arr = actionsByRule.get(a.rule_id) ?? []
    arr.push({ field: a.field as ActionField, value: a.value })
    actionsByRule.set(a.rule_id, arr)
  }

  return ruleRows.map((r) => ({
    id: r.id,
    name: r.name,
    condition_logic: r.condition_logic as ConditionLogic,
    conditions: condsByRule.get(r.id) ?? [],
    actions: actionsByRule.get(r.id) ?? [],
  }))
}

export function applyRules(tx: TransactionInput, db: DatabaseSync): TransactionInput {
  const rules = loadEnabledRules(db)
  let result = { ...tx }
  for (const rule of rules) {
    if (ruleMatches(rule, result)) {
      result = applyActions(rule.actions, result)
    }
  }
  return result
}

export function runSingleRule(ruleId: number, db: DatabaseSync): number {
  const ruleRow = db
    .prepare(`SELECT id, name, condition_logic FROM rules WHERE id = ? AND is_enabled = 1`)
    .get(ruleId) as { id: number; name: string; condition_logic: string } | undefined

  if (!ruleRow) return 0

  const conditions = db
    .prepare(`SELECT field, operator, value FROM rule_conditions WHERE rule_id = ? ORDER BY id`)
    .all(ruleId) as unknown as RuleCondition[]

  const actions = db
    .prepare(`SELECT field, value FROM rule_actions WHERE rule_id = ? ORDER BY id`)
    .all(ruleId) as unknown as RuleAction[]

  const rule: LoadedRule = {
    id: ruleRow.id,
    name: ruleRow.name,
    condition_logic: ruleRow.condition_logic as ConditionLogic,
    conditions,
    actions,
  }

  return runRulesOnAllTransactions(db, [rule])
}

export function runRulesOnAllTransactions(db: DatabaseSync, rules?: LoadedRule[]): number {
  const rulesToRun = rules ?? loadEnabledRules(db)
  if (rulesToRun.length === 0) return 0

  const txRows = db
    .prepare(
      `SELECT id, date, account_id, payee, description, amount, category_id
       FROM transactions WHERE type = 'transaction'`,
    )
    .all() as Array<{
    id: number
    date: string
    account_id: number
    payee: string | null
    description: string | null
    amount: number
    category_id: number | null
  }>

  const now = new Date().toISOString()
  const updateStmt = db.prepare(
    `UPDATE transactions
     SET date = ?, account_id = ?, payee = ?, description = ?, amount = ?, category_id = ?, updated_at = ?
     WHERE id = ?`,
  )

  let updatedCount = 0

  db.exec('BEGIN TRANSACTION')
  try {
    for (const tx of txRows) {
      const input: TransactionInput = {
        date: tx.date,
        accountId: tx.account_id,
        payee: tx.payee,
        description: tx.description,
        amount: tx.amount,
        categoryId: tx.category_id,
      }

      let result = { ...input }
      for (const rule of rulesToRun) {
        if (ruleMatches(rule, result)) {
          result = applyActions(rule.actions, result)
        }
      }

      const changed =
        result.date !== input.date ||
        result.accountId !== input.accountId ||
        result.payee !== input.payee ||
        result.description !== input.description ||
        result.amount !== input.amount ||
        result.categoryId !== input.categoryId

      if (changed) {
        updateStmt.run(
          result.date,
          result.accountId,
          result.payee,
          result.description,
          result.amount,
          result.categoryId,
          now,
          tx.id,
        )
        updatedCount++
      }
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return updatedCount
}

// ─── Conflict detection ───────────────────────────────────────────────────────

function conditionsCouldOverlap(
  conds1: RuleCondition[],
  logic1: ConditionLogic,
  conds2: RuleCondition[],
  logic2: ConditionLogic,
): boolean {
  // Rules are mutually exclusive (can never match the same transaction) when both
  // use AND logic and share a pair of conditions on the same field that cannot
  // both be satisfied simultaneously.
  if (logic1 === 'AND' && logic2 === 'AND') {
    for (const c1 of conds1) {
      for (const c2 of conds2) {
        if (c1.field !== c2.field) continue
        const v1 = c1.value.toLowerCase()
        const v2 = c2.value.toLowerCase()

        // field is X vs field is Y (different exact values)
        if (c1.operator === 'is' && c2.operator === 'is' && v1 !== v2) return false

        // field contains X vs field contains Y — mutually exclusive when neither
        // value is a substring of the other (no real string can contain both)
        if (c1.operator === 'contains' && c2.operator === 'contains' && v1 !== v2 && !v1.includes(v2) && !v2.includes(v1)) return false

        // field starts_with X vs field starts_with Y — mutually exclusive when
        // neither prefix starts with the other
        if (c1.operator === 'starts_with' && c2.operator === 'starts_with' && v1 !== v2 && !v1.startsWith(v2) && !v2.startsWith(v1)) return false

        // field ends_with X vs field ends_with Y — mutually exclusive when
        // neither suffix ends with the other
        if (c1.operator === 'ends_with' && c2.operator === 'ends_with' && v1 !== v2 && !v1.endsWith(v2) && !v2.endsWith(v1)) return false
      }
    }
  }
  return true
}

export function checkConflict(
  ruleId: number | null,
  conditions: RuleCondition[],
  logic: ConditionLogic,
  actionFields: string[],
  db: DatabaseSync,
): { id: number; name: string } | null {
  if (actionFields.length === 0 || conditions.length === 0) return null

  const actionFieldSet = new Set(actionFields)

  const whereClause = ruleId != null ? 'WHERE r.id != ?' : ''
  const params: number[] = ruleId != null ? [ruleId] : []

  const otherRules = db
    .prepare(`SELECT r.id, r.name, r.condition_logic FROM rules r ${whereClause} ORDER BY r.id`)
    .all(...params) as Array<{ id: number; name: string; condition_logic: string }>

  for (const other of otherRules) {
    const otherConds = db
      .prepare(`SELECT field, operator, value FROM rule_conditions WHERE rule_id = ?`)
      .all(other.id) as unknown as RuleCondition[]

    const otherActionFields = db
      .prepare(`SELECT field FROM rule_actions WHERE rule_id = ?`)
      .all(other.id) as Array<{ field: string }>

    const actionOverlap = otherActionFields.some((a) => actionFieldSet.has(a.field))
    if (!actionOverlap) continue

    if (conditionsCouldOverlap(conditions, logic, otherConds, other.condition_logic as ConditionLogic)) {
      return { id: other.id, name: other.name }
    }
  }

  return null
}

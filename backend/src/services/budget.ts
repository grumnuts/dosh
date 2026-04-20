import { getDb } from '../db/client'
import { getPeriodBoundaries, weeklyEquivalent, parseDate, toDateString, getWeekStart, currentWeekStart } from '../utils/dates'

function getWeekStartsOn(): 0 | 1 {
  const db = getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('week_start_day') as { value: string } | undefined
  return row?.value === '1' ? 1 : 0
}

/**
 * Compute the first and last actual budget week-starts for an annual period.
 * The first week is the week containing Jan 1 (may start in Dec of the previous year).
 * The last week is the latest week-start whose 7-day span doesn't extend past Dec 31.
 */
function getAnnualWeekRange(year: number, weekStartsOn: 0 | 1): { firstWeekMs: number; lastWeekMs: number; totalWeeks: number } {
  const msPerDay = 86400000
  const msPerWeek = 7 * msPerDay

  const jan1Ms = Date.UTC(year, 0, 1)
  const dec31Ms = Date.UTC(year, 11, 31)

  // First week: the week-start of the week containing Jan 1
  const firstWeekMs = getWeekStart(new Date(jan1Ms), weekStartsOn).getTime()

  // Last week: latest week-start where weekStart + 6 <= Dec 31
  const lastSafeMs = dec31Ms - 6 * msPerDay
  const lastWeek = getWeekStart(new Date(lastSafeMs), weekStartsOn)
  let lastWeekMs = lastWeek.getTime()
  if (lastWeekMs > lastSafeMs) lastWeekMs -= msPerWeek

  const totalWeeks = Math.floor((lastWeekMs - firstWeekMs) / msPerWeek) + 1

  return { firstWeekMs, lastWeekMs, totalWeeks }
}

/**
 * Catch-up weekly equivalent: divides the current budget evenly from the latest
 * budget change to the end of the period, giving a flat rate per week.
 *
 * If no budget change occurred within the current period, falls back to the
 * standard static rate.
 */
function catchUpWeeklyEquivalent(
  categoryId: number,
  budgetedAmount: number,
  period: string,
  weekStart: string,
): number {
  if (period === 'weekly') return budgetedAmount

  const db = getDb()
  const weekStartsOn = getWeekStartsOn()

  const msPerDay = 86400000
  const msPerWeek = 7 * msPerDay
  const currentWeekMs = parseDate(weekStart).getTime()

  // Determine the period boundaries. For annual periods, the transition week
  // (straddles Dec/Jan) uses the new year so the calc resets to static.
  let periodStart: string
  let periodEnd: string
  if (period === 'annually') {
    const weekEndYear = new Date(currentWeekMs + 6 * msPerDay).getUTCFullYear()
    const weekStartYear = parseDate(weekStart).getUTCFullYear()
    const year = weekEndYear > weekStartYear ? weekEndYear : weekStartYear
    periodStart = `${year}-01-01`
    periodEnd = `${year}-12-31`
  } else {
    const bounds = getPeriodBoundaries(weekStart, period, weekStartsOn)
    periodStart = bounds.start
    periodEnd = bounds.end
  }

  // Find the most recent budget change at or before this week
  const latestChange = db
    .prepare(
      `SELECT effective_from FROM budget_history
       WHERE category_id = ? AND effective_from <= ?
       ORDER BY effective_from DESC LIMIT 1`,
    )
    .get(categoryId, weekStart) as { effective_from: string } | undefined

  // If no history, or the latest change predates this period, use the static rate
  if (!latestChange || latestChange.effective_from < periodStart) {
    if (period === 'annually') {
      const year = parseInt(periodStart.slice(0, 4))
      const { totalWeeks } = getAnnualWeekRange(year, weekStartsOn)
      return Math.ceil(budgetedAmount / totalWeeks)
    }
    return weeklyEquivalent(budgetedAmount, period)
  }

  // Budget was changed within this period — divide evenly from the change point
  // to the end of the period, giving a flat weekly rate for this segment.
  const changeWeekMs = parseDate(latestChange.effective_from).getTime()

  let weeksFromChange: number
  if (period === 'annually') {
    const year = parseInt(periodStart.slice(0, 4))
    const { lastWeekMs } = getAnnualWeekRange(year, weekStartsOn)
    weeksFromChange = Math.floor((lastWeekMs - changeWeekMs) / msPerWeek) + 1
  } else {
    const pEndMs = parseDate(periodEnd).getTime()
    weeksFromChange = Math.ceil((pEndMs - changeWeekMs + msPerDay) / msPerWeek)
  }

  if (weeksFromChange <= 0) return weeklyEquivalent(budgetedAmount, period)
  return Math.ceil(budgetedAmount / weeksFromChange)
}

interface RawCategory {
  id: number
  group_id: number
  name: string
  budgeted_amount: number
  period: string
  notes: string | null
  sort_order: number
  catch_up: number
  is_investment: number
  linked_account_id: number | null
  ticker: string | null
}

interface RawGroup {
  id: number
  name: string
  sort_order: number
  is_income: number
  is_debt: number
  is_savings: number
  is_investments: number
}

interface BudgetCategory {
  id: number
  name: string
  period: string
  budgetedAmount: number
  weeklyEquivalent: number
  spent: number
  covers: number
  sweeps: number
  rolledIn: number
  rolledOut: number
  rolloverIdOut: number | null
  balance: number
  isOverspent: boolean
  notes: string | null
  sortOrder: number
  catchUp: boolean
  isInvestment: boolean
}

interface IncomeCategory {
  id: number
  name: string
  period: string
  received: number
  notes: string | null
  sortOrder: number
}

interface BudgetGroup {
  id: number
  name: string
  sortOrder: number
  categories: BudgetCategory[]
}

interface IncomeGroup {
  id: number
  name: string
  sortOrder: number
  categories: IncomeCategory[]
}

interface DebtCategory {
  id: number
  name: string
  period: string
  budgetedAmount: number
  weeklyEquivalent: number
  spent: number
  balance: number
  linkedAccountId: number
  linkedAccountBalance: number
  notes: string | null
  sortOrder: number
  catchUp: boolean
}

interface DebtGroup {
  id: number
  name: string
  sortOrder: number
  categories: DebtCategory[]
}

interface SavingsCategory {
  id: number
  name: string
  period: string
  budgetedAmount: number
  weeklyEquivalent: number
  contributed: number
  balance: number
  linkedAccountId: number
  linkedAccountBalance: number
  notes: string | null
  sortOrder: number
  catchUp: boolean
}

interface SavingsGroup {
  id: number
  name: string
  sortOrder: number
  categories: SavingsCategory[]
}

interface InvestmentCategory {
  id: number
  name: string
  ticker: string
  period: string
  budgetedAmount: number
  weeklyEquivalent: number
  spent: number
  balance: number
  isOverspent: boolean
  notes: string | null
  sortOrder: number
  catchUp: boolean
}

interface InvestmentGroup {
  id: number
  name: string
  sortOrder: number
  categories: InvestmentCategory[]
}

interface BudgetWeekData {
  weekStart: string
  groups: BudgetGroup[]
  incomeGroups: IncomeGroup[]
  debtGroups: DebtGroup[]
  savingsGroups: SavingsGroup[]
  investmentGroups: InvestmentGroup[]
  totalWeeklyBudget: number
  totalIncome: number
  totalDebt: number
  unallocated: number
}

/**
 * Get the historically effective budget amount for a category at a given week.
 */
export function getEffectiveBudget(
  categoryId: number,
  weekStart: string,
): { budgetedAmount: number; period: string } {
  const db = getDb()

  const history = db
    .prepare(
      `SELECT budgeted_amount, period FROM budget_history
       WHERE category_id = ? AND effective_from <= ?
       ORDER BY effective_from DESC LIMIT 1`,
    )
    .get(categoryId, weekStart) as { budgeted_amount: number; period: string } | undefined

  if (history) {
    return { budgetedAmount: history.budgeted_amount, period: history.period }
  }

  const cat = db
    .prepare('SELECT budgeted_amount, period FROM budget_categories WHERE id = ?')
    .get(categoryId) as { budgeted_amount: number; period: string } | undefined

  return {
    budgetedAmount: cat?.budgeted_amount ?? 0,
    period: cat?.period ?? 'weekly',
  }
}

/**
 * Calculate the full budget for a given week (Sunday YYYY-MM-DD).
 */
export function getBudgetWeek(weekStart: string): BudgetWeekData {
  const db = getDb()
  const weekStartsOn = getWeekStartsOn()

  const allGroups = db
    .prepare(
      `SELECT id, name, sort_order, is_income, is_debt, is_savings, is_investments FROM budget_groups WHERE is_active = 1 ORDER BY sort_order, name`,
    )
    .all() as unknown as RawGroup[]

  const categories = db
    .prepare(
      `SELECT id, group_id, name, budgeted_amount, period, notes, sort_order, catch_up, is_investment, linked_account_id, ticker
       FROM budget_categories WHERE is_active = 1 AND is_unlisted = 0 ORDER BY sort_order, name`,
    )
    .all() as unknown as RawCategory[]

  const regularGroups = allGroups.filter((g) => g.is_income === 0 && g.is_debt === 0 && g.is_savings === 0 && g.is_investments === 0)
  const incomeGroupsRaw = allGroups.filter((g) => g.is_income === 1)
  const debtGroupsRaw = allGroups.filter((g) => g.is_debt === 1)
  const savingsGroupsRaw = allGroups.filter((g) => g.is_savings === 1)
  const investmentGroupsRaw = allGroups.filter((g) => g.is_investments === 1)

  // --- Batch: resolve effective budgets and period boundaries for all categories ---

  // Fetch all history records at once: latest per category at or before this week
  const allCategoryIds = categories.map((c) => c.id)
  const catPlaceholders = allCategoryIds.length > 0 ? allCategoryIds.map(() => '?').join(',') : 'NULL'

  const historyRows = allCategoryIds.length > 0
    ? (db
        .prepare(
          `SELECT bh.category_id, bh.budgeted_amount, bh.period
           FROM budget_history bh
           INNER JOIN (
             SELECT category_id, MAX(effective_from) AS max_ef
             FROM budget_history
             WHERE category_id IN (${catPlaceholders}) AND effective_from <= ?
             GROUP BY category_id
           ) latest ON bh.category_id = latest.category_id AND bh.effective_from = latest.max_ef`,
        )
        .all(...allCategoryIds, weekStart) as Array<{ category_id: number; budgeted_amount: number; period: string }>)
    : []

  const effectiveBudgetMap = new Map<number, { budgetedAmount: number; period: string }>()
  for (const h of historyRows) {
    effectiveBudgetMap.set(h.category_id, { budgetedAmount: h.budgeted_amount, period: h.period })
  }
  // For categories with no history, fall back to current values
  for (const cat of categories) {
    if (!effectiveBudgetMap.has(cat.id)) {
      effectiveBudgetMap.set(cat.id, { budgetedAmount: cat.budgeted_amount, period: cat.period })
    }
  }

  // Compute period boundaries once per category
  const boundsMap = new Map<number, { start: string; end: string }>()
  for (const cat of categories) {
    const { period } = effectiveBudgetMap.get(cat.id)!
    boundsMap.set(cat.id, getPeriodBoundaries(weekStart, period, weekStartsOn))
  }

  // --- Batch: fetch spent amounts grouped by category across all distinct period ranges ---
  // Categories may share the same period boundary, so group them to avoid duplicate queries.
  // Key: "start|end" -> category IDs that share this range
  const spentByPeriodKey = new Map<string, { start: string; end: string; ids: number[] }>()
  for (const cat of categories) {
    const bounds = boundsMap.get(cat.id)!
    const key = `${bounds.start}|${bounds.end}`
    const existing = spentByPeriodKey.get(key)
    if (existing) {
      existing.ids.push(cat.id)
    } else {
      spentByPeriodKey.set(key, { start: bounds.start, end: bounds.end, ids: [cat.id] })
    }
  }

  // --- Batch: fetch covers grouped by period (covers persist for the full category period, not just the week they were created) ---
  const coversMap = new Map<number, number>()
  for (const { start, end, ids } of spentByPeriodKey.values()) {
    const ph = ids.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT category_id, COALESCE(SUM(amount), 0) AS total
         FROM transactions
         WHERE category_id IN (${ph}) AND cover_week_start >= ? AND cover_week_start <= ?
           AND type = 'cover' AND amount > 0
         GROUP BY category_id`,
      )
      .all(...ids, start, end) as Array<{ category_id: number; total: number }>
    for (const r of rows) coversMap.set(r.category_id, r.total)
  }

  // --- Batch: fetch sweeps (unspent money swept out to savings) ---
  const sweepsMap = new Map<number, number>()
  for (const { start, end, ids } of spentByPeriodKey.values()) {
    const ph = ids.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT category_id, COALESCE(-SUM(amount), 0) AS total
         FROM transactions
         WHERE category_id IN (${ph}) AND cover_week_start >= ? AND cover_week_start <= ?
           AND type = 'sweep' AND amount < 0
         GROUP BY category_id`,
      )
      .all(...ids, start, end) as Array<{ category_id: number; total: number }>
    for (const r of rows) sweepsMap.set(r.category_id, r.total)
  }

  // --- Batch: fetch rollovers (balance rolled forward from/to this period) ---
  const rolledInMap = new Map<number, number>()
  const rolledOutMap = new Map<number, number>()
  const rolloverIdOutMap = new Map<number, number>()
  for (const { start, end, ids } of spentByPeriodKey.values()) {
    const ph = ids.map(() => '?').join(',')
    const inRows = db
      .prepare(
        `SELECT category_id, COALESCE(SUM(amount), 0) AS total
         FROM budget_rollovers
         WHERE category_id IN (${ph}) AND dest_period_start >= ? AND dest_period_start <= ?
         GROUP BY category_id`,
      )
      .all(...ids, start, end) as Array<{ category_id: number; total: number }>
    for (const r of inRows) rolledInMap.set(r.category_id, r.total)

    const outRows = db
      .prepare(
        `SELECT category_id, COALESCE(SUM(amount), 0) AS total, MIN(id) AS rollover_id
         FROM budget_rollovers
         WHERE category_id IN (${ph}) AND source_week_start >= ? AND source_week_start <= ?
         GROUP BY category_id`,
      )
      .all(...ids, start, end) as Array<{ category_id: number; total: number; rollover_id: number }>
    for (const r of outRows) {
      rolledOutMap.set(r.category_id, r.total)
      rolloverIdOutMap.set(r.category_id, r.rollover_id)
    }
  }

  const spentMap = new Map<number, number>()
  for (const { start, end, ids } of spentByPeriodKey.values()) {
    const ph = ids.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT category_id, -COALESCE(SUM(total), 0) AS spent FROM (
           SELECT t.category_id, t.amount AS total FROM transactions t
           WHERE t.category_id IN (${ph}) AND t.date >= ? AND t.date <= ?
             AND t.type = 'transaction'
           UNION ALL
           SELECT ts.category_id, ts.amount AS total FROM transaction_splits ts
           JOIN transactions t ON t.id = ts.transaction_id
           WHERE ts.category_id IN (${ph}) AND t.date >= ? AND t.date <= ?
             AND t.type = 'transaction'
         )
         GROUP BY category_id`,
      )
      .all(...ids, start, end, ...ids, start, end) as Array<{ category_id: number; spent: number }>
    for (const r of rows) spentMap.set(r.category_id, r.spent)
  }

  // --- Batch: fetch received amounts for income categories ---
  const incomeCatIds = categories.filter((c) => incomeGroupsRaw.some((g) => g.id === c.group_id)).map((c) => c.id)
  const receivedMap = new Map<number, number>()
  if (incomeCatIds.length > 0) {
    const incomeBoundsGroups = new Map<string, { start: string; end: string; ids: number[] }>()
    for (const id of incomeCatIds) {
      const bounds = boundsMap.get(id)!
      const key = `${bounds.start}|${bounds.end}`
      const existing = incomeBoundsGroups.get(key)
      if (existing) { existing.ids.push(id) } else { incomeBoundsGroups.set(key, { start: bounds.start, end: bounds.end, ids: [id] }) }
    }
    for (const { start, end, ids } of incomeBoundsGroups.values()) {
      const ph = ids.map(() => '?').join(',')
      const rows = db
        .prepare(
          `SELECT category_id, COALESCE(SUM(total), 0) AS received FROM (
             SELECT t.category_id, t.amount AS total FROM transactions t
             WHERE t.category_id IN (${ph}) AND t.date >= ? AND t.date <= ?
               AND t.type = 'transaction' AND t.amount > 0
             UNION ALL
             SELECT ts.category_id, ts.amount AS total FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE ts.category_id IN (${ph}) AND t.date >= ? AND t.date <= ?
               AND t.type = 'transaction' AND ts.amount > 0
           )
           GROUP BY category_id`,
        )
        .all(...ids, start, end, ...ids, start, end) as Array<{ category_id: number; received: number }>
      for (const r of rows) receivedMap.set(r.category_id, r.received)
    }
  }

  let totalWeeklyBudget = 0

  // Build regular expense groups
  const groups: BudgetGroup[] = regularGroups.map((group) => {
    const groupCats = categories.filter((c) => c.group_id === group.id)

    const builtCats: BudgetCategory[] = groupCats.map((cat) => {
      const { budgetedAmount, period } = effectiveBudgetMap.get(cat.id)!
      const spent = spentMap.get(cat.id) ?? 0
      const covers = coversMap.get(cat.id) ?? 0
      const sweeps = sweepsMap.get(cat.id) ?? 0
      const rolledIn = rolledInMap.get(cat.id) ?? 0
      const rolledOut = rolledOutMap.get(cat.id) ?? 0
      const rolloverIdOut = rolloverIdOutMap.get(cat.id) ?? null
      const balance = budgetedAmount - spent + covers - sweeps + rolledIn - rolledOut
      const weekly = cat.catch_up
        ? catchUpWeeklyEquivalent(cat.id, budgetedAmount, period, weekStart)
        : weeklyEquivalent(budgetedAmount, period)
      totalWeeklyBudget += weekly

      return {
        id: cat.id,
        name: cat.name,
        period,
        budgetedAmount,
        weeklyEquivalent: weekly,
        spent,
        covers,
        sweeps,
        rolledIn,
        rolledOut,
        rolloverIdOut,
        balance,
        isOverspent: balance < 0,
        notes: cat.notes,
        sortOrder: cat.sort_order,
        catchUp: cat.catch_up === 1,
        isInvestment: cat.is_investment === 1,
      }
    })

    return {
      id: group.id,
      name: group.name,
      sortOrder: group.sort_order,
      categories: builtCats,
    }
  })

  // Build income groups — received = sum of positive transactions in the category's period
  const incomeGroups: IncomeGroup[] = incomeGroupsRaw.map((group) => {
    const groupCats = categories.filter((c) => c.group_id === group.id)

    const builtCats: IncomeCategory[] = groupCats.map((cat) => ({
      id: cat.id,
      name: cat.name,
      period: cat.period,
      received: receivedMap.get(cat.id) ?? 0,
      notes: cat.notes,
      sortOrder: cat.sort_order,
    }))

    return {
      id: group.id,
      name: group.name,
      sortOrder: group.sort_order,
      categories: builtCats,
    }
  })

  const totalIncome = incomeGroups.reduce(
    (sum, g) => sum + g.categories.reduce((s, c) => s + c.received, 0),
    0,
  )

  // Build debt + savings groups — categories linked to accounts
  // Compute debt account balances (includes categorized payments from other accounts)
  const debtCats = categories.filter((c) => c.linked_account_id !== null && debtGroupsRaw.some((g) => g.id === c.group_id))
  const debtLinkedIds = [...new Set(debtCats.map((c) => c.linked_account_id as number))]

  const debtBalanceMap = new Map<number, number>()
  if (debtLinkedIds.length > 0) {
    const ph = debtLinkedIds.map(() => '?').join(',')
    const balanceRows = db
      .prepare(
        `SELECT a.id,
                a.starting_balance + COALESCE(SUM(t.amount), 0) +
                COALESCE((
                  SELECT -SUM(pt.amount)
                  FROM transactions pt
                  JOIN budget_categories bc ON pt.category_id = bc.id
                  WHERE bc.linked_account_id = a.id AND pt.account_id != a.id
                    AND pt.type = 'transaction' AND pt.amount < 0
                ), 0) +
                COALESCE((
                  SELECT -SUM(ts.amount)
                  FROM transaction_splits ts
                  JOIN transactions pt ON ts.transaction_id = pt.id
                  JOIN budget_categories bc ON ts.category_id = bc.id
                  WHERE bc.linked_account_id = a.id AND pt.account_id != a.id
                    AND pt.type = 'transaction' AND ts.amount < 0
                ), 0) AS balance
         FROM accounts a
         LEFT JOIN transactions t ON t.account_id = a.id
         WHERE a.id IN (${ph})
         GROUP BY a.id`,
      )
      .all(...debtLinkedIds) as Array<{ id: number; balance: number }>
    for (const r of balanceRows) debtBalanceMap.set(r.id, r.balance)
  }

  // Compute savings account balances (simple: starting_balance + SUM(transactions))
  const savingsCats = categories.filter((c) => c.linked_account_id !== null && savingsGroupsRaw.some((g) => g.id === c.group_id))
  const savingsLinkedIds = [...new Set(savingsCats.map((c) => c.linked_account_id as number))]

  const savingsBalanceMap = new Map<number, number>()
  const closedSavingsAccountIds = new Set<number>()
  if (savingsLinkedIds.length > 0) {
    const ph = savingsLinkedIds.map(() => '?').join(',')
    const balanceRows = db
      .prepare(
        `SELECT a.id, a.closed_at, a.starting_balance + COALESCE(SUM(t.amount), 0) AS balance
         FROM accounts a
         LEFT JOIN transactions t ON t.account_id = a.id
         WHERE a.id IN (${ph})
         GROUP BY a.id`,
      )
      .all(...savingsLinkedIds) as Array<{ id: number; closed_at: string | null; balance: number }>
    for (const r of balanceRows) {
      if (r.closed_at !== null) {
        closedSavingsAccountIds.add(r.id)
      } else {
        savingsBalanceMap.set(r.id, r.balance)
      }
    }
  }

  const debtGroups: DebtGroup[] = debtGroupsRaw.map((group) => {
    const groupCats = categories.filter((c) => c.group_id === group.id && c.linked_account_id !== null)

    const builtCats: DebtCategory[] = groupCats.map((cat) => {
      const { budgetedAmount, period } = effectiveBudgetMap.get(cat.id)!
      const spent = spentMap.get(cat.id) ?? 0
      const balance = budgetedAmount - spent
      const weekly = cat.catch_up
        ? catchUpWeeklyEquivalent(cat.id, budgetedAmount, period, weekStart)
        : weeklyEquivalent(budgetedAmount, period)
      totalWeeklyBudget += weekly

      return {
        id: cat.id,
        name: cat.name,
        period,
        budgetedAmount,
        weeklyEquivalent: weekly,
        spent,
        balance,
        linkedAccountId: cat.linked_account_id as number,
        linkedAccountBalance: debtBalanceMap.get(cat.linked_account_id as number) ?? 0,
        notes: cat.notes,
        sortOrder: cat.sort_order,
        catchUp: cat.catch_up === 1,
      }
    })

    return {
      id: group.id,
      name: group.name,
      sortOrder: group.sort_order,
      categories: builtCats,
    }
  })

  // Build savings groups — each category is linked to a savings account (exclude closed accounts)
  const savingsGroups: SavingsGroup[] = savingsGroupsRaw.map((group) => {
    const groupCats = categories.filter((c) => c.group_id === group.id && c.linked_account_id !== null && !closedSavingsAccountIds.has(c.linked_account_id as number))

    const builtCats: SavingsCategory[] = groupCats.map((cat) => {
      const { budgetedAmount, period } = effectiveBudgetMap.get(cat.id)!
      const contributed = spentMap.get(cat.id) ?? 0
      const balance = budgetedAmount - contributed
      const weekly = cat.catch_up
        ? catchUpWeeklyEquivalent(cat.id, budgetedAmount, period, weekStart)
        : weeklyEquivalent(budgetedAmount, period)
      totalWeeklyBudget += weekly

      return {
        id: cat.id,
        name: cat.name,
        period,
        budgetedAmount,
        weeklyEquivalent: weekly,
        contributed,
        balance,
        linkedAccountId: cat.linked_account_id as number,
        linkedAccountBalance: savingsBalanceMap.get(cat.linked_account_id as number) ?? 0,
        notes: cat.notes,
        sortOrder: cat.sort_order,
        catchUp: cat.catch_up === 1,
      }
    })

    return {
      id: group.id,
      name: group.name,
      sortOrder: group.sort_order,
      categories: builtCats,
    }
  })

  // Build investment groups — user-added categories with tickers
  const investmentGroups: InvestmentGroup[] = investmentGroupsRaw.map((group) => {
    const groupCats = categories.filter((c) => c.group_id === group.id && c.ticker !== null)

    const builtCats: InvestmentCategory[] = groupCats.map((cat) => {
      const { budgetedAmount, period } = effectiveBudgetMap.get(cat.id)!
      const spent = spentMap.get(cat.id) ?? 0
      const balance = budgetedAmount - spent
      const weekly = cat.catch_up
        ? catchUpWeeklyEquivalent(cat.id, budgetedAmount, period, weekStart)
        : weeklyEquivalent(budgetedAmount, period)
      totalWeeklyBudget += weekly

      return {
        id: cat.id,
        name: cat.name,
        ticker: cat.ticker as string,
        period,
        budgetedAmount,
        weeklyEquivalent: weekly,
        spent,
        balance,
        isOverspent: balance < 0,
        notes: cat.notes,
        sortOrder: cat.sort_order,
        catchUp: cat.catch_up === 1,
      }
    })

    return {
      id: group.id,
      name: group.name,
      sortOrder: group.sort_order,
      categories: builtCats,
    }
  })

  const totalDebt = debtGroups.reduce(
    (sum, g) => sum + g.categories.reduce((s, c) => s + c.linkedAccountBalance, 0),
    0,
  )
  const unallocated = totalIncome - totalWeeklyBudget

  return {
    weekStart,
    groups,
    incomeGroups,
    debtGroups,
    savingsGroups,
    investmentGroups,
    totalWeeklyBudget,
    totalIncome,
    totalDebt,
    unallocated,
  }
}

/**
 * Calculate the net balance for a category in a given week's period.
 * Returns positive value when there is unspent budget, negative when overspent.
 */
export function getCategoryBalance(categoryId: number, weekStart: string): number {
  const { budgetedAmount, period } = getEffectiveBudget(categoryId, weekStart)
  const bounds = getPeriodBoundaries(weekStart, period, getWeekStartsOn())
  const db = getDb()

  const spentRow = db
    .prepare(
      `SELECT -COALESCE(SUM(total), 0) as spent FROM (
         SELECT t.amount as total FROM transactions t
         WHERE t.category_id = ? AND t.date >= ? AND t.date <= ?
           AND t.type = 'transaction'
         UNION ALL
         SELECT ts.amount as total FROM transaction_splits ts
         JOIN transactions t ON t.id = ts.transaction_id
         WHERE ts.category_id = ? AND t.date >= ? AND t.date <= ?
           AND t.type = 'transaction'
       )`,
    )
    .get(categoryId, bounds.start, bounds.end, categoryId, bounds.start, bounds.end) as { spent: number }

  const coversRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE category_id = ? AND cover_week_start >= ? AND cover_week_start <= ?
         AND type = 'cover' AND amount > 0`,
    )
    .get(categoryId, bounds.start, bounds.end) as { total: number }

  const sweepsRow = db
    .prepare(
      `SELECT COALESCE(-SUM(amount), 0) as total
       FROM transactions
       WHERE category_id = ? AND cover_week_start >= ? AND cover_week_start <= ?
         AND type = 'sweep' AND amount < 0`,
    )
    .get(categoryId, bounds.start, bounds.end) as { total: number }

  const rolledInRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM budget_rollovers
       WHERE category_id = ? AND dest_period_start >= ? AND dest_period_start <= ?`,
    )
    .get(categoryId, bounds.start, bounds.end) as { total: number }

  const rolledOutRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM budget_rollovers
       WHERE category_id = ? AND source_week_start >= ? AND source_week_start <= ?`,
    )
    .get(categoryId, bounds.start, bounds.end) as { total: number }

  return budgetedAmount - spentRow.spent + coversRow.total - sweepsRow.total + rolledInRow.total - rolledOutRow.total
}

/**
 * Calculate the current overspend amount for a category in a given week.
 */
export function getCategoryOverspendAmount(categoryId: number, weekStart: string): number {
  const balance = getCategoryBalance(categoryId, weekStart)
  return balance < 0 ? Math.abs(balance) : 0
}

/**
 * Returns the first calendar day of the period that immediately follows the given week's period.
 * This is stored as dest_period_start in budget_rollovers.
 */
export function getNextPeriodStart(weekStart: string, period: string): string {
  const weekStartsOn = getWeekStartsOn()
  const bounds = getPeriodBoundaries(weekStart, period, weekStartsOn)
  // Day after the current period ends = first day of next period
  const endDate = parseDate(bounds.end)
  const nextDay = new Date(endDate.getTime() + 86400000)
  return toDateString(nextDay)
}

/**
 * Record a budget amount change, creating a history entry effective from the current week.
 */
export function recordBudgetChange(
  categoryId: number,
  newAmount: number,
  newPeriod: string,
  userId: number,
  effectiveFrom?: string,
): void {
  const db = getDb()
  const weekStart = effectiveFrom ?? currentWeekStart(getWeekStartsOn())
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO budget_history (category_id, budgeted_amount, period, effective_from, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(categoryId, newAmount, newPeriod, weekStart, now, userId)
}

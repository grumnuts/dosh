import { getDb } from '../db/client'
import { getPeriodBoundaries, weeklyEquivalent, toDateString, getWeekStart } from '../utils/dates'

function getWeekStartsOn(): 0 | 1 {
  const db = getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('week_start_day') as { value: string } | undefined
  return row?.value === '1' ? 1 : 0
}

interface RawCategory {
  id: number
  group_id: number
  name: string
  budgeted_amount: number
  period: string
  notes: string | null
  sort_order: number
}

interface RawGroup {
  id: number
  name: string
  sort_order: number
  is_income: number
}

interface BudgetCategory {
  id: number
  name: string
  period: string
  budgetedAmount: number
  weeklyEquivalent: number
  spent: number
  covers: number
  balance: number
  isOverspent: boolean
  notes: string | null
  sortOrder: number
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

interface BudgetWeekData {
  weekStart: string
  groups: BudgetGroup[]
  incomeGroups: IncomeGroup[]
  totalWeeklyBudget: number
  totalIncome: number
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

  const allGroups = db
    .prepare(
      `SELECT id, name, sort_order, is_income FROM budget_groups WHERE is_active = 1 ORDER BY sort_order, name`,
    )
    .all() as unknown as RawGroup[]

  const categories = db
    .prepare(
      `SELECT id, group_id, name, budgeted_amount, period, notes, sort_order
       FROM budget_categories WHERE is_active = 1 AND is_unlisted = 0 ORDER BY sort_order, name`,
    )
    .all() as unknown as RawCategory[]

  const regularGroups = allGroups.filter((g) => g.is_income === 0)
  const incomeGroupsRaw = allGroups.filter((g) => g.is_income === 1)

  let totalWeeklyBudget = 0

  // Build regular expense groups
  const groups: BudgetGroup[] = regularGroups.map((group) => {
    const groupCats = categories.filter((c) => c.group_id === group.id)

    const builtCats: BudgetCategory[] = groupCats.map((cat) => {
      const { budgetedAmount, period } = getEffectiveBudget(cat.id, weekStart)
      const bounds = getPeriodBoundaries(weekStart, period, getWeekStartsOn())

      const spentRow = db
        .prepare(
          `SELECT COALESCE(SUM(total), 0) as total FROM (
             SELECT t.amount as total FROM transactions t
             WHERE t.category_id = ? AND t.date >= ? AND t.date <= ?
               AND t.type = 'transaction' AND t.amount < 0
             UNION ALL
             SELECT ts.amount as total FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE ts.category_id = ? AND t.date >= ? AND t.date <= ?
               AND t.type = 'transaction' AND ts.amount < 0
           )`,
        )
        .get(cat.id, bounds.start, bounds.end, cat.id, bounds.start, bounds.end) as { total: number }

      const spent = Math.abs(spentRow.total)

      const coversRow = db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) as total
           FROM transactions
           WHERE category_id = ? AND cover_week_start = ? AND type = 'cover' AND amount > 0`,
        )
        .get(cat.id, weekStart) as { total: number }

      const covers = coversRow.total
      const balance = budgetedAmount - spent + covers
      const weekly = weeklyEquivalent(budgetedAmount, period)
      totalWeeklyBudget += weekly

      return {
        id: cat.id,
        name: cat.name,
        period,
        budgetedAmount,
        weeklyEquivalent: weekly,
        spent,
        covers,
        balance,
        isOverspent: balance < 0,
        notes: cat.notes,
        sortOrder: cat.sort_order,
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

    const builtCats: IncomeCategory[] = groupCats.map((cat) => {
      const bounds = getPeriodBoundaries(weekStart, cat.period)

      const receivedRow = db
        .prepare(
          `SELECT COALESCE(SUM(total), 0) as total FROM (
             SELECT t.amount as total FROM transactions t
             WHERE t.category_id = ? AND t.date >= ? AND t.date <= ?
               AND t.type = 'transaction' AND t.amount > 0
             UNION ALL
             SELECT ts.amount as total FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE ts.category_id = ? AND t.date >= ? AND t.date <= ?
               AND t.type = 'transaction' AND ts.amount > 0
           )`,
        )
        .get(cat.id, bounds.start, bounds.end, cat.id, bounds.start, bounds.end) as { total: number }

      return {
        id: cat.id,
        name: cat.name,
        period: cat.period,
        received: receivedRow.total,
        notes: cat.notes,
        sortOrder: cat.sort_order,
      }
    })

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
  const unallocated = totalIncome - totalWeeklyBudget

  return {
    weekStart,
    groups,
    incomeGroups,
    totalWeeklyBudget,
    totalIncome,
    unallocated,
  }
}

/**
 * Calculate the current overspend amount for a category in a given week.
 */
export function getCategoryOverspendAmount(categoryId: number, weekStart: string): number {
  const { budgetedAmount, period } = getEffectiveBudget(categoryId, weekStart)
  const bounds = getPeriodBoundaries(weekStart, period, getWeekStartsOn())
  const db = getDb()

  const spentRow = db
    .prepare(
      `SELECT COALESCE(SUM(total), 0) as total FROM (
         SELECT t.amount as total FROM transactions t
         WHERE t.category_id = ? AND t.date >= ? AND t.date <= ?
           AND t.type = 'transaction' AND t.amount < 0
         UNION ALL
         SELECT ts.amount as total FROM transaction_splits ts
         JOIN transactions t ON t.id = ts.transaction_id
         WHERE ts.category_id = ? AND t.date >= ? AND t.date <= ?
           AND t.type = 'transaction' AND ts.amount < 0
       )`,
    )
    .get(categoryId, bounds.start, bounds.end, categoryId, bounds.start, bounds.end) as { total: number }

  const spent = Math.abs(spentRow.total)

  const coversRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE category_id = ? AND cover_week_start = ? AND type = 'cover' AND amount > 0`,
    )
    .get(categoryId, weekStart) as { total: number }

  const covers = coversRow.total
  const balance = budgetedAmount - spent + covers

  return balance < 0 ? Math.abs(balance) : 0
}

/**
 * Record a budget amount change, creating a history entry effective from the current week.
 */
export function recordBudgetChange(
  categoryId: number,
  newAmount: number,
  newPeriod: string,
  userId: number,
): void {
  const db = getDb()
  const weekStart = toDateString(getWeekStart(new Date(), getWeekStartsOn()))
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO budget_history (category_id, budgeted_amount, period, effective_from, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(categoryId, newAmount, newPeriod, weekStart, now, userId)
}

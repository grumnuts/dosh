import { getDb } from '../db/client'
import { getPeriodBoundaries, weeklyEquivalent, toDateString, getWeekStart } from '../utils/dates'

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

interface BudgetGroup {
  id: number
  name: string
  sortOrder: number
  categories: BudgetCategory[]
}

interface BudgetWeekData {
  weekStart: string
  groups: BudgetGroup[]
  totalWeeklyBudget: number
  totalIncome: number
  unallocated: number
}

/**
 * Get the historically effective budget amount for a category at a given week.
 * Looks up budget_history for an entry where effective_from <= weekStart,
 * falling back to the current category value if no history exists.
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
 * Returns groups with categories, each with spent/covers/balance,
 * plus footer totals.
 */
export function getBudgetWeek(weekStart: string): BudgetWeekData {
  const db = getDb()

  const groups = db
    .prepare(
      `SELECT id, name, sort_order FROM budget_groups WHERE is_active = 1 ORDER BY sort_order, name`,
    )
    .all() as unknown as RawGroup[]

  const categories = db
    .prepare(
      `SELECT id, group_id, name, budgeted_amount, period, notes, sort_order
       FROM budget_categories WHERE is_active = 1 ORDER BY sort_order, name`,
    )
    .all() as unknown as RawCategory[]

  let totalWeeklyBudget = 0

  const result: BudgetGroup[] = groups.map((group) => {
    const groupCats = categories.filter((c) => c.group_id === group.id)

    const builtCats: BudgetCategory[] = groupCats.map((cat) => {
      const { budgetedAmount, period } = getEffectiveBudget(cat.id, weekStart)
      const bounds = getPeriodBoundaries(weekStart, period)

      // Sum of regular transaction debits (negative amounts) for this category in the period
      const spentRow = db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) as total
           FROM transactions
           WHERE category_id = ? AND date >= ? AND date <= ?
             AND type = 'transaction' AND amount < 0`,
        )
        .get(cat.id, bounds.start, bounds.end) as { total: number }

      // Absolute spending amount (positive)
      const spent = Math.abs(spentRow.total)

      // Sum of cover transfer credits for this category and this specific week
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

  // Total income for the week: positive transaction amounts NOT from transfers/covers
  const incomeRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE date >= ? AND date <= ? AND type = 'transaction' AND amount > 0`,
    )
    .get(weekStart, toDateString(new Date(new Date(weekStart + 'T00:00:00Z').getTime() + 6 * 86400000))) as {
    total: number
  }

  const totalIncome = incomeRow.total
  const unallocated = totalIncome - totalWeeklyBudget

  return {
    weekStart,
    groups: result,
    totalWeeklyBudget,
    totalIncome,
    unallocated,
  }
}

/**
 * Calculate the current overspend amount for a category in a given week.
 * Returns the amount needed to cover (positive), or 0 if not overspent.
 */
export function getCategoryOverspendAmount(categoryId: number, weekStart: string): number {
  const { budgetedAmount, period } = getEffectiveBudget(categoryId, weekStart)
  const bounds = getPeriodBoundaries(weekStart, period)
  const db = getDb()

  const spentRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE category_id = ? AND date >= ? AND date <= ?
         AND type = 'transaction' AND amount < 0`,
    )
    .get(categoryId, bounds.start, bounds.end) as { total: number }

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
  const weekStart = toDateString(getWeekStart(new Date()))
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO budget_history (category_id, budgeted_amount, period, effective_from, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(categoryId, newAmount, newPeriod, weekStart, now, userId)
}

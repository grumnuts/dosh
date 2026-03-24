import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db/client'
import { authenticate } from '../middleware/auth'

const yearSchema = z.object({ year: z.string().regex(/^\d{4}$/) })

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/reports/years — distinct years with transaction data
  app.get('/api/reports/years', { preHandler: authenticate }, async (_req, reply) => {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT DISTINCT strftime('%Y', date) AS year FROM transactions ORDER BY year DESC`,
      )
      .all() as Array<{ year: string }>
    return reply.send(rows.map((r) => r.year))
  })

  // GET /api/reports/spending?year=YYYY — category spending totals by month
  app.get('/api/reports/spending', { preHandler: authenticate }, async (request, reply) => {
    const query = yearSchema.safeParse(request.query)
    if (!query.success) return reply.code(400).send({ error: 'Invalid year' })
    const { year } = query.data
    const db = getDb()

    // Spending from split transactions + direct transactions (UNION)
    const rows = db
      .prepare(
        `SELECT bc.name AS category, bg.name AS group_name,
                bc.id AS category_id, bg.sort_order AS group_sort, bc.sort_order AS cat_sort,
                strftime('%m', t.date) AS month,
                SUM(ABS(amount)) AS total_cents
         FROM (
           SELECT ts.amount, ts.category_id, t.date
           FROM transaction_splits ts
           JOIN transactions t ON t.id = ts.transaction_id
           WHERE t.type NOT IN ('transfer','cover')
             AND ts.amount < 0
             AND strftime('%Y', t.date) = ?
             AND ts.category_id IS NOT NULL
           UNION ALL
           SELECT t.amount, t.category_id, t.date
           FROM transactions t
           WHERE t.type NOT IN ('transfer','cover')
             AND t.amount < 0
             AND strftime('%Y', t.date) = ?
             AND t.category_id IS NOT NULL
             AND t.id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
         ) AS combined
         JOIN budget_categories bc ON bc.id = combined.category_id
         JOIN budget_groups bg ON bg.id = bc.group_id
         WHERE bg.is_income = 0
         GROUP BY combined.category_id, month
         ORDER BY bg.sort_order, bc.sort_order, month`,
      )
      .all(year, year) as Array<{
      category: string
      group_name: string
      category_id: number
      group_sort: number
      cat_sort: number
      month: string
      total_cents: number
    }>

    return reply.send(rows)
  })

  // GET /api/reports/overspend?year=YYYY — monthly overspend per category
  app.get('/api/reports/overspend', { preHandler: authenticate }, async (request, reply) => {
    const query = yearSchema.safeParse(request.query)
    if (!query.success) return reply.code(400).send({ error: 'Invalid year' })
    const { year } = query.data
    const db = getDb()

    // Get all expense categories
    const categories = db
      .prepare(
        `SELECT bc.id, bc.name AS category, bg.name AS group_name,
                bg.sort_order AS group_sort, bc.sort_order AS cat_sort
         FROM budget_categories bc
         JOIN budget_groups bg ON bg.id = bc.group_id
         WHERE bc.is_active = 1 AND bc.is_unlisted = 0 AND bg.is_income = 0`,
      )
      .all() as Array<{
      id: number
      category: string
      group_name: string
      group_sort: number
      cat_sort: number
    }>

    // Get spending per category per month
    const spendingRows = db
      .prepare(
        `SELECT combined.category_id,
                strftime('%m', combined.date) AS month,
                SUM(ABS(combined.amount)) AS spent_cents
         FROM (
           SELECT ts.amount, ts.category_id, t.date
           FROM transaction_splits ts
           JOIN transactions t ON t.id = ts.transaction_id
           WHERE t.type NOT IN ('transfer','cover')
             AND ts.amount < 0
             AND strftime('%Y', t.date) = ?
             AND ts.category_id IS NOT NULL
           UNION ALL
           SELECT t.amount, t.category_id, t.date
           FROM transactions t
           WHERE t.type NOT IN ('transfer','cover')
             AND t.amount < 0
             AND strftime('%Y', t.date) = ?
             AND t.category_id IS NOT NULL
             AND t.id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
         ) AS combined
         GROUP BY combined.category_id, month`,
      )
      .all(year, year) as Array<{ category_id: number; month: string; spent_cents: number }>

    // Get budget history (most recent budget for each category per month)
    // We use the average weekly budget for the year * 52/12 as monthly equivalent
    const budgetRows = db
      .prepare(
        `SELECT bh.category_id, bc.period,
                AVG(bh.budgeted_amount) AS avg_weekly_amount
         FROM budget_history bh
         JOIN budget_categories bc ON bc.id = bh.category_id
         WHERE strftime('%Y', bh.effective_from) <= ?
         GROUP BY bh.category_id`,
      )
      .all(year) as Array<{
      category_id: number
      period: string
      avg_weekly_amount: number
    }>

    // Fallback: categories with no history use their current budgeted_amount
    const currentBudgets = db
      .prepare(
        `SELECT id AS category_id, budgeted_amount, period
         FROM budget_categories
         WHERE is_active = 1 AND is_unlisted = 0`,
      )
      .all() as Array<{ category_id: number; budgeted_amount: number; period: string }>

    const budgetMap = new Map<number, { weeklyAmount: number; period: string }>()
    for (const cb of currentBudgets) {
      budgetMap.set(cb.category_id, { weeklyAmount: cb.budgeted_amount, period: cb.period })
    }
    for (const bh of budgetRows) {
      budgetMap.set(bh.category_id, { weeklyAmount: bh.avg_weekly_amount, period: bh.period })
    }

    function monthlyEquivalent(weeklyAmount: number, period: string): number {
      if (period === 'monthly') return weeklyAmount
      if (period === 'quarterly') return weeklyAmount / 3
      if (period === 'annual') return weeklyAmount / 12
      // weekly — convert to monthly: weekly * 52 / 12
      return Math.round((weeklyAmount * 52) / 12)
    }

    // Build spending lookup: category_id -> month -> spent
    const spendMap = new Map<string, number>()
    for (const s of spendingRows) {
      spendMap.set(`${s.category_id}:${s.month}`, s.spent_cents)
    }

    const results: Array<{
      category: string
      group_name: string
      group_sort: number
      cat_sort: number
      month: string
      spent_cents: number
      budgeted_cents: number
      overspend_cents: number
    }> = []

    for (const cat of categories) {
      const budget = budgetMap.get(cat.id)
      if (!budget || budget.weeklyAmount === 0) continue
      const budgetedMonthly = monthlyEquivalent(budget.weeklyAmount, budget.period)

      for (let m = 1; m <= 12; m++) {
        const monthStr = String(m).padStart(2, '0')
        const spent = spendMap.get(`${cat.id}:${monthStr}`) ?? 0
        const overspend = Math.max(0, spent - budgetedMonthly)
        if (overspend > 0) {
          results.push({
            category: cat.category,
            group_name: cat.group_name,
            group_sort: cat.group_sort,
            cat_sort: cat.cat_sort,
            month: monthStr,
            spent_cents: spent,
            budgeted_cents: budgetedMonthly,
            overspend_cents: overspend,
          })
        }
      }
    }

    results.sort((a, b) =>
      a.group_sort !== b.group_sort
        ? a.group_sort - b.group_sort
        : a.cat_sort !== b.cat_sort
          ? a.cat_sort - b.cat_sort
          : a.month.localeCompare(b.month),
    )

    return reply.send(results)
  })

  // GET /api/reports/payees?year=YYYY — income/expense per payee per month
  app.get('/api/reports/payees', { preHandler: authenticate }, async (request, reply) => {
    const query = yearSchema.safeParse(request.query)
    if (!query.success) return reply.code(400).send({ error: 'Invalid year' })
    const { year } = query.data
    const db = getDb()

    const rows = db
      .prepare(
        `SELECT t.payee,
                strftime('%m', t.date) AS month,
                SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS income_cents,
                SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END) AS expense_cents
         FROM transactions t
         WHERE t.type NOT IN ('transfer','cover')
           AND strftime('%Y', t.date) = ?
           AND t.payee IS NOT NULL AND t.payee != ''
         GROUP BY t.payee, month
         ORDER BY t.payee, month`,
      )
      .all(year) as Array<{
      payee: string
      month: string
      income_cents: number
      expense_cents: number
    }>

    return reply.send(rows)
  })

  // GET /api/reports/goals — savings balance history + projection
  app.get('/api/reports/goals', { preHandler: authenticate }, async (_req, reply) => {
    const db = getDb()

    const accounts = db
      .prepare(
        `SELECT id, name, goal_amount, goal_monthly_contribution,
                starting_balance + COALESCE((SELECT SUM(amount) FROM transactions WHERE account_id = a.id), 0) AS current_balance
         FROM accounts a
         WHERE type = 'savings' AND goal_amount IS NOT NULL AND is_active = 1`,
      )
      .all() as Array<{ id: number; name: string; goal_amount: number; goal_monthly_contribution: number | null; current_balance: number }>

    const result = accounts.map((account) => {
      // Monthly net changes
      const monthlyChanges = db
        .prepare(
          `SELECT strftime('%Y-%m', date) AS month, SUM(amount) AS net_change
           FROM transactions
           WHERE account_id = ?
           GROUP BY month
           ORDER BY month`,
        )
        .all(account.id) as Array<{ month: string; net_change: number }>

      // Build running balance history from starting_balance=0 (we add transactions)
      // starting_balance is already factored into current_balance but we need history
      const startingBalance = db
        .prepare('SELECT starting_balance FROM accounts WHERE id = ?')
        .get(account.id) as { starting_balance: number }

      let running = startingBalance.starting_balance
      const history: Array<{ month: string; balance: number }> = []
      for (const row of monthlyChanges) {
        running += row.net_change
        history.push({ month: row.month, balance: running })
      }

      // Projection rate: use budgeted monthly contribution if set, otherwise avg of last 3 months
      let avgDelta = 0
      if (account.goal_monthly_contribution != null && account.goal_monthly_contribution > 0) {
        avgDelta = account.goal_monthly_contribution
      } else {
        const last3 = history.slice(-3)
        if (last3.length >= 2) {
          const totalDelta = last3[last3.length - 1].balance - last3[0].balance
          avgDelta = totalDelta / (last3.length - 1)
        } else if (last3.length === 1) {
          avgDelta = last3[0].balance > 0 ? last3[0].balance / 12 : 0
        }
      }

      const projection: Array<{ month: string; balance: number }> = []
      if (avgDelta > 0) {
        const lastHistory = history.length > 0 ? history[history.length - 1] : null
        const startBalance = lastHistory ? lastHistory.balance : account.current_balance
        let lastMonth = lastHistory ? lastHistory.month : new Date().toISOString().slice(0, 7)
        let projBalance = startBalance

        for (let i = 0; i < 36; i++) {
          const [yr, mo] = lastMonth.split('-').map(Number)
          const nextMo = mo === 12 ? 1 : mo + 1
          const nextYr = mo === 12 ? yr + 1 : yr
          lastMonth = `${nextYr}-${String(nextMo).padStart(2, '0')}`
          projBalance = Math.round(projBalance + avgDelta)
          projection.push({ month: lastMonth, balance: projBalance })
          if (projBalance >= account.goal_amount) break
        }
      }

      return {
        accountId: account.id,
        name: account.name,
        goalMonthlyContribution: account.goal_monthly_contribution,
        goalAmount: account.goal_amount,
        currentBalance: account.current_balance,
        history,
        projection,
      }
    })

    return reply.send(result)
  })
}

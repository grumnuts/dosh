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
                strftime('%m', combined.date) AS month,
                -SUM(combined.amount) AS total_cents
         FROM (
           SELECT ts.amount, ts.category_id, t.date
           FROM transaction_splits ts
           JOIN transactions t ON t.id = ts.transaction_id
           WHERE t.type NOT IN ('transfer','cover')
             AND strftime('%Y', t.date) = ?
             AND ts.category_id IS NOT NULL
           UNION ALL
           SELECT t.amount, t.category_id, t.date
           FROM transactions t
           WHERE t.type NOT IN ('transfer','cover')
             AND strftime('%Y', t.date) = ?
             AND t.category_id IS NOT NULL
             AND t.id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
         ) AS combined
         JOIN budget_categories bc ON bc.id = combined.category_id
         JOIN budget_groups bg ON bg.id = bc.group_id
         WHERE bg.is_income = 0
         GROUP BY combined.category_id, month
         HAVING SUM(-combined.amount) > 0
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

  // GET /api/reports/overspend?year=YYYY — overspend per category, period-aware
  app.get('/api/reports/overspend', { preHandler: authenticate }, async (request, reply) => {
    const query = yearSchema.safeParse(request.query)
    if (!query.success) return reply.code(400).send({ error: 'Invalid year' })
    const { year } = query.data
    const db = getDb()

    // Normalize period strings to canonical forms
    function normalizePeriod(p: string): 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual' {
      if (p === 'annually' || p === 'annual') return 'annual'
      if (p === 'quarterly') return 'quarterly'
      if (p === 'monthly') return 'monthly'
      if (p === 'fortnightly') return 'fortnightly'
      return 'weekly'
    }

    // Get all expense categories
    const categories = db
      .prepare(
        `SELECT bc.id, bc.name AS category, bg.name AS group_name,
                bg.sort_order AS group_sort, bc.sort_order AS cat_sort
         FROM budget_categories bc
         JOIN budget_groups bg ON bg.id = bc.group_id
         WHERE bc.is_active = 1 AND bc.is_unlisted = 0 AND bg.is_income = 0`,
      )
      .all() as Array<{ id: number; category: string; group_name: string; group_sort: number; cat_sort: number }>

    // Get spending per category per month for the year
    const spendingRows = db
      .prepare(
        `SELECT combined.category_id,
                strftime('%m', combined.date) AS month,
                -SUM(combined.amount) AS spent_cents
         FROM (
           SELECT ts.amount, ts.category_id, t.date
           FROM transaction_splits ts
           JOIN transactions t ON t.id = ts.transaction_id
           WHERE t.type NOT IN ('transfer','cover')
             AND strftime('%Y', t.date) = ?
             AND ts.category_id IS NOT NULL
           UNION ALL
           SELECT t.amount, t.category_id, t.date
           FROM transactions t
           WHERE t.type NOT IN ('transfer','cover')
             AND strftime('%Y', t.date) = ?
             AND t.category_id IS NOT NULL
             AND t.id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
         ) AS combined
         GROUP BY combined.category_id, month`,
      )
      .all(year, year) as Array<{ category_id: number; month: string; spent_cents: number }>

    // Budget amounts: prefer history, fall back to current
    const currentBudgets = db
      .prepare(
        `SELECT id AS category_id, budgeted_amount, period FROM budget_categories WHERE is_active = 1 AND is_unlisted = 0`,
      )
      .all() as Array<{ category_id: number; budgeted_amount: number; period: string }>

    const historyBudgets = db
      .prepare(
        `SELECT bh.category_id, AVG(bh.budgeted_amount) AS budgeted_amount, bc.period
         FROM budget_history bh
         JOIN budget_categories bc ON bc.id = bh.category_id
         WHERE strftime('%Y', bh.effective_from) <= ?
         GROUP BY bh.category_id`,
      )
      .all(year) as Array<{ category_id: number; budgeted_amount: number; period: string }>

    const budgetMap = new Map<number, { amount: number; period: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual' }>()
    for (const cb of currentBudgets) {
      budgetMap.set(cb.category_id, { amount: cb.budgeted_amount, period: normalizePeriod(cb.period) })
    }
    for (const bh of historyBudgets) {
      budgetMap.set(bh.category_id, { amount: bh.budgeted_amount, period: normalizePeriod(bh.period) })
    }

    // Build monthly spend lookup: `catId:month` -> cents
    const spendByMonth = new Map<string, number>()
    for (const s of spendingRows) {
      spendByMonth.set(`${s.category_id}:${s.month}`, s.spent_cents)
    }

    const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const QUARTER_MONTHS: Record<string, string[]> = {
      Q1: ['01','02','03'], Q2: ['04','05','06'], Q3: ['07','08','09'], Q4: ['10','11','12'],
    }

    const results: Array<{
      category: string
      group_name: string
      group_sort: number
      cat_sort: number
      period_label: string
      spent_cents: number
      budgeted_cents: number
      overspend_cents: number
    }> = []

    for (const cat of categories) {
      const budget = budgetMap.get(cat.id)
      if (!budget || budget.amount === 0) continue

      if (budget.period === 'annual') {
        // Compare full year spending against annual budget
        const spent = spendingRows
          .filter((r) => r.category_id === cat.id)
          .reduce((s, r) => s + r.spent_cents, 0)
        const overspend = Math.max(0, spent - budget.amount)
        if (overspend > 0) {
          results.push({ category: cat.category, group_name: cat.group_name, group_sort: cat.group_sort, cat_sort: cat.cat_sort, period_label: year, spent_cents: spent, budgeted_cents: budget.amount, overspend_cents: overspend })
        }
      } else if (budget.period === 'quarterly') {
        // Compare each quarter's spending against quarterly budget
        for (const [quarter, months] of Object.entries(QUARTER_MONTHS)) {
          const spent = months.reduce((s, m) => s + (spendByMonth.get(`${cat.id}:${m}`) ?? 0), 0)
          const overspend = Math.max(0, spent - budget.amount)
          if (overspend > 0) {
            results.push({ category: cat.category, group_name: cat.group_name, group_sort: cat.group_sort, cat_sort: cat.cat_sort, period_label: quarter, spent_cents: spent, budgeted_cents: budget.amount, overspend_cents: overspend })
          }
        }
      } else {
        // weekly/fortnightly/monthly: compare per month
        const monthlyBudget = budget.period === 'monthly'
          ? budget.amount
          : budget.period === 'fortnightly'
            ? Math.round((budget.amount * 26) / 12)
            : Math.round((budget.amount * 52) / 12)
        for (let m = 1; m <= 12; m++) {
          const monthStr = String(m).padStart(2, '0')
          const spent = spendByMonth.get(`${cat.id}:${monthStr}`) ?? 0
          const overspend = Math.max(0, spent - monthlyBudget)
          if (overspend > 0) {
            results.push({ category: cat.category, group_name: cat.group_name, group_sort: cat.group_sort, cat_sort: cat.cat_sort, period_label: MONTH_LABELS[m - 1], spent_cents: spent, budgeted_cents: monthlyBudget, overspend_cents: overspend })
          }
        }
      }
    }

    results.sort((a, b) =>
      a.group_sort !== b.group_sort ? a.group_sort - b.group_sort
        : a.cat_sort !== b.cat_sort ? a.cat_sort - b.cat_sort
          : a.period_label.localeCompare(b.period_label),
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

  // GET /api/reports/goals — savings balance history + projection, plus debt payoff projections
  app.get('/api/reports/goals', { preHandler: authenticate }, async (_req, reply) => {
    const db = getDb()

    const buildSeries = (accountId: number, startingBal: number, goalBalance: number) => {
      const monthlyChanges = db
        .prepare(
          `SELECT strftime('%Y-%m', date) AS month, SUM(amount) AS net_change
           FROM transactions
           WHERE account_id = ?
           GROUP BY month
           ORDER BY month`,
        )
        .all(accountId) as Array<{ month: string; net_change: number }>

      let running = startingBal
      const history: Array<{ month: string; balance: number }> = []
      for (const row of monthlyChanges) {
        running += row.net_change
        history.push({ month: row.month, balance: running })
      }

      const last3 = history.slice(-3)
      let avgDelta = 0
      if (last3.length >= 2) {
        const totalDelta = last3[last3.length - 1].balance - last3[0].balance
        avgDelta = totalDelta / (last3.length - 1)
      } else if (last3.length === 1) {
        const firstMonthChange = last3[0].balance - startingBal
        avgDelta = firstMonthChange > 0 ? firstMonthChange : (last3[0].balance > 0 ? last3[0].balance / 12 : 0)
      }

      const projection: Array<{ month: string; balance: number }> = []
      if (avgDelta > 0) {
        const lastHistory = history.length > 0 ? history[history.length - 1] : null
        let lastMonth = lastHistory ? lastHistory.month : new Date().toISOString().slice(0, 7)
        let projBalance = lastHistory ? lastHistory.balance : startingBal

        for (let i = 0; i < 240; i++) {
          const [yr, mo] = lastMonth.split('-').map(Number)
          const nextMo = mo === 12 ? 1 : mo + 1
          const nextYr = mo === 12 ? yr + 1 : yr
          lastMonth = `${nextYr}-${String(nextMo).padStart(2, '0')}`
          projBalance = Math.round(projBalance + avgDelta)
          projection.push({ month: lastMonth, balance: projBalance })
          if (projBalance >= goalBalance) break
        }
      }

      return { history, projection }
    }

    const savingsAccounts = db
      .prepare(
        `SELECT id, name, goal_amount, goal_target_date, starting_balance,
                starting_balance + COALESCE((SELECT SUM(amount) FROM transactions WHERE account_id = a.id), 0) AS current_balance
         FROM accounts a
         WHERE type = 'savings' AND goal_amount IS NOT NULL AND is_active = 1`,
      )
      .all() as Array<{ id: number; name: string; goal_amount: number; goal_target_date: string | null; starting_balance: number; current_balance: number }>

    const debtAccounts = db
      .prepare(
        `SELECT id, name, starting_balance,
                starting_balance + COALESCE((SELECT SUM(amount) FROM transactions WHERE account_id = a.id), 0) AS current_balance
         FROM accounts a
         WHERE type = 'debt' AND is_active = 1`,
      )
      .all() as Array<{ id: number; name: string; starting_balance: number; current_balance: number }>

    const savings = savingsAccounts.map((account) => {
      const { history, projection } = buildSeries(account.id, account.starting_balance, account.goal_amount)
      return {
        type: 'savings' as const,
        accountId: account.id,
        name: account.name,
        goalAmount: account.goal_amount,
        goalTargetDate: account.goal_target_date,
        startingBalance: account.starting_balance,
        currentBalance: account.current_balance,
        history,
        projection,
      }
    })

    const debts = debtAccounts.map((account) => {
      const { history, projection } = buildSeries(account.id, account.starting_balance, 0)
      return {
        type: 'debt' as const,
        accountId: account.id,
        name: account.name,
        goalAmount: 0,
        goalTargetDate: null,
        startingBalance: account.starting_balance,
        currentBalance: account.current_balance,
        history,
        projection,
      }
    })

    return reply.send([...savings, ...debts])
  })

  // GET /api/reports/invsout?year=YYYY — total income vs expenses by month
  app.get('/api/reports/invsout', { preHandler: authenticate }, async (request, reply) => {
    const query = yearSchema.safeParse(request.query)
    if (!query.success) return reply.code(400).send({ error: 'Invalid year' })
    const { year } = query.data
    const db = getDb()

    const rows = db
      .prepare(
        `SELECT strftime('%m', t.date) AS month,
                SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS income_cents,
                SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END) AS expense_cents
         FROM transactions t
         WHERE t.type NOT IN ('transfer', 'cover')
           AND strftime('%Y', t.date) = ?
         GROUP BY month
         ORDER BY month`,
      )
      .all(year) as Array<{ month: string; income_cents: number; expense_cents: number }>

    return reply.send(rows)
  })

  // GET /api/reports/networth — all-time monthly account balances and net worth
  app.get('/api/reports/networth', { preHandler: authenticate }, async (_req, reply) => {
    const db = getDb()

    const accounts = db
      .prepare(
        `SELECT id, name, type, starting_balance FROM accounts WHERE is_active = 1 ORDER BY sort_order, name`,
      )
      .all() as Array<{ id: number; name: string; type: string; starting_balance: number }>

    const accountHistories = accounts.map((account) => {
      const monthlyChanges = db
        .prepare(
          `SELECT strftime('%Y-%m', date) AS month, SUM(amount) AS net_change
           FROM transactions
           WHERE account_id = ?
           GROUP BY month
           ORDER BY month`,
        )
        .all(account.id) as Array<{ month: string; net_change: number }>

      let running = account.starting_balance
      const history: Array<{ month: string; balance: number }> = []
      for (const row of monthlyChanges) {
        running += row.net_change
        history.push({ month: row.month, balance: running })
      }

      return { id: account.id, name: account.name, type: account.type, startingBalance: account.starting_balance, history }
    })

    // Collect all distinct months across all accounts
    const allMonths = Array.from(
      new Set(accountHistories.flatMap((a) => a.history.map((h) => h.month))),
    ).sort()

    // Net worth per month: sum latest known balance for each account
    const netWorth = allMonths.map((month) => {
      const total = accountHistories.reduce((sum, account) => {
        // Use the most recent balance at or before this month
        const point = [...account.history].reverse().find((h) => h.month <= month)
        // If no history exists before this month, the account balance equals its starting balance
        return sum + (point ? point.balance : account.history.length === 0 ? 0 : account.startingBalance)
      }, 0)
      return { month, balance: total }
    })

    return reply.send({ accounts: accountHistories, netWorth })
  })
}

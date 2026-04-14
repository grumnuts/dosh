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
           WHERE t.type NOT IN ('transfer','cover','sweep')
             AND strftime('%Y', t.date) = ?
             AND ts.category_id IS NOT NULL
           UNION ALL
           SELECT t.amount, t.category_id, t.date
           FROM transactions t
           WHERE t.type NOT IN ('transfer','cover','sweep')
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

    // Fetch week_start_day setting (0 = Sunday, 1 = Monday)
    const settingsRow = db.prepare(`SELECT value FROM settings WHERE key = 'week_start_day'`).get() as { value: string } | undefined
    const weekStartDay = settingsRow?.value === '1' ? '1' : '0'

    // Spending per category per week (for weekly/fortnightly categories)
    // Week start computed from date using the configured week_start_day
    const weeklySpendingRows = db
      .prepare(
        `SELECT combined.category_id,
                CASE WHEN ? = '1'
                  THEN date(combined.date, '-' || ((CAST(strftime('%w', combined.date) AS INTEGER) + 6) % 7) || ' days')
                  ELSE date(combined.date, '-' || CAST(strftime('%w', combined.date) AS INTEGER) || ' days')
                END AS week_start,
                -SUM(combined.amount) AS spent_cents
         FROM (
           SELECT ts.amount, ts.category_id, t.date
           FROM transaction_splits ts
           JOIN transactions t ON t.id = ts.transaction_id
           WHERE t.type NOT IN ('transfer','cover','sweep')
             AND strftime('%Y', t.date) = ?
             AND ts.category_id IS NOT NULL
           UNION ALL
           SELECT t.amount, t.category_id, t.date
           FROM transactions t
           WHERE t.type NOT IN ('transfer','cover','sweep')
             AND strftime('%Y', t.date) = ?
             AND t.category_id IS NOT NULL
             AND t.id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
         ) AS combined
         GROUP BY combined.category_id, week_start`,
      )
      .all(weekStartDay, year, year) as Array<{ category_id: number; week_start: string; spent_cents: number }>

    // Build week-level spend lookup and collect week starts per category
    const spendByWeek = new Map<string, number>()
    const weeksByCat = new Map<number, string[]>()
    for (const s of weeklySpendingRows) {
      spendByWeek.set(`${s.category_id}:${s.week_start}`, s.spent_cents)
      if (!weeksByCat.has(s.category_id)) weeksByCat.set(s.category_id, [])
      weeksByCat.get(s.category_id)!.push(s.week_start)
    }
    // Ensure each category's weeks are sorted
    for (const weeks of weeksByCat.values()) weeks.sort()

    // Spending per category per month (for monthly/quarterly/annual categories)
    const spendingRows = db
      .prepare(
        `SELECT combined.category_id,
                strftime('%m', combined.date) AS month,
                -SUM(combined.amount) AS spent_cents
         FROM (
           SELECT ts.amount, ts.category_id, t.date
           FROM transaction_splits ts
           JOIN transactions t ON t.id = ts.transaction_id
           WHERE t.type NOT IN ('transfer','cover','sweep')
             AND strftime('%Y', t.date) = ?
             AND ts.category_id IS NOT NULL
           UNION ALL
           SELECT t.amount, t.category_id, t.date
           FROM transactions t
           WHERE t.type NOT IN ('transfer','cover','sweep')
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

    // Format a week_start ISO date as "Jan 5" (UTC, no timezone shift)
    function formatWeekLabel(isoDate: string): string {
      const [, m, d] = isoDate.split('-').map(Number)
      return `${MONTH_LABELS[m - 1]} ${d}`
    }

    // Accumulate per-category totals — one result row per category
    const catTotals = new Map<number, { spent: number; annualBudget: number; overspend: number }>()

    for (const cat of categories) {
      const budget = budgetMap.get(cat.id)
      if (!budget || budget.amount === 0) continue

      let totalOverspend = 0
      let totalSpent = 0

      if (budget.period === 'annual') {
        const spent = spendingRows
          .filter((r) => r.category_id === cat.id)
          .reduce((s, r) => s + r.spent_cents, 0)
        totalSpent = spent
        totalOverspend = Math.max(0, spent - budget.amount)
      } else if (budget.period === 'quarterly') {
        for (const months of Object.values(QUARTER_MONTHS)) {
          const spent = months.reduce((s, m) => s + (spendByMonth.get(`${cat.id}:${m}`) ?? 0), 0)
          totalSpent += spent
          totalOverspend += Math.max(0, spent - budget.amount)
        }
      } else if (budget.period === 'monthly') {
        for (let m = 1; m <= 12; m++) {
          const monthStr = String(m).padStart(2, '0')
          const spent = spendByMonth.get(`${cat.id}:${monthStr}`) ?? 0
          totalSpent += spent
          totalOverspend += Math.max(0, spent - budget.amount)
        }
      } else if (budget.period === 'fortnightly') {
        const weeks = weeksByCat.get(cat.id) ?? []
        for (let i = 0; i < weeks.length; i += 2) {
          const w1 = spendByWeek.get(`${cat.id}:${weeks[i]}`) ?? 0
          const w2 = i + 1 < weeks.length ? (spendByWeek.get(`${cat.id}:${weeks[i + 1]}`) ?? 0) : 0
          const spent = w1 + w2
          totalSpent += spent
          totalOverspend += Math.max(0, spent - budget.amount)
        }
      } else {
        // weekly
        const weeks = weeksByCat.get(cat.id) ?? []
        for (const weekStart of weeks) {
          const spent = spendByWeek.get(`${cat.id}:${weekStart}`) ?? 0
          totalSpent += spent
          totalOverspend += Math.max(0, spent - budget.amount)
        }
      }

      if (totalOverspend > 0) {
        // Annual budget equivalent for context
        const periodsPerYear: Record<string, number> = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, annual: 1 }
        const annualBudget = Math.round(budget.amount * (periodsPerYear[budget.period] ?? 1))
        catTotals.set(cat.id, { spent: totalSpent, annualBudget, overspend: totalOverspend })
      }
    }

    const results: Array<{
      category: string
      group_name: string
      group_sort: number
      cat_sort: number
      spent_cents: number
      budgeted_cents: number
      overspend_cents: number
    }> = []

    for (const cat of categories) {
      const totals = catTotals.get(cat.id)
      if (!totals) continue
      results.push({
        category: cat.category,
        group_name: cat.group_name,
        group_sort: cat.group_sort,
        cat_sort: cat.cat_sort,
        spent_cents: totals.spent,
        budgeted_cents: totals.annualBudget,
        overspend_cents: totals.overspend,
      })
    }

    results.sort((a, b) =>
      a.group_sort !== b.group_sort ? a.group_sort - b.group_sort : a.cat_sort - b.cat_sort,
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
         WHERE t.type NOT IN ('transfer','cover','sweep')
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

      // Compute the projection trend from real cash flows only — exclude starting balance
      // and reconciliation transactions (is_unlisted = 1) so a large initial debt entry
      // in the same month as payments doesn't swamp the average and kill the projection.
      const trendRows = db
        .prepare(
          `SELECT strftime('%Y-%m', date) AS month, SUM(amount) AS net_change
           FROM transactions
           WHERE account_id = ?
             AND (category_id IS NULL OR category_id NOT IN (
               SELECT id FROM budget_categories WHERE is_unlisted = 1
             ))
           GROUP BY month
           ORDER BY month`,
        )
        .all(accountId) as Array<{ month: string; net_change: number }>

      const recentTrend = trendRows.slice(-3)
      let avgDelta = 0
      if (recentTrend.length >= 2) {
        const totalChange = recentTrend.reduce((s, r) => s + r.net_change, 0)
        avgDelta = Math.round(totalChange / recentTrend.length)
      } else if (recentTrend.length === 1) {
        avgDelta = Math.round(recentTrend[0].net_change)
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
         WHERE t.type NOT IN ('transfer', 'cover', 'sweep')
           AND strftime('%Y', t.date) = ?
           AND (t.category_id IS NULL OR t.category_id NOT IN (
             SELECT id FROM budget_categories WHERE is_unlisted = 1
           ))
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

    // Build investment portfolio history from price snapshots × running quantity
    const investmentTxRows = db
      .prepare(
        `SELECT strftime('%Y-%m', date) AS month, investment_ticker AS ticker,
                SUM(investment_quantity) AS qty_change
         FROM transactions
         WHERE investment_ticker IS NOT NULL
         GROUP BY month, investment_ticker
         ORDER BY month`,
      )
      .all() as Array<{ month: string; ticker: string; qty_change: number }>

    const priceHistoryRows = db
      .prepare(`SELECT month, ticker, price_cents FROM share_price_history ORDER BY month`)
      .all() as Array<{ month: string; ticker: string; price_cents: number }>

    if (priceHistoryRows.length > 0) {
      // Build cumulative quantity per ticker over time
      const runningQty = new Map<string, number>()
      const qtyByMonth = new Map<string, Map<string, number>>()
      for (const row of investmentTxRows) {
        const prev = runningQty.get(row.ticker) ?? 0
        runningQty.set(row.ticker, prev + row.qty_change)
        if (!qtyByMonth.has(row.month)) qtyByMonth.set(row.month, new Map())
        qtyByMonth.get(row.month)!.set(row.ticker, runningQty.get(row.ticker)!)
      }

      // Build portfolio value per price-history month
      const portfolioByMonth = new Map<string, number>()
      const allPriceMonths = [...new Set(priceHistoryRows.map((r) => r.month))].sort()
      const lastQty = new Map<string, number>()

      for (const month of allPriceMonths) {
        // Advance running quantities up to this month
        for (const [m, qtys] of qtyByMonth) {
          if (m <= month) {
            for (const [t, q] of qtys) lastQty.set(t, q)
          }
        }
        const pricesThisMonth = priceHistoryRows.filter((r) => r.month === month)
        let total = 0
        for (const pr of pricesThisMonth) {
          total += (lastQty.get(pr.ticker) ?? 0) * pr.price_cents
        }
        portfolioByMonth.set(month, Math.round(total))
      }

      // Inject virtual "Investment Portfolio" entry
      accountHistories.push({
        id: -1,
        name: 'Investment Portfolio',
        type: 'investment_portfolio',
        startingBalance: 0,
        history: [...portfolioByMonth.entries()].map(([month, balance]) => ({ month, balance })),
      })
    }

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

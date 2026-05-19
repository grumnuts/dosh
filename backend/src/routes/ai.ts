import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db/client'
import { getBudgetWeek } from '../services/budget'
import { currentWeekStart } from '../utils/dates'

function getWeekStartsOn(): 0 | 1 {
  const db = getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('week_start_day') as { value: string } | undefined
  return row?.value === '1' ? 1 : 0
}

async function authenticateApiToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Unauthorized' })
  }
  const token = authHeader.slice(7)
  const db = getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_api_token') as { value: string } | undefined
  if (!row?.value || row.value !== token) {
    return reply.code(401).send({ error: 'Unauthorized' })
  }
}

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/ai/snapshot — consolidated financial snapshot for AI analysis
  // Returns accounts with balances, budget for the requested week, and last 90 days of transactions
  app.get('/api/ai/snapshot', { preHandler: authenticateApiToken }, async (request, reply) => {
    const query = z
      .object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
      .parse(request.query)

    const weekStart = query.week ?? currentWeekStart(getWeekStartsOn())
    const db = getDb()

    const accounts = db
      .prepare(
        `SELECT a.id, a.name, a.type,
                a.starting_balance + COALESCE(SUM(t.amount), 0) +
                CASE WHEN a.type = 'debt' THEN
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
                  ), 0)
                ELSE 0 END as current_balance_cents,
                a.notes, a.goal_amount, a.goal_target_date
         FROM accounts a
         LEFT JOIN transactions t ON t.account_id = a.id
         WHERE a.is_active = 1 AND a.closed_at IS NULL
         GROUP BY a.id
         ORDER BY a.sort_order, a.name`,
      )
      .all() as Array<{
      id: number
      name: string
      type: string
      current_balance_cents: number
      notes: string | null
      goal_amount: number | null
      goal_target_date: string | null
    }>

    const budget = getBudgetWeek(weekStart)

    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90)
    const fromDate = ninetyDaysAgo.toISOString().slice(0, 10)

    const transactions = db
      .prepare(
        `SELECT t.id, t.date, a.name as account_name, t.payee, t.description,
                t.amount, bg.name as group_name, bc.name as category_name, t.type
         FROM transactions t
         LEFT JOIN accounts a ON t.account_id = a.id
         LEFT JOIN budget_categories bc ON t.category_id = bc.id
         LEFT JOIN budget_groups bg ON bc.group_id = bg.id
         WHERE t.date >= ? AND t.type NOT IN ('transfer', 'starting_balance')
         ORDER BY t.date DESC, t.id DESC`,
      )
      .all(fromDate) as Array<{
      id: number
      date: string
      account_name: string | null
      payee: string | null
      description: string | null
      amount: number
      group_name: string | null
      category_name: string | null
      type: string
    }>

    return reply.send({
      generatedAt: new Date().toISOString(),
      weekStart,
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currentBalanceCents: a.current_balance_cents,
        notes: a.notes,
        goalAmountCents: a.goal_amount,
        goalTargetDate: a.goal_target_date,
      })),
      budget,
      transactions: transactions.map((t) => ({
        id: t.id,
        date: t.date,
        account: t.account_name,
        payee: t.payee,
        description: t.description,
        amountCents: t.amount,
        group: t.group_name,
        category: t.category_name,
        type: t.type,
      })),
    })
  })

  // GET /api/ai/transactions — filterable transaction history
  app.get('/api/ai/transactions', { preHandler: authenticateApiToken }, async (request, reply) => {
    const query = z
      .object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        accountId: z.string().optional(),
        categoryId: z.string().optional(),
        limit: z.string().optional(),
        offset: z.string().optional(),
      })
      .parse(request.query)

    const db = getDb()
    const limit = Math.min(parseInt(query.limit ?? '500', 10), 1000)
    const offset = parseInt(query.offset ?? '0', 10)

    let where = `WHERE t.type NOT IN ('transfer', 'starting_balance')`
    const params: (string | number)[] = []

    if (query.startDate) {
      where += ' AND t.date >= ?'
      params.push(query.startDate)
    }
    if (query.endDate) {
      where += ' AND t.date <= ?'
      params.push(query.endDate)
    }
    if (query.accountId) {
      where += ' AND t.account_id = ?'
      params.push(parseInt(query.accountId, 10))
    }
    if (query.categoryId) {
      where += ' AND t.category_id = ?'
      params.push(parseInt(query.categoryId, 10))
    }

    const { count: total } = db
      .prepare(`SELECT COUNT(*) as count FROM transactions t ${where}`)
      .get(...params) as { count: number }

    const rows = db
      .prepare(
        `SELECT t.id, t.date, a.name as account_name, t.payee, t.description,
                t.amount, bg.name as group_name, bc.name as category_name, t.type
         FROM transactions t
         LEFT JOIN accounts a ON t.account_id = a.id
         LEFT JOIN budget_categories bc ON t.category_id = bc.id
         LEFT JOIN budget_groups bg ON bc.group_id = bg.id
         ${where}
         ORDER BY t.date DESC, t.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Array<{
      id: number
      date: string
      account_name: string | null
      payee: string | null
      description: string | null
      amount: number
      group_name: string | null
      category_name: string | null
      type: string
    }>

    return reply.send({
      total,
      limit,
      offset,
      transactions: rows.map((t) => ({
        id: t.id,
        date: t.date,
        account: t.account_name,
        payee: t.payee,
        description: t.description,
        amountCents: t.amount,
        group: t.group_name,
        category: t.category_name,
        type: t.type,
      })),
    })
  })
}

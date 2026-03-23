import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db/client'
import { authenticate } from '../middleware/auth'
import { logAudit } from '../utils/audit'

const createAccountSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.enum(['transactional', 'savings', 'debt']),
  startingBalance: z.number().int().optional().default(0),
  startingBalanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(500).optional().nullable(),
  sortOrder: z.number().int().optional(),
})

const updateAccountSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.enum(['transactional', 'savings', 'debt']),
  notes: z.string().max(500).optional().nullable(),
  sortOrder: z.number().int().optional(),
})

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/accounts', { preHandler: authenticate }, async (_req, reply) => {
    const db = getDb()
    const accounts = db
      .prepare(
        `SELECT a.id, a.name, a.type, a.starting_balance, a.notes, a.sort_order,
                COALESCE(SUM(t.amount), 0) as transaction_total
         FROM accounts a
         LEFT JOIN transactions t ON t.account_id = a.id
         WHERE a.is_active = 1
         GROUP BY a.id
         ORDER BY a.sort_order, a.name`,
      )
      .all() as Array<{
      id: number
      name: string
      type: string
      starting_balance: number
      notes: string | null
      sort_order: number
      transaction_total: number
    }>

    return reply.send(
      accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currentBalance: a.starting_balance + a.transaction_total,
        notes: a.notes,
        sortOrder: a.sort_order,
      })),
    )
  })

  app.post('/api/accounts', { preHandler: authenticate }, async (request, reply) => {
    const body = createAccountSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid input', issues: body.error.issues })
    }

    const db = getDb()
    const now = new Date().toISOString()
    const maxOrder = (
      db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM accounts').get() as { m: number }
    ).m

    const result = db
      .prepare(
        `INSERT INTO accounts (name, type, starting_balance, notes, sort_order, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?, ?, ?)`,
      )
      .run(
        body.data.name,
        body.data.type,
        body.data.notes ?? null,
        body.data.sortOrder ?? maxOrder + 1,
        now,
        now,
      )

    const id = result.lastInsertRowid as number

    // Create a starting balance transaction if a non-zero balance was supplied
    if (body.data.startingBalance !== 0) {
      const startingBalanceCat = db
        .prepare(`SELECT id FROM budget_categories WHERE name = 'Starting Balance' AND is_system = 1`)
        .get() as { id: number } | undefined

      if (startingBalanceCat) {
        const txDate = body.data.startingBalanceDate ?? now.slice(0, 10)
        db.prepare(
          `INSERT INTO transactions (date, account_id, amount, category_id, type, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, 'transaction', ?, ?, ?)`,
        ).run(txDate, id, body.data.startingBalance, startingBalanceCat.id, now, now, request.user!.id)
      }
    }

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'account.created',
      entityType: 'account',
      entityId: id,
      details: { name: body.data.name, type: body.data.type },
    })

    return reply.code(201).send({ id })
  })

  app.put('/api/accounts/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = updateAccountSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid input', issues: body.error.issues })
    }

    const db = getDb()
    const existing = db.prepare('SELECT id, name FROM accounts WHERE id = ? AND is_active = 1').get(
      id,
    ) as { id: number; name: string } | undefined

    if (!existing) return reply.code(404).send({ error: 'Account not found' })

    db.prepare(
      `UPDATE accounts SET name = ?, type = ?, notes = ?, sort_order = COALESCE(?, sort_order), updated_at = ?
       WHERE id = ?`,
    ).run(
      body.data.name,
      body.data.type,
      body.data.notes ?? null,
      body.data.sortOrder ?? null,
      new Date().toISOString(),
      id,
    )

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'account.updated',
      entityType: 'account',
      entityId: parseInt(id, 10),
      details: { name: body.data.name },
    })

    return reply.send({ ok: true })
  })

  app.post('/api/accounts/:id/reconcile', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({
        actualBalance: z.number().int(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .safeParse(request.body)

    if (!body.success) return reply.code(400).send({ error: 'Invalid input' })

    const db = getDb()

    const account = db
      .prepare(
        `SELECT a.id, a.name, a.starting_balance + COALESCE(SUM(t.amount), 0) as current_balance
         FROM accounts a
         LEFT JOIN transactions t ON t.account_id = a.id
         WHERE a.id = ? AND a.is_active = 1
         GROUP BY a.id`,
      )
      .get(id) as { id: number; name: string; current_balance: number } | undefined

    if (!account) return reply.code(404).send({ error: 'Account not found' })

    const adjustment = body.data.actualBalance - account.current_balance
    if (adjustment === 0) {
      return reply.send({ ok: true, adjustment: 0 })
    }

    const reconCat = db
      .prepare(`SELECT id FROM budget_categories WHERE name = 'Reconciliation' AND is_system = 1`)
      .get() as { id: number } | undefined

    if (!reconCat) return reply.code(500).send({ error: 'Reconciliation category not found' })

    const now = new Date().toISOString()
    const txDate = body.data.date ?? now.slice(0, 10)

    const result = db
      .prepare(
        `INSERT INTO transactions (date, account_id, payee, amount, category_id, type, created_at, updated_at, created_by)
         VALUES (?, ?, 'Reconciliation', ?, ?, 'transaction', ?, ?, ?)`,
      )
      .run(txDate, account.id, adjustment, reconCat.id, now, now, request.user!.id)

    const transactionId = result.lastInsertRowid as number

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'account.reconciled',
      entityType: 'account',
      entityId: account.id,
      details: { name: account.name, adjustment, actualBalance: body.data.actualBalance },
    })

    return reply.send({ ok: true, adjustment, transactionId })
  })

  app.delete('/api/accounts/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const db = getDb()

    const account = db
      .prepare('SELECT id, name FROM accounts WHERE id = ? AND is_active = 1')
      .get(id) as { id: number; name: string } | undefined

    if (!account) return reply.code(404).send({ error: 'Account not found' })

    // Soft delete to preserve transaction history
    db.prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      id,
    )

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'account.deleted',
      entityType: 'account',
      entityId: account.id,
      details: { name: account.name },
    })

    return reply.send({ ok: true })
  })
}

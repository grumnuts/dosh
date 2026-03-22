import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db/client'
import { authenticate } from '../middleware/auth'
import { logAudit } from '../utils/audit'

const accountSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.enum(['transactional', 'savings']),
  startingBalance: z.number().int(),
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
        startingBalance: a.starting_balance,
        currentBalance: a.starting_balance + a.transaction_total,
        notes: a.notes,
        sortOrder: a.sort_order,
      })),
    )
  })

  app.post('/api/accounts', { preHandler: authenticate }, async (request, reply) => {
    const body = accountSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid input', issues: body.error.issues })
    }

    const db = getDb()
    const now = new Date().toISOString()
    const maxOrder = (
      db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM accounts').get() as {
        m: number
      }
    ).m

    const result = db
      .prepare(
        `INSERT INTO accounts (name, type, starting_balance, notes, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        body.data.name,
        body.data.type,
        body.data.startingBalance,
        body.data.notes ?? null,
        body.data.sortOrder ?? maxOrder + 1,
        now,
        now,
      )

    const id = result.lastInsertRowid as number

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
    const body = accountSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid input', issues: body.error.issues })
    }

    const db = getDb()
    const existing = db.prepare('SELECT id, name FROM accounts WHERE id = ? AND is_active = 1').get(
      id,
    ) as { id: number; name: string } | undefined

    if (!existing) return reply.code(404).send({ error: 'Account not found' })

    db.prepare(
      `UPDATE accounts SET name = ?, type = ?, starting_balance = ?, notes = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      body.data.name,
      body.data.type,
      body.data.startingBalance,
      body.data.notes ?? null,
      body.data.sortOrder ?? 0,
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

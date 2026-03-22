import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db/client'
import { authenticate } from '../middleware/auth'
import { logAudit } from '../utils/audit'

const transactionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accountId: z.number().int(),
  payee: z.string().max(256).optional().nullable(),
  description: z.string().max(512).optional().nullable(),
  amount: z.number().int(),
  categoryId: z.number().int().optional().nullable(),
  type: z.enum(['transaction', 'transfer']).optional().default('transaction'),
  transferToAccountId: z.number().int().optional().nullable(),
})

export async function transactionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/transactions', { preHandler: authenticate }, async (request, reply) => {
    const query = z
      .object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        accountId: z.string().optional(),
        categoryId: z.string().optional(),
        payee: z.string().optional(),
        limit: z.string().optional(),
        offset: z.string().optional(),
      })
      .parse(request.query)

    const db = getDb()

    let sql = `
      SELECT t.id, t.date, t.account_id, a.name as account_name,
             t.payee, t.description, t.amount, t.category_id,
             bc.name as category_name, bg.name as group_name,
             t.type, t.transfer_pair_id, t.cover_week_start,
             t.created_at
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      LEFT JOIN budget_categories bc ON bc.id = t.category_id
      LEFT JOIN budget_groups bg ON bg.id = bc.group_id
      WHERE 1=1
    `
    const params: (string | number)[] = []

    if (query.startDate) {
      sql += ' AND t.date >= ?'
      params.push(query.startDate)
    }
    if (query.endDate) {
      sql += ' AND t.date <= ?'
      params.push(query.endDate)
    }
    if (query.accountId) {
      sql += ' AND t.account_id = ?'
      params.push(parseInt(query.accountId, 10))
    }
    if (query.categoryId) {
      sql += ' AND t.category_id = ?'
      params.push(parseInt(query.categoryId, 10))
    }
    if (query.payee) {
      sql += ' AND t.payee LIKE ?'
      params.push(`%${query.payee}%`)
    }

    sql += ' ORDER BY t.date DESC, t.id DESC'

    const limit = Math.min(parseInt(query.limit ?? '200', 10), 500)
    const offset = parseInt(query.offset ?? '0', 10)
    sql += ' LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const rows = db.prepare(sql).all(...params)
    return reply.send(rows)
  })

  app.post('/api/transactions', { preHandler: authenticate }, async (request, reply) => {
    const body = transactionSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid input', issues: body.error.issues })
    }

    const db = getDb()
    const now = new Date().toISOString()

    if (body.data.type === 'transfer' && body.data.transferToAccountId) {
      // Create both legs of a transfer
      const debitResult = db
        .prepare(
          `INSERT INTO transactions (date, account_id, payee, description, amount, type, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, 'transfer', ?, ?, ?)`,
        )
        .run(
          body.data.date,
          body.data.accountId,
          body.data.payee ?? null,
          body.data.description ?? null,
          -Math.abs(body.data.amount),
          now,
          now,
          request.user!.id,
        )

      const debitId = debitResult.lastInsertRowid as number

      const creditResult = db
        .prepare(
          `INSERT INTO transactions (date, account_id, payee, description, amount, type, transfer_pair_id, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, 'transfer', ?, ?, ?, ?)`,
        )
        .run(
          body.data.date,
          body.data.transferToAccountId,
          body.data.payee ?? null,
          body.data.description ?? null,
          Math.abs(body.data.amount),
          'transfer',
          debitId,
          now,
          now,
          request.user!.id,
        )

      const creditId = creditResult.lastInsertRowid as number
      db.prepare('UPDATE transactions SET transfer_pair_id = ? WHERE id = ?').run(creditId, debitId)

      logAudit({
        userId: request.user!.id,
        username: request.user!.username,
        eventType: 'transaction.created',
        entityType: 'transaction',
        entityId: debitId,
        details: { type: 'transfer', amount: Math.abs(body.data.amount), date: body.data.date },
      })

      return reply.code(201).send({ id: debitId, pairedId: creditId })
    }

    // Regular transaction
    const result = db
      .prepare(
        `INSERT INTO transactions (date, account_id, payee, description, amount, category_id, type, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'transaction', ?, ?, ?)`,
      )
      .run(
        body.data.date,
        body.data.accountId,
        body.data.payee ?? null,
        body.data.description ?? null,
        body.data.amount,
        body.data.categoryId ?? null,
        now,
        now,
        request.user!.id,
      )

    const id = result.lastInsertRowid as number

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'transaction.created',
      entityType: 'transaction',
      entityId: id,
      details: { amount: body.data.amount, date: body.data.date, accountId: body.data.accountId },
    })

    return reply.code(201).send({ id })
  })

  app.put('/api/transactions/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const body = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        payee: z.string().max(256).optional().nullable(),
        description: z.string().max(512).optional().nullable(),
        amount: z.number().int(),
        categoryId: z.number().int().optional().nullable(),
        accountId: z.number().int(),
      })
      .safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid input', issues: body.error.issues })
    }

    const db = getDb()
    const existing = db.prepare("SELECT id, type FROM transactions WHERE id = ?").get(id) as
      | { id: number; type: string }
      | undefined

    if (!existing) return reply.code(404).send({ error: 'Transaction not found' })
    if (existing.type !== 'transaction') {
      return reply.code(400).send({ error: 'Can only edit regular transactions' })
    }

    db.prepare(
      `UPDATE transactions SET date = ?, account_id = ?, payee = ?, description = ?, amount = ?,
       category_id = ?, updated_at = ? WHERE id = ?`,
    ).run(
      body.data.date,
      body.data.accountId,
      body.data.payee ?? null,
      body.data.description ?? null,
      body.data.amount,
      body.data.categoryId ?? null,
      new Date().toISOString(),
      id,
    )

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'transaction.updated',
      entityType: 'transaction',
      entityId: parseInt(id, 10),
      details: { amount: body.data.amount, date: body.data.date },
    })

    return reply.send({ ok: true })
  })

  app.delete('/api/transactions/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const db = getDb()

    const tx = db
      .prepare('SELECT id, type, transfer_pair_id, amount, date FROM transactions WHERE id = ?')
      .get(id) as
      | { id: number; type: string; transfer_pair_id: number | null; amount: number; date: string }
      | undefined

    if (!tx) return reply.code(404).send({ error: 'Transaction not found' })

    // Delete both legs if it's a transfer or cover
    if (tx.transfer_pair_id) {
      db.prepare('DELETE FROM transactions WHERE id = ?').run(tx.transfer_pair_id)
    }
    db.prepare('DELETE FROM transactions WHERE id = ?').run(id)

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'transaction.deleted',
      entityType: 'transaction',
      entityId: parseInt(id, 10),
      details: { amount: tx.amount, date: tx.date, type: tx.type },
    })

    return reply.send({ ok: true })
  })
}

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
  type: z.enum(['transaction', 'transfer', 'starting_balance']).optional().default('transaction'),
  transferToAccountId: z.number().int().optional().nullable(),
})

function upsertPayee(payeeName: string | null | undefined): void {
  if (!payeeName?.trim()) return
  const db = getDb()
  db.prepare('INSERT OR IGNORE INTO payees (name, created_at) VALUES (?, ?)').run(
    payeeName.trim(),
    new Date().toISOString(),
  )
}

export async function transactionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/transactions/uncategorised-count', { preHandler: authenticate }, async (_request, reply) => {
    const db = getDb()
    const row = db
      .prepare(`SELECT COUNT(*) as count FROM transactions WHERE type = 'transaction' AND category_id IS NULL`)
      .get() as { count: number }
    return reply.send({ count: row.count })
  })

  app.get('/api/transactions', { preHandler: authenticate }, async (request, reply) => {
    const query = z
      .object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        accountId: z.string().optional(),
        categoryId: z.string().optional(),
        uncategorised: z.string().optional(),
        search: z.string().optional(),
        limit: z.string().optional(),
        offset: z.string().optional(),
      })
      .parse(request.query)

    const db = getDb()

    let sql = `
      SELECT t.id, t.date, t.account_id, a.name as account_name,
             t.payee, t.description, t.amount, t.category_id,
             bc.name as category_name, bg.name as group_name,
             bc.is_unlisted as category_is_unlisted,
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
    if (query.uncategorised === 'true') {
      sql += ` AND t.category_id IS NULL AND t.type = 'transaction'`
    }
    if (query.search) {
      sql += ` AND (t.payee LIKE ? OR t.description LIKE ? OR a.name LIKE ? OR bc.name LIKE ?`
      const term = `%${query.search}%`
      params.push(term, term, term, term)
      // Also match by dollar amount if the search string looks numeric
      const numericSearch = query.search.replace(/[$,\s]/g, '')
      const parsed = parseFloat(numericSearch)
      if (!isNaN(parsed) && parsed > 0) {
        sql += ` OR ABS(t.amount) = ?`
        params.push(Math.round(parsed * 100))
      }
      sql += `)`
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

    // Starting balance transaction
    if (body.data.type === 'starting_balance') {
      const startingBalanceCat = db
        .prepare(`SELECT id FROM budget_categories WHERE name = 'Starting Balance' AND is_system = 1`)
        .get() as { id: number } | undefined

      if (!startingBalanceCat) {
        return reply.code(500).send({ error: 'Starting Balance category not found' })
      }

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
          Math.abs(body.data.amount),
          startingBalanceCat.id,
          now,
          now,
          request.user!.id,
        )

      const id = result.lastInsertRowid as number
      upsertPayee(body.data.payee)

      logAudit({
        userId: request.user!.id,
        username: request.user!.username,
        eventType: 'transaction.created',
        entityType: 'transaction',
        entityId: id,
        details: { amount: Math.abs(body.data.amount), date: body.data.date, accountId: body.data.accountId, type: 'starting_balance' },
      })

      return reply.code(201).send({ id })
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
    upsertPayee(body.data.payee)

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
    const existing = db
      .prepare('SELECT id, type, transfer_pair_id, category_id FROM transactions WHERE id = ?')
      .get(id) as { id: number; type: string; transfer_pair_id: number | null; category_id: number | null } | undefined

    if (!existing) return reply.code(404).send({ error: 'Transaction not found' })
    if (existing.type === 'cover') {
      return reply.code(400).send({ error: 'Cover transactions cannot be edited' })
    }

    // Check if this transaction's category is unlisted (system-managed) — if so, preserve it
    const categoryIsUnlisted =
      existing.category_id !== null &&
      !!(
        db
          .prepare('SELECT id FROM budget_categories WHERE id = ? AND is_unlisted = 1')
          .get(existing.category_id) as { id: number } | undefined
      )

    const now = new Date().toISOString()

    if (existing.type === 'transfer') {
      // Update date, payee, description on both legs — amounts and accounts stay fixed
      const updateTransfer = db.prepare(
        `UPDATE transactions SET date = ?, payee = ?, description = ?, updated_at = ? WHERE id = ?`,
      )
      updateTransfer.run(body.data.date, body.data.payee ?? null, body.data.description ?? null, now, id)
      if (existing.transfer_pair_id) {
        updateTransfer.run(body.data.date, body.data.payee ?? null, body.data.description ?? null, now, existing.transfer_pair_id)
      }
    } else {
      db.prepare(
        `UPDATE transactions SET date = ?, account_id = ?, payee = ?, description = ?, amount = ?,
         category_id = ?, updated_at = ? WHERE id = ?`,
      ).run(
        body.data.date,
        body.data.accountId,
        body.data.payee ?? null,
        body.data.description ?? null,
        body.data.amount,
        // Preserve unlisted category — it cannot be reassigned via normal edit
        categoryIsUnlisted ? existing.category_id : (body.data.categoryId ?? null),
        now,
        id,
      )
    }

    upsertPayee(body.data.payee)

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'transaction.updated',
      entityType: 'transaction',
      entityId: parseInt(id, 10),
      details: { type: existing.type, date: body.data.date },
    })

    return reply.send({ ok: true })
  })

  app.post('/api/transactions/bulk-delete', { preHandler: authenticate }, async (request, reply) => {
    const body = z.object({ ids: z.array(z.number().int()).min(1).max(500) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid input' })

    const db = getDb()
    const { ids } = body.data
    const placeholders = ids.map(() => '?').join(',')

    const txs = db
      .prepare(`SELECT id, type, transfer_pair_id, amount, date FROM transactions WHERE id IN (${placeholders})`)
      .all(...ids) as Array<{ id: number; type: string; transfer_pair_id: number | null; amount: number; date: string }>

    // Collect IDs to delete including transfer pair counterparts
    const allIds = new Set<number>(ids)
    for (const tx of txs) {
      if (tx.transfer_pair_id) allIds.add(tx.transfer_pair_id)
    }
    const allIdsList = [...allIds]
    const allPlaceholders = allIdsList.map(() => '?').join(',')

    db.prepare(`UPDATE transactions SET transfer_pair_id = NULL WHERE id IN (${allPlaceholders})`).run(...allIdsList)
    db.prepare(`DELETE FROM transactions WHERE id IN (${allPlaceholders})`).run(...allIdsList)

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'transaction.bulk_deleted',
      entityType: 'transaction',
      entityId: 0,
      details: { count: allIdsList.length, ids: allIdsList },
    })

    return reply.send({ ok: true, deleted: allIdsList.length })
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

    // Delete both legs if it's a transfer or cover.
    // Clear transfer_pair_id on both rows first to avoid the circular FK constraint.
    if (tx.transfer_pair_id) {
      db.prepare('UPDATE transactions SET transfer_pair_id = NULL WHERE id IN (?, ?)').run(id, tx.transfer_pair_id)
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

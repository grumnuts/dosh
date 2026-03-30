import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db/client'
import { authenticate } from '../middleware/auth'
import { logAudit } from '../utils/audit'
import { applyRules } from '../services/rules'

const splitSchema = z.object({
  categoryId: z.number().int().nullable().optional(),
  amount: z.number().int(),
  note: z.string().max(256).optional().nullable(),
})

const transactionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accountId: z.number().int(),
  payee: z.string().max(256).optional().nullable(),
  description: z.string().max(512).optional().nullable(),
  amount: z.number().int(),
  categoryId: z.number().int().optional().nullable(),
  type: z.enum(['transaction', 'transfer', 'starting_balance']).optional().default('transaction'),
  transferToAccountId: z.number().int().optional().nullable(),
  splits: z.array(splitSchema).min(2).optional(),
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
  app.get('/api/transactions/payees', { preHandler: authenticate }, async (_request, reply) => {
    const db = getDb()
    const rows = db
      .prepare(`SELECT DISTINCT payee FROM transactions WHERE payee IS NOT NULL AND payee != '' ORDER BY payee`)
      .all() as { payee: string }[]
    return reply.send(rows.map((r) => r.payee))
  })

  app.get('/api/transactions/uncategorised-count', { preHandler: authenticate }, async (_request, reply) => {
    const db = getDb()
    const row = db
      .prepare(
        `SELECT COUNT(*) as count FROM transactions
         WHERE type = 'transaction' AND category_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM transaction_splits WHERE transaction_id = transactions.id)`,
      )
      .get() as { count: number }
    return reply.send({ count: row.count })
  })

  app.get('/api/transactions', { preHandler: authenticate }, async (request, reply) => {
    const query = z
      .object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        accountId: z.string().optional(),
        categoryId: z.string().optional(),
        payee: z.string().optional(),
        uncategorised: z.string().optional(),
        search: z.string().optional(),
        limit: z.string().optional(),
        offset: z.string().optional(),
      })
      .parse(request.query)

    const db = getDb()

    // Build shared WHERE clause and params (reused for count + main query)
    let where = ' WHERE 1=1'
    const whereParams: (string | number)[] = []

    if (query.startDate) {
      where += ' AND t.date >= ?'
      whereParams.push(query.startDate)
    }
    if (query.endDate) {
      where += ' AND t.date <= ?'
      whereParams.push(query.endDate)
    }
    if (query.accountId) {
      where += ' AND t.account_id = ?'
      whereParams.push(parseInt(query.accountId, 10))
    }
    if (query.categoryId) {
      where += ' AND t.category_id = ?'
      whereParams.push(parseInt(query.categoryId, 10))
    }
    if (query.payee) {
      where += ' AND t.payee = ?'
      whereParams.push(query.payee)
    }
    if (query.uncategorised === 'true') {
      where += ` AND t.category_id IS NULL AND t.type = 'transaction'`
      where += ` AND NOT EXISTS (SELECT 1 FROM transaction_splits ts WHERE ts.transaction_id = t.id)`
    }
    if (query.search) {
      where += ` AND (t.payee LIKE ? OR t.description LIKE ? OR a.name LIKE ? OR bc.name LIKE ?`
      const term = `%${query.search}%`
      whereParams.push(term, term, term, term)
      const numericSearch = query.search.replace(/[$,\s]/g, '')
      const parsed = parseFloat(numericSearch)
      if (!isNaN(parsed) && parsed > 0) {
        where += ` OR ABS(t.amount) = ?`
        whereParams.push(Math.round(parsed * 100))
      }
      where += `)`
    }

    const countRow = db
      .prepare(
        `SELECT COUNT(*) as count FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN budget_categories bc ON bc.id = t.category_id${where}`,
      )
      .get(...whereParams) as { count: number }
    const total = countRow.count

    const limit = Math.min(parseInt(query.limit ?? '100', 10), 500)
    const offset = parseInt(query.offset ?? '0', 10)

    const sql = `
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
      ${where} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?
    `

    const rows = db.prepare(sql).all(...whereParams, limit, offset) as Array<Record<string, unknown> & { id: number }>

    // Attach splits in a single batch query
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id)
      const placeholders = ids.map(() => '?').join(',')
      const splits = db
        .prepare(
          `SELECT ts.id, ts.transaction_id, ts.category_id, bc.name as category_name,
                  ts.amount, ts.note
           FROM transaction_splits ts
           LEFT JOIN budget_categories bc ON bc.id = ts.category_id
           WHERE ts.transaction_id IN (${placeholders})
           ORDER BY ts.id`,
        )
        .all(...ids) as Array<{
        id: number
        transaction_id: number
        category_id: number | null
        category_name: string | null
        amount: number
        note: string | null
      }>

      const splitsByTx = new Map<number, typeof splits>()
      for (const s of splits) {
        const arr = splitsByTx.get(s.transaction_id) ?? []
        arr.push(s)
        splitsByTx.set(s.transaction_id, arr)
      }

      const items = rows.map((r) => ({ ...r, splits: splitsByTx.get(r.id) ?? [] }))
      return reply.send({ total, items })
    }

    return reply.send({ total, items: rows.map((r) => ({ ...r, splits: [] })) })
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
        ipAddress: request.ip,
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
          body.data.amount,
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
        ipAddress: request.ip,
      })

      return reply.code(201).send({ id })
    }

    // Regular or split transaction — apply rules before inserting
    const splits = body.data.splits
    const ruled = splits
      ? body.data
      : applyRules(
          {
            date: body.data.date,
            accountId: body.data.accountId,
            payee: body.data.payee ?? null,
            description: body.data.description ?? null,
            amount: body.data.amount,
            categoryId: body.data.categoryId ?? null,
          },
          db,
        )

    const result = db
      .prepare(
        `INSERT INTO transactions (date, account_id, payee, description, amount, category_id, type, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'transaction', ?, ?, ?)`,
      )
      .run(
        ruled.date,
        ruled.accountId,
        ruled.payee ?? null,
        ruled.description ?? null,
        ruled.amount,
        splits ? null : (ruled.categoryId ?? null),
        now,
        now,
        request.user!.id,
      )

    const id = result.lastInsertRowid as number

    if (splits) {
      const insertSplit = db.prepare(
        `INSERT INTO transaction_splits (transaction_id, category_id, amount, note, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      for (const s of splits) {
        insertSplit.run(id, s.categoryId ?? null, s.amount, s.note ?? null, now)
      }
    }

    upsertPayee(body.data.payee)

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'transaction.created',
      entityType: 'transaction',
      entityId: id,
      details: { amount: body.data.amount, date: body.data.date, accountId: body.data.accountId, split: !!splits },
      ipAddress: request.ip,
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
        splits: z.array(splitSchema).optional(),
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
      const newSplits = body.data.splits
      db.prepare(
        `UPDATE transactions SET date = ?, account_id = ?, payee = ?, description = ?, amount = ?,
         category_id = ?, updated_at = ? WHERE id = ?`,
      ).run(
        body.data.date,
        body.data.accountId,
        body.data.payee ?? null,
        body.data.description ?? null,
        body.data.amount,
        categoryIsUnlisted
          ? existing.category_id
          : (newSplits && newSplits.length > 0)
            ? null
            : (body.data.categoryId ?? null),
        now,
        id,
      )

      if (newSplits !== undefined) {
        // Replace all splits
        db.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(id)
        if (newSplits.length > 0) {
          const insertSplit = db.prepare(
            `INSERT INTO transaction_splits (transaction_id, category_id, amount, note, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          for (const s of newSplits) {
            insertSplit.run(id, s.categoryId ?? null, s.amount, s.note ?? null, now)
          }
        }
      }
    }

    upsertPayee(body.data.payee)

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'transaction.updated',
      entityType: 'transaction',
      entityId: parseInt(id, 10),
      details: { type: existing.type, date: body.data.date },
      ipAddress: request.ip,
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

    // Cover transactions must not be bulk-deleted — they have paired budget effects and
    // must be removed via the single-delete endpoint which handles both legs correctly.
    const coverIds = txs.filter((t) => t.type === 'cover').map((t) => t.id)
    if (coverIds.length > 0) {
      return reply.code(400).send({
        error: 'Cover transactions cannot be bulk deleted. Remove them individually.',
        coverIds,
      })
    }

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
      ipAddress: request.ip,
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
      ipAddress: request.ip,
    })

    return reply.send({ ok: true })
  })
}

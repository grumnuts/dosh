import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db/client'
import { authenticate } from '../middleware/auth'
import { logAudit } from '../utils/audit'
import { applyRules } from '../services/rules'
import { fetchAndCachePrice, recalculateHoldings } from '../services/investments'

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
  ignoreRules: z.boolean().optional().default(false),
  investmentTicker: z.string().max(20).optional().nullable().transform((v) => v?.toUpperCase() ?? null),
  investmentQuantity: z.number().optional().nullable(),
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
        noPayee: z.string().optional(),
        uncategorised: z.string().optional(),
        hasReceipts: z.string().optional(),
        duplicates: z.string().optional(),
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
      where += ' AND (t.category_id = ? OR EXISTS (SELECT 1 FROM transaction_splits ts WHERE ts.transaction_id = t.id AND ts.category_id = ?))'
      const catId = parseInt(query.categoryId, 10)
      whereParams.push(catId, catId)
    }
    if (query.payee) {
      where += ' AND t.payee = ?'
      whereParams.push(query.payee)
    }
    if (query.noPayee === 'true') {
      where += ` AND (t.payee IS NULL OR t.payee = '')`
    }
    if (query.uncategorised === 'true') {
      where += ` AND t.category_id IS NULL AND t.type = 'transaction'`
      where += ` AND NOT EXISTS (SELECT 1 FROM transaction_splits ts WHERE ts.transaction_id = t.id)`
    }
    if (query.hasReceipts === 'true') {
      where += ` AND EXISTS (SELECT 1 FROM transaction_receipts WHERE transaction_id = t.id)`
    }
    if (query.duplicates === 'true') {
      where += ` AND t.type != 'transfer' AND EXISTS (
        SELECT 1 FROM transactions t2
        WHERE t2.id != t.id
        AND t2.date = t.date
        AND t2.amount = t.amount
        AND t2.account_id = t.account_id
        AND t2.type != 'transfer'
        AND ((t2.payee IS NULL AND t.payee IS NULL) OR t2.payee = t.payee)
      )`
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
             bc.is_investment as category_is_investment,
             t.type, t.transfer_pair_id, pair_acct.id as transfer_pair_account_id,
             t.cover_week_start, t.ignore_rules, t.created_at,
             t.investment_ticker, t.investment_quantity,
             (SELECT COUNT(*) FROM transaction_receipts WHERE transaction_id = t.id) as receipt_count,
             a.starting_balance + (
               SELECT COALESCE(SUM(t2.amount), 0)
               FROM transactions t2
               WHERE t2.account_id = t.account_id
                 AND (t2.date < t.date OR (t2.date = t.date AND t2.id <= t.id))
             ) as running_balance
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      LEFT JOIN budget_categories bc ON bc.id = t.category_id
      LEFT JOIN budget_groups bg ON bg.id = bc.group_id
      LEFT JOIN transactions pair_tx ON pair_tx.id = t.transfer_pair_id
      LEFT JOIN accounts pair_acct ON pair_acct.id = pair_tx.account_id
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
          `INSERT INTO transactions (date, account_id, payee, description, amount, type, ignore_rules, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, 'transfer', ?, ?, ?, ?)`,
        )
        .run(
          body.data.date,
          body.data.accountId,
          body.data.payee ?? null,
          body.data.description ?? null,
          -Math.abs(body.data.amount),
          body.data.ignoreRules ? 1 : 0,
          now,
          now,
          request.user!.id,
        )

      const debitId = debitResult.lastInsertRowid as number

      const creditResult = db
        .prepare(
          `INSERT INTO transactions (date, account_id, payee, description, amount, type, transfer_pair_id, ignore_rules, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, 'transfer', ?, ?, ?, ?, ?)`,
        )
        .run(
          body.data.date,
          body.data.transferToAccountId,
          body.data.payee ?? null,
          body.data.description ?? null,
          Math.abs(body.data.amount),
          debitId,
          body.data.ignoreRules ? 1 : 0,
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
          `INSERT INTO transactions (date, account_id, payee, description, amount, category_id, type, ignore_rules, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'transaction', ?, ?, ?, ?)`,
        )
        .run(
          body.data.date,
          body.data.accountId,
          body.data.payee ?? null,
          body.data.description ?? null,
          body.data.amount,
          startingBalanceCat.id,
          body.data.ignoreRules ? 1 : 0,
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

    // Regular or split transaction — apply rules before inserting (unless ignore_rules is set)
    const splits = body.data.splits
    const ruled = splits || body.data.ignoreRules
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

    // Resolve ticker: category-level ticker takes priority over transaction-level ticker
    const catTickerRow = ruled.categoryId
      ? db.prepare('SELECT ticker FROM budget_categories WHERE id = ?').get(ruled.categoryId) as { ticker: string | null } | undefined
      : undefined
    const ticker = catTickerRow?.ticker ?? body.data.investmentTicker ?? null
    const quantity = body.data.investmentQuantity ?? null

    const result = db
      .prepare(
        `INSERT INTO transactions (date, account_id, payee, description, amount, category_id, type, ignore_rules, investment_ticker, investment_quantity, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'transaction', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ruled.date,
        ruled.accountId,
        ruled.payee ?? null,
        ruled.description ?? null,
        ruled.amount,
        splits ? null : (ruled.categoryId ?? null),
        body.data.ignoreRules ? 1 : 0,
        ticker,
        quantity,
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

    if (ticker) {
      recalculateHoldings(ruled.accountId)
      // Fetch price for new tickers in the background
      const existing = db.prepare('SELECT ticker FROM share_prices WHERE ticker = ?').get(ticker)
      if (!existing) {
        fetchAndCachePrice(ticker).catch((err) => console.error(`[investments] Price fetch failed for ${ticker}:`, err))
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
        type: z.enum(['transaction', 'transfer']).optional(),
        transferToAccountId: z.number().int().optional().nullable(),
        splits: z.array(splitSchema).optional(),
        ignoreRules: z.boolean().optional(),
        investmentTicker: z.string().max(20).optional().nullable().transform((v) => v?.toUpperCase() ?? null),
        investmentQuantity: z.number().optional().nullable(),
      })
      .safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid input', issues: body.error.issues })
    }

    const db = getDb()
    const existing = db
      .prepare('SELECT id, type, transfer_pair_id, account_id, amount, category_id, ignore_rules, investment_ticker FROM transactions WHERE id = ?')
      .get(id) as { id: number; type: string; transfer_pair_id: number | null; account_id: number; amount: number; category_id: number | null; ignore_rules: number; investment_ticker: string | null } | undefined

    if (!existing) return reply.code(404).send({ error: 'Transaction not found' })

    const now = new Date().toISOString()

    if (existing.type === 'cover') {
      // Cover transactions only allow editing date (both legs) and account (this leg only)
      db.prepare(`UPDATE transactions SET date = ?, account_id = ?, updated_at = ? WHERE id = ?`)
        .run(body.data.date, body.data.accountId, now, id)
      if (existing.transfer_pair_id) {
        db.prepare(`UPDATE transactions SET date = ?, updated_at = ? WHERE id = ?`)
          .run(body.data.date, now, existing.transfer_pair_id)
      }
      logAudit({
        userId: request.user!.id,
        username: request.user!.username,
        eventType: 'transaction.updated',
        entityType: 'transaction',
        entityId: parseInt(id, 10),
        details: { type: 'cover', date: body.data.date, accountId: body.data.accountId },
        ipAddress: request.ip,
      })
      return reply.send({ id: parseInt(id, 10) })
    }

    // Check if this transaction's category is unlisted (system-managed) — if so, preserve it
    const categoryIsUnlisted =
      existing.category_id !== null &&
      !!(
        db
          .prepare('SELECT id FROM budget_categories WHERE id = ? AND is_unlisted = 1')
          .get(existing.category_id) as { id: number } | undefined
      )

    const requestedType = body.data.type ?? (existing.type === 'transfer' ? 'transfer' : 'transaction')

    if (existing.type === 'transfer' && requestedType === 'transfer') {
      // Staying as a transfer — update date, payee, description, and amount on both legs.
      // Preserve each leg's sign based on the existing amount (this leg could be debit or credit).
      const absAmount = Math.abs(body.data.amount)
      const thisLegAmount = existing.amount <= 0 ? -absAmount : absAmount
      const pairLegAmount = existing.amount <= 0 ? absAmount : -absAmount
      db.prepare(
        `UPDATE transactions SET date = ?, payee = ?, description = ?, amount = ?, updated_at = ? WHERE id = ?`,
      ).run(body.data.date, body.data.payee ?? null, body.data.description ?? null, thisLegAmount, now, id)
      if (existing.transfer_pair_id) {
        const destAccountId = body.data.transferToAccountId ?? null
        if (destAccountId !== null) {
          db.prepare(
            `UPDATE transactions SET date = ?, payee = ?, description = ?, amount = ?, account_id = ?, updated_at = ? WHERE id = ?`,
          ).run(body.data.date, body.data.payee ?? null, body.data.description ?? null, pairLegAmount, destAccountId, now, existing.transfer_pair_id)
        } else {
          db.prepare(
            `UPDATE transactions SET date = ?, payee = ?, description = ?, amount = ?, updated_at = ? WHERE id = ?`,
          ).run(body.data.date, body.data.payee ?? null, body.data.description ?? null, pairLegAmount, now, existing.transfer_pair_id)
        }
      }
    } else if (existing.type === 'transfer' && requestedType === 'transaction') {
      // Converting transfer → regular transaction: delete the paired leg
      if (existing.transfer_pair_id) {
        db.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(existing.transfer_pair_id)
        db.prepare('DELETE FROM transactions WHERE id = ?').run(existing.transfer_pair_id)
      }
      db.prepare(
        `UPDATE transactions SET date = ?, account_id = ?, payee = ?, description = ?, amount = ?,
         category_id = ?, type = 'transaction', transfer_pair_id = NULL, ignore_rules = ?, updated_at = ? WHERE id = ?`,
      ).run(
        body.data.date,
        body.data.accountId,
        body.data.payee ?? null,
        body.data.description ?? null,
        body.data.amount,
        body.data.categoryId ?? null,
        body.data.ignoreRules ? 1 : 0,
        now,
        id,
      )
    } else if (existing.type !== 'transfer' && requestedType === 'transfer') {
      // Converting regular → transfer: retype this transaction only, no automatic paired leg.
      // Preserve the original sign (debit stays negative, credit stays positive) regardless of
      // what the frontend sends — the frontend always sends a positive value for transfer type.
      const signedAmount = existing.amount <= 0 ? -Math.abs(body.data.amount) : Math.abs(body.data.amount)
      db.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(id)
      db.prepare(
        `UPDATE transactions SET date = ?, account_id = ?, payee = ?, description = ?, amount = ?,
         category_id = NULL, type = 'transfer', transfer_pair_id = NULL, ignore_rules = 0, updated_at = ? WHERE id = ?`,
      ).run(
        body.data.date,
        body.data.accountId,
        body.data.payee ?? null,
        body.data.description ?? null,
        signedAmount,
        now,
        id,
      )
    } else {
      // Regular transaction staying regular
      const newSplits = body.data.splits

      // Apply rules — rules always win, same as on create (unless ignore_rules is set)
      const ignoreRules = body.data.ignoreRules ?? (existing.ignore_rules === 1)
      let resolvedCategoryId: number | null = body.data.categoryId ?? null
      if (!categoryIsUnlisted && !(newSplits && newSplits.length > 0) && !ignoreRules) {
        resolvedCategoryId = applyRules(
          {
            date: body.data.date,
            accountId: body.data.accountId,
            payee: body.data.payee ?? null,
            description: body.data.description ?? null,
            amount: body.data.amount,
            categoryId: body.data.categoryId ?? null,
          },
          db,
        ).categoryId ?? null
      }

      // Resolve ticker: category-level ticker takes priority
      const updCatTickerRow = body.data.categoryId
        ? db.prepare('SELECT ticker FROM budget_categories WHERE id = ?').get(body.data.categoryId) as { ticker: string | null } | undefined
        : undefined
      const newTicker = updCatTickerRow?.ticker ?? body.data.investmentTicker ?? null
      const newQuantity = body.data.investmentQuantity ?? null

      db.prepare(
        `UPDATE transactions SET date = ?, account_id = ?, payee = ?, description = ?, amount = ?,
         category_id = ?, ignore_rules = ?, investment_ticker = ?, investment_quantity = ?, updated_at = ? WHERE id = ?`,
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
            : resolvedCategoryId,
        ignoreRules ? 1 : 0,
        newTicker,
        newQuantity,
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

    // Recalculate investment holdings if this transaction has or had a ticker
    const resolvedCatTickerRow = body.data.categoryId
      ? db.prepare('SELECT ticker FROM budget_categories WHERE id = ?').get(body.data.categoryId) as { ticker: string | null } | undefined
      : undefined
    const resolvedNewTicker = resolvedCatTickerRow?.ticker ?? body.data.investmentTicker ?? null
    if (resolvedNewTicker || existing.investment_ticker) {
      recalculateHoldings(body.data.accountId)
      if (resolvedNewTicker) {
        const priceExists = db.prepare('SELECT ticker FROM share_prices WHERE ticker = ?').get(resolvedNewTicker)
        if (!priceExists) {
          fetchAndCachePrice(resolvedNewTicker).catch((err) => console.error(`[investments] Price fetch failed for ${resolvedNewTicker}:`, err))
        }
      }
    }

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

    // Collect IDs to delete including transfer pair counterparts (handles transfers and covers)
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
      .prepare('SELECT id, type, transfer_pair_id, amount, date, account_id, investment_ticker FROM transactions WHERE id = ?')
      .get(id) as
      | { id: number; type: string; transfer_pair_id: number | null; amount: number; date: string; account_id: number; investment_ticker: string | null }
      | undefined

    if (!tx) return reply.code(404).send({ error: 'Transaction not found' })

    // Delete both legs if it's a transfer or cover.
    // Clear transfer_pair_id on both rows first to avoid the circular FK constraint.
    if (tx.transfer_pair_id) {
      db.prepare('UPDATE transactions SET transfer_pair_id = NULL WHERE id IN (?, ?)').run(id, tx.transfer_pair_id)
      db.prepare('DELETE FROM transactions WHERE id = ?').run(tx.transfer_pair_id)
    }
    db.prepare('DELETE FROM transactions WHERE id = ?').run(id)

    if (tx.investment_ticker) {
      recalculateHoldings(tx.account_id)
    }

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

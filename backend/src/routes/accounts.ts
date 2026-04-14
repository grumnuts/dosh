import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db/client'
import { authenticate } from '../middleware/auth'
import { logAudit } from '../utils/audit'
import { todayString } from '../utils/dates'
import { recordBudgetChange } from '../services/budget'

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
  goalAmount: z.number().int().optional().nullable(),
  goalTargetDate: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(),
})

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/accounts', { preHandler: authenticate }, async (req, reply) => {
    const db = getDb()
    const includeClosed = (req.query as Record<string, string>).includeClosed === 'true'
    const accounts = db
      .prepare(
        `SELECT a.id, a.name, a.type, a.starting_balance, a.notes, a.sort_order, a.goal_amount, a.goal_target_date, a.closed_at,
                COALESCE(SUM(t.amount), 0) as transaction_total,
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
                ELSE 0 END as categorized_payment_total
         FROM accounts a
         LEFT JOIN transactions t ON t.account_id = a.id
         WHERE a.is_active = 1${includeClosed ? '' : ' AND a.closed_at IS NULL'}
         GROUP BY a.id
         ORDER BY a.closed_at IS NOT NULL, a.sort_order, a.name`,
      )
      .all() as Array<{
      id: number
      name: string
      type: string
      starting_balance: number
      notes: string | null
      sort_order: number
      goal_amount: number | null
      goal_target_date: string | null
      closed_at: string | null
      transaction_total: number
      categorized_payment_total: number
    }>

    return reply.send(
      accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currentBalance: a.starting_balance + a.transaction_total + a.categorized_payment_total,
        notes: a.notes,
        sortOrder: a.sort_order,
        goalAmount: a.goal_amount,
        goalTargetDate: a.goal_target_date,
        closedAt: a.closed_at,
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

    // Auto-create a linked budget category for debt accounts
    if (body.data.type === 'debt') {
      const debtGroup = db
        .prepare('SELECT id FROM budget_groups WHERE is_debt = 1 LIMIT 1')
        .get() as { id: number } | undefined

      if (debtGroup) {
        const maxCatOrder = (
          db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM budget_categories WHERE group_id = ?')
            .get(debtGroup.id) as { m: number }
        ).m

        const catResult = db
          .prepare(
            `INSERT INTO budget_categories (group_id, name, budgeted_amount, period, linked_account_id, is_system, sort_order, created_at, updated_at)
             VALUES (?, ?, 0, 'monthly', ?, 1, ?, ?, ?)`,
          )
          .run(debtGroup.id, body.data.name, id, maxCatOrder + 1, now, now)

        const catId = catResult.lastInsertRowid as number
        recordBudgetChange(catId, 0, 'monthly', request.user!.id)
      }
    }

    // Auto-create a linked budget category for savings accounts
    if (body.data.type === 'savings') {
      const savingsGroup = db
        .prepare('SELECT id FROM budget_groups WHERE is_savings = 1 LIMIT 1')
        .get() as { id: number } | undefined

      if (savingsGroup) {
        const maxCatOrder = (
          db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM budget_categories WHERE group_id = ?')
            .get(savingsGroup.id) as { m: number }
        ).m

        const catResult = db
          .prepare(
            `INSERT INTO budget_categories (group_id, name, budgeted_amount, period, linked_account_id, is_system, sort_order, created_at, updated_at)
             VALUES (?, ?, 0, 'monthly', ?, 1, ?, ?, ?)`,
          )
          .run(savingsGroup.id, body.data.name, id, maxCatOrder + 1, now, now)

        const catId = catResult.lastInsertRowid as number
        recordBudgetChange(catId, 0, 'monthly', request.user!.id)
      }
    }

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'account.created',
      entityType: 'account',
      entityId: id,
      details: { name: body.data.name, type: body.data.type },
      ipAddress: request.ip,
    })

    return reply.code(201).send({ id })
  })

  app.patch('/api/accounts/reorder', { preHandler: authenticate }, async (request, reply) => {
    const body = z.array(z.object({ id: z.number().int(), sortOrder: z.number().int() })).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid input' })
    const db = getDb()
    const stmt = db.prepare('UPDATE accounts SET sort_order = ? WHERE id = ?')
    for (const { id, sortOrder } of body.data) stmt.run(sortOrder, id)
    return reply.send({ ok: true })
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

    const updatedAt = new Date().toISOString()

    db.prepare(
      `UPDATE accounts SET name = ?, type = ?, notes = ?, sort_order = COALESCE(?, sort_order), goal_amount = ?, goal_target_date = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      body.data.name,
      body.data.type,
      body.data.notes ?? null,
      body.data.sortOrder ?? null,
      body.data.goalAmount ?? null,
      body.data.goalTargetDate ?? null,
      updatedAt,
      id,
    )

    // Keep the linked debt/savings category name in sync, or create one if type changed
    if (body.data.type === 'debt' || body.data.type === 'savings') {
      const groupFlag = body.data.type === 'debt' ? 'is_debt' : 'is_savings'
      const targetGroup = db
        .prepare(`SELECT id FROM budget_groups WHERE ${groupFlag} = 1 LIMIT 1`)
        .get() as { id: number } | undefined

      const existingCat = targetGroup
        ? db.prepare('SELECT id FROM budget_categories WHERE linked_account_id = ? AND group_id = ?')
            .get(id, targetGroup.id) as { id: number } | undefined
        : undefined

      if (existingCat) {
        if (body.data.name !== existing.name) {
          db.prepare('UPDATE budget_categories SET name = ?, updated_at = ? WHERE id = ?')
            .run(body.data.name, updatedAt, existingCat.id)
        }
      } else if (targetGroup) {
        const maxCatOrder = (
          db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM budget_categories WHERE group_id = ?')
            .get(targetGroup.id) as { m: number }
        ).m

        const catResult = db
          .prepare(
            `INSERT INTO budget_categories (group_id, name, budgeted_amount, period, linked_account_id, is_system, sort_order, created_at, updated_at)
             VALUES (?, ?, 0, 'monthly', ?, 1, ?, ?, ?)`,
          )
          .run(targetGroup.id, body.data.name, id, maxCatOrder + 1, updatedAt, updatedAt)

        recordBudgetChange(catResult.lastInsertRowid as number, 0, 'monthly', request.user!.id)
      }
    }

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'account.updated',
      entityType: 'account',
      entityId: parseInt(id, 10),
      details: { name: body.data.name },
      ipAddress: request.ip,
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
    const txDate = body.data.date ?? todayString()

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
      ipAddress: request.ip,
    })

    return reply.send({ ok: true, adjustment, transactionId })
  })

  app.post('/api/accounts/:id/close', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({ transferToAccountId: z.number().int().optional() }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid input' })

    const db = getDb()

    const account = db
      .prepare(
        `SELECT a.id, a.name, a.type, a.starting_balance,
                COALESCE(SUM(t.amount), 0) as transaction_total,
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
                ELSE 0 END as categorized_payment_total
         FROM accounts a
         LEFT JOIN transactions t ON t.account_id = a.id
         WHERE a.id = ? AND a.is_active = 1 AND a.closed_at IS NULL
         GROUP BY a.id`,
      )
      .get(id) as { id: number; name: string; type: string; starting_balance: number; transaction_total: number; categorized_payment_total: number } | undefined

    if (!account) return reply.code(404).send({ error: 'Account not found or already closed' })

    const currentBalance = account.starting_balance + account.transaction_total + account.categorized_payment_total

    if (currentBalance < 0) {
      return reply.code(400).send({ error: 'Account cannot be closed while the balance is negative. Please zero the account before closing.' })
    }

    if (currentBalance > 0 && !body.data.transferToAccountId) {
      return reply.code(400).send({ error: 'Account has a positive balance. Provide transferToAccountId to transfer funds before closing.' })
    }

    const now = new Date().toISOString()

    if (currentBalance > 0 && body.data.transferToAccountId) {
      // Create a transfer pair to zero out the closing account:
      //   closing account gets -currentBalance (zeroes it out)
      //   target account gets +currentBalance
      const txDate = now.slice(0, 10)

      const fromResult = db
        .prepare(
          `INSERT INTO transactions (date, account_id, payee, amount, type, ignore_rules, created_at, updated_at, created_by)
           VALUES (?, ?, 'Account Closed', ?, 'transfer', 1, ?, ?, ?)`,
        )
        .run(txDate, account.id, -currentBalance, now, now, request.user!.id)

      const fromId = fromResult.lastInsertRowid as number

      const toResult = db
        .prepare(
          `INSERT INTO transactions (date, account_id, payee, amount, type, transfer_pair_id, ignore_rules, created_at, updated_at, created_by)
           VALUES (?, ?, 'Account Closed', ?, 'transfer', ?, 1, ?, ?, ?)`,
        )
        .run(txDate, body.data.transferToAccountId, currentBalance, fromId, now, now, request.user!.id)

      const toId = toResult.lastInsertRowid as number
      db.prepare('UPDATE transactions SET transfer_pair_id = ? WHERE id = ?').run(toId, fromId)
    }

    db.prepare('UPDATE accounts SET closed_at = ?, updated_at = ? WHERE id = ?').run(now, now, account.id)

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'account.closed',
      entityType: 'account',
      entityId: account.id,
      details: { name: account.name, balanceTransferred: currentBalance !== 0, transferToAccountId: body.data.transferToAccountId },
      ipAddress: request.ip,
    })

    return reply.send({ ok: true })
  })

  app.post('/api/accounts/:id/reopen', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const db = getDb()

    const account = db
      .prepare('SELECT id, name FROM accounts WHERE id = ? AND is_active = 1 AND closed_at IS NOT NULL')
      .get(id) as { id: number; name: string } | undefined

    if (!account) return reply.code(404).send({ error: 'Account not found or not closed' })

    const now = new Date().toISOString()
    db.prepare('UPDATE accounts SET closed_at = NULL, updated_at = ? WHERE id = ?').run(now, account.id)

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'account.reopened',
      entityType: 'account',
      entityId: account.id,
      details: { name: account.name },
      ipAddress: request.ip,
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

    const now = new Date().toISOString()

    // Soft delete to preserve transaction history
    db.prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?').run(now, id)

    // Deactivate the linked debt category if one exists
    db.prepare(
      'UPDATE budget_categories SET is_active = 0, updated_at = ? WHERE linked_account_id = ?',
    ).run(now, account.id)

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'account.deleted',
      entityType: 'account',
      entityId: account.id,
      details: { name: account.name },
      ipAddress: request.ip,
    })

    return reply.send({ ok: true })
  })
}

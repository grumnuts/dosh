import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db/client'
import { authenticate } from '../middleware/auth'
import { logAudit } from '../utils/audit'
import { todayString } from '../utils/dates'
import {
  getBudgetWeek,
  getCategoryBalance,
  getCategoryOverspendAmount,
  getNextPeriodStart,
  computePeriodStart,
  recordBudgetChange,
} from '../services/budget'

export async function budgetRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/budget/week/:weekStart — full budget for a Sunday
  app.get('/api/budget/week/:weekStart', { preHandler: authenticate }, async (request, reply) => {
    const { weekStart } = request.params as { weekStart: string }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return reply.code(400).send({ error: 'Invalid weekStart format. Use YYYY-MM-DD' })
    }
    return reply.send(getBudgetWeek(weekStart))
  })

  // --- Groups ---

  app.get('/api/budget/groups', { preHandler: authenticate }, async (_req, reply) => {
    const db = getDb()
    const groups = db
      .prepare('SELECT id, name, sort_order, is_income, is_debt, is_savings, is_investments FROM budget_groups WHERE is_active = 1 ORDER BY sort_order, name')
      .all()
    return reply.send(groups)
  })

  app.post('/api/budget/groups', { preHandler: authenticate }, async (request, reply) => {
    const body = z
      .object({ name: z.string().min(1).max(128), isIncome: z.boolean().optional().default(false) })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid input' })

    const db = getDb()
    const now = new Date().toISOString()
    const maxOrder = (
      db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM budget_groups')
        .get() as { m: number }
    ).m

    const result = db
      .prepare(
        'INSERT INTO budget_groups (name, is_income, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(body.data.name, body.data.isIncome ? 1 : 0, maxOrder + 1, now, now)

    const id = result.lastInsertRowid as number

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'budget_group.created',
      entityType: 'budget_group',
      entityId: id,
      details: { name: body.data.name },
      ipAddress: request.ip,
    })

    return reply.code(201).send({ id })
  })

  app.patch('/api/budget/groups/reorder', { preHandler: authenticate }, async (request, reply) => {
    const body = z.array(z.object({ id: z.number().int(), sortOrder: z.number().int() })).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid input' })
    const db = getDb()
    const stmt = db.prepare('UPDATE budget_groups SET sort_order = ? WHERE id = ?')
    for (const { id, sortOrder } of body.data) stmt.run(sortOrder, id)
    return reply.send({ ok: true })
  })

  app.put('/api/budget/groups/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z
      .object({ name: z.string().min(1).max(128), sortOrder: z.number().int().optional() })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid input' })

    const db = getDb()
    const existing = db.prepare('SELECT id FROM budget_groups WHERE id = ? AND is_active = 1').get(id)
    if (!existing) return reply.code(404).send({ error: 'Group not found' })

    db.prepare('UPDATE budget_groups SET name = ?, sort_order = COALESCE(?, sort_order), updated_at = ? WHERE id = ?').run(
      body.data.name,
      body.data.sortOrder ?? null,
      new Date().toISOString(),
      id,
    )

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'budget_group.updated',
      entityType: 'budget_group',
      entityId: parseInt(id, 10),
      details: { name: body.data.name },
      ipAddress: request.ip,
    })

    return reply.send({ ok: true })
  })

  app.delete('/api/budget/groups/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const db = getDb()

    const group = db.prepare('SELECT id, name, is_income, is_debt, is_savings, is_investments FROM budget_groups WHERE id = ? AND is_active = 1').get(id) as
      | { id: number; name: string; is_income: number; is_debt: number; is_savings: number; is_investments: number }
      | undefined
    if (!group) return reply.code(404).send({ error: 'Group not found' })
    if (group.is_debt) return reply.code(400).send({ error: 'The Debt group cannot be deleted' })
    if (group.is_income) return reply.code(400).send({ error: 'Income groups cannot be deleted' })
    if (group.is_savings) return reply.code(400).send({ error: 'The Savings group cannot be deleted' })
    if (group.is_investments) return reply.code(400).send({ error: 'The Investments group cannot be deleted' })

    const catCount = (
      db
        .prepare('SELECT COUNT(*) as c FROM budget_categories WHERE group_id = ? AND is_active = 1')
        .get(id) as { c: number }
    ).c
    if (catCount > 0) {
      return reply.code(400).send({ error: 'Remove all categories from this group first' })
    }

    db.prepare('UPDATE budget_groups SET is_active = 0, updated_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      id,
    )

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'budget_group.deleted',
      entityType: 'budget_group',
      entityId: group.id,
      details: { name: group.name },
      ipAddress: request.ip,
    })

    return reply.send({ ok: true })
  })

  // --- Categories ---

  app.get('/api/budget/categories', { preHandler: authenticate }, async (_req, reply) => {
    const db = getDb()
    const cats = db
      .prepare(
        `SELECT id, group_id, name, budgeted_amount, period, notes, sort_order, is_investment, ticker
         FROM budget_categories WHERE is_active = 1 AND is_unlisted = 0 ORDER BY sort_order, name`,
      )
      .all()
    return reply.send(cats)
  })

  const categorySchema = z.object({
    groupId: z.number().int(),
    name: z.string().min(1).max(128),
    budgetedAmount: z.number().int().min(0),
    period: z.enum(['weekly', 'fortnightly', 'monthly', 'quarterly', 'annually']),
    notes: z.string().max(500).optional().nullable(),
    sortOrder: z.number().int().optional(),
    catchUp: z.boolean().optional(),
    catchUpWeekStart: z.string().optional(),
    effectiveWeekStart: z.string().date().optional(),
    isInvestment: z.boolean().optional().default(false),
    isUnlisted: z.boolean().optional().default(false),
    ticker: z.string().max(20).toUpperCase().optional().nullable(),
  })

  app.post('/api/budget/categories', { preHandler: authenticate }, async (request, reply) => {
    const body = categorySchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid input', issues: body.error.issues })

    const db = getDb()
    const groupExists = db
      .prepare('SELECT id FROM budget_groups WHERE id = ? AND is_active = 1')
      .get(body.data.groupId)
    if (!groupExists) return reply.code(400).send({ error: 'Group not found' })

    const now = new Date().toISOString()
    const maxOrder = (
      db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM budget_categories WHERE group_id = ?')
        .get(body.data.groupId) as { m: number }
    ).m

    const ticker = body.data.ticker ?? null
    const catchUpPeriodStart = body.data.catchUp && body.data.catchUpWeekStart
      ? computePeriodStart(body.data.catchUpWeekStart, body.data.period)
      : null
    const result = db
      .prepare(
        `INSERT INTO budget_categories (group_id, name, budgeted_amount, period, notes, sort_order, catch_up, catch_up_period_start, is_investment, is_unlisted, ticker, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        body.data.groupId,
        body.data.name,
        body.data.budgetedAmount,
        body.data.period,
        body.data.notes ?? null,
        body.data.sortOrder ?? maxOrder + 1,
        body.data.catchUp ? 1 : 0,
        catchUpPeriodStart,
        ticker !== null ? 1 : (body.data.isInvestment ? 1 : 0),
        body.data.isUnlisted ? 1 : 0,
        ticker,
        now,
        now,
      )

    const id = result.lastInsertRowid as number

    // Seed the initial budget history record so historical lookups always find a value.
    recordBudgetChange(id, body.data.budgetedAmount, body.data.period, request.user!.id)

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'budget_category.created',
      entityType: 'budget_category',
      entityId: id,
      details: { name: body.data.name, period: body.data.period, amount: body.data.budgetedAmount },
      ipAddress: request.ip,
    })

    return reply.code(201).send({ id })
  })

  app.patch('/api/budget/categories/reorder', { preHandler: authenticate }, async (request, reply) => {
    const body = z.array(z.object({ id: z.number().int(), sortOrder: z.number().int() })).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid input' })
    const db = getDb()
    const stmt = db.prepare('UPDATE budget_categories SET sort_order = ? WHERE id = ?')
    for (const { id, sortOrder } of body.data) stmt.run(sortOrder, id)
    return reply.send({ ok: true })
  })

  app.put('/api/budget/categories/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = categorySchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid input', issues: body.error.issues })

    const db = getDb()
    const existing = db
      .prepare('SELECT id, name, group_id, budgeted_amount, period, is_unlisted, linked_account_id FROM budget_categories WHERE id = ? AND is_active = 1')
      .get(id) as { id: number; name: string; group_id: number; budgeted_amount: number; period: string; is_unlisted: number; linked_account_id: number | null } | undefined

    if (!existing) return reply.code(404).send({ error: 'Category not found' })
    if (existing.is_unlisted) return reply.code(400).send({ error: 'System categories cannot be edited' })

    // Debt categories: prevent moving to another group or renaming (name is controlled by account)
    if (existing.linked_account_id !== null) {
      if (body.data.groupId !== existing.group_id) {
        return reply.code(400).send({ error: 'Debt payment categories cannot be moved to another group' })
      }
    }

    const amountChanged =
      existing.budgeted_amount !== body.data.budgetedAmount || existing.period !== body.data.period

    // For debt categories, ignore any name change from the client — name is controlled by the account
    const nameToSave = existing.linked_account_id !== null ? existing.name : body.data.name

    const tickerToSave = body.data.ticker ?? null
    const catchUpPeriodStartUpdate = body.data.catchUp && body.data.catchUpWeekStart
      ? computePeriodStart(body.data.catchUpWeekStart, body.data.period)
      : null
    db.prepare(
      `UPDATE budget_categories SET group_id = ?, name = ?, budgeted_amount = ?, period = ?,
       notes = ?, sort_order = COALESCE(?, sort_order), catch_up = ?, catch_up_period_start = ?,
       is_investment = ?, is_unlisted = ?, ticker = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      body.data.groupId,
      nameToSave,
      body.data.budgetedAmount,
      body.data.period,
      body.data.notes ?? null,
      body.data.sortOrder ?? null,
      body.data.catchUp ? 1 : 0,
      catchUpPeriodStartUpdate,
      tickerToSave !== null ? 1 : (body.data.isInvestment ? 1 : 0),
      body.data.isUnlisted ? 1 : 0,
      tickerToSave,
      new Date().toISOString(),
      id,
    )

    if (amountChanged) {
      recordBudgetChange(
        parseInt(id, 10),
        body.data.budgetedAmount,
        body.data.period,
        request.user!.id,
        body.data.effectiveWeekStart,
      )

      logAudit({
        userId: request.user!.id,
        username: request.user!.username,
        eventType: 'budget.amount_changed',
        entityType: 'budget_category',
        entityId: parseInt(id, 10),
        details: {
          name: nameToSave,
          oldAmount: existing.budgeted_amount,
          newAmount: body.data.budgetedAmount,
          oldPeriod: existing.period,
          newPeriod: body.data.period,
        },
        ipAddress: request.ip,
      })
    } else {
      logAudit({
        userId: request.user!.id,
        username: request.user!.username,
        eventType: 'budget_category.updated',
        entityType: 'budget_category',
        entityId: parseInt(id, 10),
        details: { name: nameToSave },
        ipAddress: request.ip,
      })
    }

    return reply.send({ ok: true })
  })

  app.delete('/api/budget/categories/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const db = getDb()

    const cat = db
      .prepare('SELECT id, name, is_system FROM budget_categories WHERE id = ? AND is_active = 1')
      .get(id) as { id: number; name: string; is_system: number } | undefined
    if (!cat) return reply.code(404).send({ error: 'Category not found' })
    if (cat.is_system) return reply.code(400).send({ error: 'System categories cannot be deleted' })

    db.prepare('UPDATE budget_categories SET is_active = 0, updated_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      id,
    )

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'budget_category.deleted',
      entityType: 'budget_category',
      entityId: cat.id,
      details: { name: cat.name },
      ipAddress: request.ip,
    })

    return reply.send({ ok: true })
  })

  // --- Cover Overspend ---

  app.post('/api/budget/cover', { preHandler: authenticate }, async (request, reply) => {
    const sourceSchema = z.object({
      kind: z.enum(['account', 'category']),
      amount: z.number().int().positive(),
      accountId: z.number().int().optional(),
      categoryId: z.number().int().optional(),
    }).refine((value) => {
      if (value.kind === 'account') return value.accountId !== undefined
      return value.categoryId !== undefined
    }, { message: 'Account or category source is required' })

    const body = z
      .object({
        categoryId: z.number().int(),
        weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        sourceAccountId: z.number().int().optional(),
        destinationAccountId: z.number().int(),
        amount: z.number().int().positive().optional(),
        sources: z.array(sourceSchema).optional(),
      })
      .refine((value) => {
        if (Array.isArray(value.sources) && value.sources.length > 0) return true
        return value.sourceAccountId !== undefined
      }, { message: 'At least one source is required' })
      .safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid input', issues: body.error.issues })
    }

    const { categoryId, weekStart, destinationAccountId } = body.data
    const db = getDb()

    const overspendAmount = getCategoryOverspendAmount(categoryId, weekStart)
    if (overspendAmount <= 0) {
      return reply.code(400).send({ error: 'Category is not overspent' })
    }

    type CoverSource =
      | { kind: 'account'; accountId: number; amount: number }
      | { kind: 'category'; categoryId: number; amount: number }
    const legacySourceAccountId = body.data.sourceAccountId
    const sources: CoverSource[] = body.data.sources && body.data.sources.length > 0
      ? body.data.sources.map((source) => source.kind === 'account'
        ? { kind: 'account', accountId: source.accountId!, amount: source.amount }
        : { kind: 'category', categoryId: source.categoryId!, amount: source.amount })
      : [{ kind: 'account', accountId: legacySourceAccountId!, amount: body.data.amount ?? overspendAmount }]

    const totalCovered = sources.reduce((sum, source) => sum + source.amount, 0)
    if (totalCovered > overspendAmount) {
      return reply.code(400).send({ error: 'Cover amount exceeds the category overspend' })
    }

    const destAccount = db
      .prepare('SELECT id, name FROM accounts WHERE id = ? AND is_active = 1')
      .get(destinationAccountId) as { id: number; name: string } | undefined
    if (!destAccount) {
      return reply.code(400).send({ error: 'Destination account not found' })
    }

    const cat = db
      .prepare('SELECT name FROM budget_categories WHERE id = ?')
      .get(categoryId) as { name: string } | undefined
    if (!cat) return reply.code(404).send({ error: 'Category not found' })

    const now = new Date().toISOString()
    const today = todayString()
    const payee = 'Cover Overspend'
    const description = `Cover overspend: ${cat.name}`

    const insertedSourceDetails: Array<{ type: 'account' | 'category'; id: number; name: string; amount: number }> = []
    const insertCoverLeg = (accountId: number, categoryIdForTransaction: number | null, amount: number) => {
      const result = db
        .prepare(
          `INSERT INTO transactions (date, account_id, payee, description, amount, category_id, type, cover_week_start, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'cover', ?, ?, ?, ?)`,
        )
        .run(today, accountId, payee, description, amount, categoryIdForTransaction, weekStart, now, now, request.user!.id)
      return result.lastInsertRowid as number
    }

    for (const source of sources) {
      if (source.kind === 'account') {
        const sourceAccountId = source.accountId!
        const sourceAccount = db
          .prepare(`SELECT a.id, a.name, a.starting_balance + COALESCE(SUM(t.amount), 0) AS current_balance
                    FROM accounts a
                    LEFT JOIN transactions t ON t.account_id = a.id
                    WHERE a.id = ? AND a.is_active = 1 AND a.type = 'savings'
                    GROUP BY a.id`)
          .get(sourceAccountId) as { id: number; name: string; current_balance: number } | undefined

        if (!sourceAccount) {
          return reply.code(400).send({ error: 'Source savings account not found' })
        }
        if (source.amount > sourceAccount.current_balance) {
          return reply.code(400).send({ error: `Source account ${sourceAccount.name} does not have enough balance to cover that amount` })
        }

        const debitId = insertCoverLeg(sourceAccountId, categoryId, -source.amount)
        const creditId = insertCoverLeg(destinationAccountId, categoryId, source.amount)
        db.prepare('UPDATE transactions SET transfer_pair_id = ? WHERE id = ?').run(creditId, debitId)
        insertedSourceDetails.push({ type: 'account', id: sourceAccountId, name: sourceAccount.name, amount: source.amount })
        continue
      }

      if (source.kind !== 'category') continue
      const sourceCategoryId = source.categoryId!
      const sourceCategory = db
        .prepare('SELECT id, name FROM budget_categories WHERE id = ? AND is_active = 1')
        .get(sourceCategoryId) as { id: number; name: string } | undefined
      if (!sourceCategory) {
        return reply.code(400).send({ error: 'Source category not found' })
      }
      if (sourceCategoryId === categoryId) {
        return reply.code(400).send({ error: 'A category cannot cover itself' })
      }

      const sourceAvailable = getCategoryBalance(sourceCategoryId, weekStart)
      if (sourceAvailable <= 0 || source.amount > sourceAvailable) {
        return reply.code(400).send({ error: `Category ${sourceCategory.name} does not have enough remaining balance to cover that amount` })
      }

      const debitId = insertCoverLeg(destinationAccountId, sourceCategoryId, -source.amount)
      const creditId = insertCoverLeg(destinationAccountId, categoryId, source.amount)
      db.prepare('UPDATE transactions SET transfer_pair_id = ? WHERE id = ?').run(creditId, debitId)
      insertedSourceDetails.push({ type: 'category', id: sourceCategoryId, name: sourceCategory.name, amount: source.amount })
    }

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'budget.overspend_covered',
      entityType: 'budget_category',
      entityId: categoryId,
      details: {
        categoryName: cat.name,
        weekStart,
        amount: totalCovered,
        sourceDetails: insertedSourceDetails,
        destinationAccount: destAccount.name,
      },
      ipAddress: request.ip,
    })

    return reply.send({
      ok: true,
      amount: totalCovered,
      sourceDetails: insertedSourceDetails,
    })
  })

  // --- Sweep Unspent ---

  app.post('/api/budget/sweep', { preHandler: authenticate }, async (request, reply) => {
    const body = z
      .object({
        categoryId: z.number().int(),
        weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        amount: z.number().int().positive(),
        sourceAccountId: z.number().int(),
        destinations: z.array(z.object({
          kind: z.enum(['account', 'category']),
          id: z.number().int(),
          amount: z.number().int().positive(),
        })).min(1),
      })
      .safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid input', issues: body.error.issues })
    }

    const { categoryId, weekStart, amount: sweepAmount, sourceAccountId, destinations } = body.data
    const db = getDb()

    if (destinations.reduce((total, destination) => total + destination.amount, 0) !== sweepAmount) {
      return reply.code(400).send({ error: 'Destination amounts must equal the sweep amount' })
    }

    const availableBalance = getCategoryBalance(categoryId, weekStart)
    if (availableBalance <= 0) {
      return reply.code(400).send({ error: 'Category has no unspent balance to sweep' })
    }
    if (sweepAmount > availableBalance) {
      return reply.code(400).send({ error: 'Sweep amount exceeds available balance' })
    }

    const sourceAccount = db
      .prepare('SELECT id, name FROM accounts WHERE id = ? AND is_active = 1')
      .get(sourceAccountId) as { id: number; name: string } | undefined
    if (!sourceAccount) {
      return reply.code(400).send({ error: 'Source account not found' })
    }

    const cat = db
      .prepare('SELECT name FROM budget_categories WHERE id = ?')
      .get(categoryId) as { name: string } | undefined
    if (!cat) return reply.code(404).send({ error: 'Category not found' })

    const destinationDetails: Array<typeof destinations[number] & { name: string }> = []
    for (const destination of destinations) {
      if (destination.kind === 'account') {
        const account = db
          .prepare("SELECT id, name FROM accounts WHERE id = ? AND is_active = 1 AND type = 'savings'")
          .get(destination.id) as { id: number; name: string } | undefined
        if (!account) return reply.code(400).send({ error: 'Destination savings account not found' })
        destinationDetails.push({ ...destination, name: account.name })
        continue
      }

      if (destination.id === categoryId) {
        return reply.code(400).send({ error: 'Cannot sweep into the source category' })
      }
      const destinationCategory = db
        .prepare('SELECT id, name FROM budget_categories WHERE id = ? AND is_active = 1 AND is_unlisted = 0')
        .get(destination.id) as { id: number; name: string } | undefined
      if (!destinationCategory) return reply.code(400).send({ error: 'Destination category not found' })
      destinationDetails.push({ ...destination, name: destinationCategory.name })
    }

    const now = new Date().toISOString()
    const today = todayString()
    const payee = 'Sweep'
    const description = `Sweep unspent: ${cat.name}`

    const transactionIds: Array<{ debitTransactionId: number; creditTransactionId: number }> = []
    for (const destination of destinationDetails) {
      const debitResult = db
        .prepare(
          `INSERT INTO transactions (date, account_id, payee, description, amount, category_id, type, cover_week_start, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'sweep', ?, ?, ?, ?)`,
        )
        .run(today, sourceAccountId, payee, `${description} to ${destination.name}`, -destination.amount, categoryId, weekStart, now, now, request.user!.id)

      const debitId = debitResult.lastInsertRowid as number
      const creditAccountId = destination.kind === 'account' ? destination.id : sourceAccountId
      const creditCategoryId = destination.kind === 'category' ? destination.id : null
      const creditResult = db
        .prepare(
          `INSERT INTO transactions (date, account_id, payee, description, amount, category_id, type, cover_week_start, transfer_pair_id, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'sweep', ?, ?, ?, ?, ?)`,
        )
        .run(today, creditAccountId, payee, `${description} from ${cat.name}`, destination.amount, creditCategoryId, weekStart, debitId, now, now, request.user!.id)

      const creditId = creditResult.lastInsertRowid as number
      db.prepare('UPDATE transactions SET transfer_pair_id = ? WHERE id = ?').run(creditId, debitId)
      transactionIds.push({ debitTransactionId: debitId, creditTransactionId: creditId })
    }

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'budget.unspent_swept',
      entityType: 'budget_category',
      entityId: categoryId,
      details: {
        categoryName: cat.name,
        weekStart,
        amount: sweepAmount,
        sourceAccount: sourceAccount.name,
        destinations: destinationDetails.map((destination) => ({
          kind: destination.kind,
          name: destination.name,
          amount: destination.amount,
        })),
      },
      ipAddress: request.ip,
    })

    return reply.send({
      ok: true,
      transactions: transactionIds,
      amount: sweepAmount,
    })
  })

  // --- Roll Forward Balance ---

  app.post('/api/budget/rollover', { preHandler: authenticate }, async (request, reply) => {
    const body = z
      .object({
        categoryId: z.number().int(),
        weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        amount: z.number().int().positive(),
      })
      .safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid input', issues: body.error.issues })
    }

    const { categoryId, weekStart, amount: rollAmount } = body.data
    const db = getDb()

    const cat = db
      .prepare('SELECT id, name, period FROM budget_categories WHERE id = ? AND is_active = 1')
      .get(categoryId) as { id: number; name: string; period: string } | undefined
    if (!cat) return reply.code(404).send({ error: 'Category not found' })

    const balance = getCategoryBalance(categoryId, weekStart)
    if (balance === 0) {
      return reply.code(400).send({ error: 'Category has no balance to roll forward' })
    }
    if (rollAmount > Math.abs(balance)) {
      return reply.code(400).send({ error: 'Roll amount exceeds the category balance' })
    }

    const destPeriodStart = getNextPeriodStart(weekStart, cat.period)
    const signedAmount = balance < 0 ? -rollAmount : rollAmount
    const now = new Date().toISOString()

    let result
    try {
      result = db
        .prepare(
          `INSERT INTO budget_rollovers (category_id, source_week_start, dest_period_start, amount, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(categoryId, weekStart, destPeriodStart, signedAmount, now, request.user!.id)
    } catch {
      return reply.code(409).send({ error: 'A rollover already exists for this category and period' })
    }

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'budget.balance_rolled_forward',
      entityType: 'budget_category',
      entityId: categoryId,
      details: { categoryName: cat.name, weekStart, destPeriodStart, amount: signedAmount },
      ipAddress: request.ip,
    })

    return reply.send({ ok: true, id: result.lastInsertRowid, amount: signedAmount, destPeriodStart })
  })

  app.delete('/api/budget/rollover/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const rolloverId = parseInt(id, 10)
    if (isNaN(rolloverId)) return reply.code(400).send({ error: 'Invalid rollover id' })

    const db = getDb()
    const rollover = db
      .prepare(
        `SELECT br.id, br.category_id, br.amount, br.source_week_start, bc.name
         FROM budget_rollovers br JOIN budget_categories bc ON bc.id = br.category_id
         WHERE br.id = ?`,
      )
      .get(rolloverId) as { id: number; category_id: number; amount: number; source_week_start: string; name: string } | undefined

    if (!rollover) return reply.code(404).send({ error: 'Rollover not found' })

    db.prepare('DELETE FROM budget_rollovers WHERE id = ?').run(rolloverId)

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'budget.rollover_undone',
      entityType: 'budget_category',
      entityId: rollover.category_id,
      details: { categoryName: rollover.name, weekStart: rollover.source_week_start, amount: rollover.amount },
      ipAddress: request.ip,
    })

    return reply.send({ ok: true })
  })

  app.delete('/api/budget/cover/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const transactionId = parseInt(id, 10)
    if (isNaN(transactionId)) return reply.code(400).send({ error: 'Invalid cover id' })

    const db = getDb()
    const cover = db
      .prepare(
        `SELECT id, transfer_pair_id, category_id, amount
         FROM transactions
         WHERE id = ? AND type = 'cover' AND amount < 0`,
      )
      .get(transactionId) as { id: number; transfer_pair_id: number | null; category_id: number | null; amount: number } | undefined

    if (!cover || !cover.transfer_pair_id || cover.category_id === null) {
      return reply.code(404).send({ error: 'Category cover not found' })
    }

    db.prepare('DELETE FROM transactions WHERE id IN (?, ?)').run(transactionId, cover.transfer_pair_id)
    return reply.send({ ok: true })
  })
}

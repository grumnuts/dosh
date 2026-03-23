import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db/client'
import { authenticate } from '../middleware/auth'
import { logAudit } from '../utils/audit'
import { parseCSV, mapRows, checkDuplicates } from '../services/import'
import { applyRules } from '../services/rules'

export async function importRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/import/preview — parse and return preview with duplicate flags
  app.post('/api/import/preview', { preHandler: authenticate }, async (request, reply) => {
    const body = z
      .object({
        csvText: z.string().min(1),
        hasHeader: z.boolean(),
        accountId: z.number().int(),
        dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).default('DD/MM/YYYY'),
        mapping: z.object({
          date: z.number().int().min(0),
          payee: z.number().int().min(0).optional(),
          description: z.number().int().min(0).optional(),
          amount: z.number().int().min(0).optional(),
          debit: z.number().int().min(0).optional(),
          credit: z.number().int().min(0).optional(),
        }),
      })
      .safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid input', issues: body.error.issues })
    }

    const { csvText, hasHeader, accountId, dateFormat, mapping } = body.data

    const db = getDb()
    const account = db
      .prepare('SELECT id, name FROM accounts WHERE id = ? AND is_active = 1')
      .get(accountId) as { id: number; name: string } | undefined
    if (!account) return reply.code(400).send({ error: 'Account not found' })

    const rows = parseCSV(csvText, hasHeader)
    const parsed = mapRows(rows, mapping, dateFormat)
    const preview = checkDuplicates(parsed, db, accountId)

    return reply.send({ rows: preview, accountName: account.name })
  })

  // POST /api/import/confirm — save selected rows
  app.post('/api/import/confirm', { preHandler: authenticate }, async (request, reply) => {
    const body = z
      .object({
        accountId: z.number().int(),
        rows: z.array(
          z.object({
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            payee: z.string(),
            description: z.string(),
            amount: z.number().int(),
            skip: z.boolean(),
          }),
        ),
      })
      .safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid input', issues: body.error.issues })
    }

    const db = getDb()
    const account = db
      .prepare('SELECT id, name FROM accounts WHERE id = ? AND is_active = 1')
      .get(body.data.accountId) as { id: number; name: string } | undefined
    if (!account) return reply.code(400).send({ error: 'Account not found' })

    const toImport = body.data.rows.filter((r) => !r.skip)
    const now = new Date().toISOString()

    const insertStmt = db.prepare(
      `INSERT INTO transactions (date, account_id, payee, description, amount, category_id, type, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'transaction', ?, ?, ?)`,
    )

    db.exec('BEGIN TRANSACTION')
    try {
      for (const row of toImport) {
        const ruled = applyRules(
          {
            date: row.date,
            accountId: body.data.accountId,
            payee: row.payee || null,
            description: row.description || null,
            amount: row.amount,
            categoryId: null,
          },
          db,
        )
        insertStmt.run(
          ruled.date,
          ruled.accountId,
          ruled.payee,
          ruled.description,
          ruled.amount,
          ruled.categoryId,
          now,
          now,
          request.user!.id,
        )
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'transactions.imported',
      entityType: 'account',
      entityId: body.data.accountId,
      details: {
        count: toImport.length,
        skipped: body.data.rows.length - toImport.length,
        accountName: account.name,
      },
    })

    return reply.send({ imported: toImport.length })
  })
}

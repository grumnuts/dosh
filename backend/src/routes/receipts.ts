import { FastifyInstance } from 'fastify'
import { getDb } from '../db/client'
import { authenticate, AuthUser } from '../middleware/auth'
import { logAudit } from '../utils/audit'

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
])

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

interface ReceiptRow {
  id: number
  transaction_id: number
  filename: string
  mime_type: string
  size: number
  created_at: string
}

interface ReceiptDataRow extends ReceiptRow {
  data: Buffer
}

export async function receiptRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/receipts/:transactionId — list receipts for a transaction (metadata only)
  app.get('/api/receipts/:transactionId', { preHandler: authenticate }, async (request, reply) => {
    const transactionId = parseInt((request.params as { transactionId: string }).transactionId, 10)
    if (isNaN(transactionId)) return reply.code(400).send({ error: 'Invalid transaction ID' })

    const db = getDb()
    const tx = db.prepare('SELECT id FROM transactions WHERE id = ?').get(transactionId)
    if (!tx) return reply.code(404).send({ error: 'Transaction not found' })

    const receipts = db
      .prepare(
        'SELECT id, transaction_id, filename, mime_type, size, created_at FROM transaction_receipts WHERE transaction_id = ? ORDER BY id',
      )
      .all(transactionId) as unknown as ReceiptRow[]

    return reply.send(receipts)
  })

  // POST /api/receipts/:transactionId — upload a receipt
  app.post('/api/receipts/:transactionId', { preHandler: authenticate }, async (request, reply) => {
    const transactionId = parseInt((request.params as { transactionId: string }).transactionId, 10)
    if (isNaN(transactionId)) return reply.code(400).send({ error: 'Invalid transaction ID' })

    const db = getDb()
    const tx = db.prepare('SELECT id FROM transactions WHERE id = ?').get(transactionId)
    if (!tx) return reply.code(404).send({ error: 'Transaction not found' })

    const data = await request.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    if (!ALLOWED_MIME_TYPES.has(data.mimetype)) {
      return reply.code(400).send({ error: 'File type not allowed. Supported: JPEG, PNG, WebP, GIF, PDF' })
    }

    const buffer = await data.toBuffer()

    if (buffer.length > MAX_FILE_SIZE) {
      return reply.code(400).send({ error: 'File too large. Maximum size is 10MB' })
    }

    const now = new Date().toISOString()
    const user = request.user as AuthUser

    const result = db
      .prepare(
        `INSERT INTO transaction_receipts (transaction_id, filename, mime_type, size, data, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(transactionId, data.filename, data.mimetype, buffer.length, buffer, now, user.id)

    logAudit({
      userId: user.id,
      username: user.username,
      eventType: 'receipt.uploaded',
      entityType: 'transaction',
      entityId: transactionId,
      details: { filename: data.filename, size: buffer.length },
      ipAddress: request.ip,
    })

    return reply.send({ id: result.lastInsertRowid, filename: data.filename, mime_type: data.mimetype, size: buffer.length, created_at: now })
  })

  // GET /api/receipts/:transactionId/:receiptId — serve a receipt file inline
  app.get('/api/receipts/:transactionId/:receiptId', { preHandler: authenticate }, async (request, reply) => {
    const transactionId = parseInt((request.params as { transactionId: string; receiptId: string }).transactionId, 10)
    const receiptId = parseInt((request.params as { transactionId: string; receiptId: string }).receiptId, 10)
    if (isNaN(transactionId) || isNaN(receiptId)) return reply.code(400).send({ error: 'Invalid ID' })

    const db = getDb()
    const receipt = db
      .prepare('SELECT id, transaction_id, filename, mime_type, size, data, created_at FROM transaction_receipts WHERE id = ? AND transaction_id = ?')
      .get(receiptId, transactionId) as ReceiptDataRow | undefined

    if (!receipt) return reply.code(404).send({ error: 'Receipt not found' })

    return reply
      .header('Content-Type', receipt.mime_type)
      .header('Content-Disposition', `inline; filename="${receipt.filename}"`)
      .header('Cache-Control', 'private, max-age=3600')
      .send(receipt.data)
  })

  // DELETE /api/receipts/:transactionId/:receiptId — delete a receipt
  app.delete('/api/receipts/:transactionId/:receiptId', { preHandler: authenticate }, async (request, reply) => {
    const transactionId = parseInt((request.params as { transactionId: string; receiptId: string }).transactionId, 10)
    const receiptId = parseInt((request.params as { transactionId: string; receiptId: string }).receiptId, 10)
    if (isNaN(transactionId) || isNaN(receiptId)) return reply.code(400).send({ error: 'Invalid ID' })

    const db = getDb()
    const receipt = db
      .prepare('SELECT id, filename FROM transaction_receipts WHERE id = ? AND transaction_id = ?')
      .get(receiptId, transactionId) as { id: number; filename: string } | undefined

    if (!receipt) return reply.code(404).send({ error: 'Receipt not found' })

    db.prepare('DELETE FROM transaction_receipts WHERE id = ?').run(receiptId)

    const user = request.user as AuthUser
    logAudit({
      userId: user.id,
      username: user.username,
      eventType: 'receipt.deleted',
      entityType: 'transaction',
      entityId: transactionId,
      details: { filename: receipt.filename },
      ipAddress: request.ip,
    })

    return reply.send({ ok: true })
  })
}

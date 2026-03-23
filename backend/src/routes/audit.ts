import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db/client'
import { authenticate } from '../middleware/auth'

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/audit', { preHandler: authenticate }, async (request, reply) => {
    const query = z
      .object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        userId: z.string().optional(),
        eventType: z.string().optional(),
        search: z.string().optional(),
        limit: z.string().optional(),
        offset: z.string().optional(),
      })
      .parse(request.query)

    const db = getDb()

    let sql = `
      SELECT id, occurred_at, user_id, username, event_type, entity_type, entity_id, details
      FROM audit_log WHERE 1=1
    `
    const params: (string | number)[] = []

    if (query.startDate) {
      sql += ' AND occurred_at >= ?'
      params.push(query.startDate)
    }
    if (query.endDate) {
      // Include the full end day
      sql += ' AND occurred_at < ?'
      params.push(query.endDate + 'T23:59:59.999Z')
    }
    if (query.userId) {
      sql += ' AND user_id = ?'
      params.push(parseInt(query.userId, 10))
    }
    if (query.eventType) {
      sql += ' AND event_type = ?'
      params.push(query.eventType)
    }
    if (query.search) {
      const term = `%${query.search}%`
      sql += ' AND (username LIKE ? OR event_type LIKE ? OR details LIKE ? OR occurred_at LIKE ?)'
      params.push(term, term, term, term)
    }

    sql += ' ORDER BY occurred_at DESC'

    const limit = Math.min(parseInt(query.limit ?? '100', 10), 500)
    const offset = parseInt(query.offset ?? '0', 10)
    sql += ' LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const rows = db.prepare(sql).all(...params) as Array<{
      id: number
      occurred_at: string
      user_id: number | null
      username: string
      event_type: string
      entity_type: string | null
      entity_id: number | null
      details: string | null
    }>

    const parsed = rows.map((r) => ({
      ...r,
      details: r.details ? JSON.parse(r.details) : null,
    }))

    return reply.send(parsed)
  })
}

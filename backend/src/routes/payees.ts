import { FastifyInstance } from 'fastify'
import { getDb } from '../db/client'
import { authenticate } from '../middleware/auth'

export async function payeeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/payees', { preHandler: authenticate }, async (_req, reply) => {
    const db = getDb()
    const rows = db.prepare('SELECT id, name FROM payees ORDER BY name').all()
    return reply.send(rows)
  })
}

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db/client'
import { authenticate } from '../middleware/auth'

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', { preHandler: authenticate }, async (_req, reply) => {
    const db = getDb()
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    const settings: Record<string, string> = {}
    for (const row of rows) settings[row.key] = row.value
    return reply.send(settings)
  })

  app.put('/api/settings/:key', { preHandler: authenticate }, async (request, reply) => {
    const { key } = request.params as { key: string }
    const body = z.object({ value: z.string() }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid input' })

    const db = getDb()
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, body.data.value)

    return reply.send({ ok: true })
  })
}

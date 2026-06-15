import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import fs from 'fs'
import { getDb } from '../db/client'
import { authenticate } from '../middleware/auth'
import { version } from '../../package.json'

const settingSchemas: Record<string, z.ZodType<string>> = {
  week_start_day: z.enum(['0', '1']),
  date_format: z.enum([
    'DD/MM/YY',
    'DD/MM/YYYY',
    'MM/DD/YY',
    'MM/DD/YYYY',
    'YY/MM/DD',
    'YYYY/MM/DD',
    'YY/DD/MM',
    'YYYY/DD/MM',
  ]),
  ai_api_token: z.string(),
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', { preHandler: authenticate }, async (_req, reply) => {
    const db = getDb()
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    const settings: Record<string, string> = {}
    for (const row of rows) settings[row.key] = row.value
    return reply.send(settings)
  })

  app.get('/api/system/info', { preHandler: authenticate }, async (_req, reply) => {
    const dbPath = process.env.DB_PATH ?? './data/dosh.db'
    let dbSizeBytes: number | null = null
    try {
      dbSizeBytes = fs.statSync(dbPath).size
    } catch {
      // DB path not accessible
    }
    return reply.send({ version, uptimeSeconds: Math.floor(process.uptime()), dbSizeBytes })
  })

  app.put('/api/settings/:key', { preHandler: authenticate }, async (request, reply) => {
    const { key } = request.params as { key: string }
    const body = z.object({ value: z.string() }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'Invalid input' })
    const schema = settingSchemas[key]
    if (!schema) return reply.code(400).send({ error: 'Unknown setting' })
    const value = schema.safeParse(body.data.value)
    if (!value.success) return reply.code(400).send({ error: 'Invalid setting value' })

    const db = getDb()
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value.data)

    return reply.send({ ok: true })
  })
}

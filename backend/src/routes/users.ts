import { FastifyInstance } from 'fastify'
import argon2 from 'argon2'
import { z } from 'zod'
import { getDb } from '../db/client'
import { authenticate } from '../middleware/auth'
import { logAudit } from '../utils/audit'

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/users', { preHandler: authenticate }, async (_req, reply) => {
    const db = getDb()
    const users = db
      .prepare('SELECT id, username, created_at FROM users ORDER BY username')
      .all()
    return reply.send(users)
  })

  app.post('/api/users', { preHandler: authenticate }, async (request, reply) => {
    const body = z
      .object({
        username: z.string().min(2).max(64),
        password: z.string().min(8),
      })
      .safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid input', issues: body.error.issues })
    }

    const db = getDb()
    const existing = db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(body.data.username)
    if (existing) {
      return reply.code(409).send({ error: 'Username already taken' })
    }

    const hash = await argon2.hash(body.data.password)
    const now = new Date().toISOString()
    const result = db
      .prepare(
        'INSERT INTO users (username, password_hash, created_at, created_by) VALUES (?, ?, ?, ?)',
      )
      .run(body.data.username, hash, now, request.user!.id)

    const newId = result.lastInsertRowid as number

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'user.created',
      entityType: 'user',
      entityId: newId,
      details: { username: body.data.username },
      ipAddress: request.ip,
    })

    return reply.code(201).send({ id: newId, username: body.data.username })
  })

  app.put('/api/users/:id/password', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = z.object({ password: z.string().min(8) }).safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid input' })
    }

    const db = getDb()
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id) as
      | { id: number; username: string }
      | undefined

    if (!user) return reply.code(404).send({ error: 'User not found' })

    const hash = await argon2.hash(body.data.password)
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id)

    // Invalidate all sessions for this user (security: force re-login)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'user.password_changed',
      entityType: 'user',
      entityId: user.id,
      details: { targetUsername: user.username },
      ipAddress: request.ip,
    })

    return reply.send({ ok: true })
  })

  app.delete('/api/users/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const userId = parseInt(id, 10)

    if (userId === request.user!.id) {
      return reply.code(400).send({ error: 'Cannot delete your own account' })
    }

    const db = getDb()
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as
      | { id: number; username: string }
      | undefined

    if (!user) return reply.code(404).send({ error: 'User not found' })

    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM users WHERE id = ?').run(userId)

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'user.deleted',
      entityType: 'user',
      entityId: userId,
      details: { username: user.username },
      ipAddress: request.ip,
    })

    return reply.send({ ok: true })
  })
}

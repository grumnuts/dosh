import { FastifyInstance } from 'fastify'
import argon2 from 'argon2'
import { z } from 'zod'
import { getDb } from '../db/client'
import { authenticate, UserRole } from '../middleware/auth'
import { logAudit } from '../utils/audit'

function countAdmins(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'")
    .get() as { count: number }
  return row.count
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/users', { preHandler: authenticate }, async (_req, reply) => {
    const db = getDb()
    const users = db
      .prepare('SELECT id, username, role, created_at FROM users ORDER BY username')
      .all()
    return reply.send(users)
  })

  app.post('/api/users', { preHandler: authenticate }, async (request, reply) => {
    const body = z
      .object({
        username: z.string().min(2).max(64),
        password: z.string().min(8),
        role: z.enum(['admin', 'readonly']).default('admin'),
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
        'INSERT INTO users (username, password_hash, role, created_at, created_by) VALUES (?, ?, ?, ?, ?)',
      )
      .run(body.data.username, hash, body.data.role, now, request.user!.id)

    const newId = result.lastInsertRowid as number

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'user.created',
      entityType: 'user',
      entityId: newId,
      details: { username: body.data.username, role: body.data.role },
      ipAddress: request.ip,
    })

    return reply.code(201).send({ id: newId, username: body.data.username, role: body.data.role })
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

  app.put('/api/users/:id/role', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const userId = parseInt(id, 10)
    const body = z.object({ role: z.enum(['admin', 'readonly']) }).safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid input' })
    }

    const db = getDb()
    const target = db
      .prepare('SELECT id, username, role FROM users WHERE id = ?')
      .get(userId) as { id: number; username: string; role: UserRole } | undefined

    if (!target) return reply.code(404).send({ error: 'User not found' })

    if (target.role === 'admin' && body.data.role === 'readonly' && countAdmins() <= 1) {
      return reply.code(400).send({ error: 'Cannot demote the last admin' })
    }

    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(body.data.role, userId)

    // If demoting to readonly, invalidate sessions so write access drops immediately
    if (body.data.role === 'readonly') {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
    }

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'user.role_changed',
      entityType: 'user',
      entityId: target.id,
      details: { targetUsername: target.username, from: target.role, to: body.data.role },
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
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId) as
      | { id: number; username: string; role: UserRole }
      | undefined

    if (!user) return reply.code(404).send({ error: 'User not found' })

    if (user.role === 'admin' && countAdmins() <= 1) {
      return reply.code(400).send({ error: 'Cannot delete the last admin' })
    }

    // Null out references first — FKs are NO ACTION so a direct DELETE would
    // fail for any user with audit_log / transactions / budget_history /
    // created_by references. The audit_log keeps the username as text.
    db.prepare('BEGIN').run()
    try {
      db.prepare('UPDATE audit_log SET user_id = NULL WHERE user_id = ?').run(userId)
      db.prepare('UPDATE transactions SET created_by = NULL WHERE created_by = ?').run(userId)
      db.prepare('UPDATE budget_history SET created_by = NULL WHERE created_by = ?').run(userId)
      db.prepare('UPDATE budget_rollovers SET created_by = NULL WHERE created_by = ?').run(userId)
      db.prepare('UPDATE users SET created_by = NULL WHERE created_by = ?').run(userId)
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
      db.prepare('DELETE FROM users WHERE id = ?').run(userId)
      db.prepare('COMMIT').run()
    } catch (err) {
      db.prepare('ROLLBACK').run()
      throw err
    }

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

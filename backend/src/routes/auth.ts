import { FastifyInstance } from 'fastify'
import argon2 from 'argon2'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { getDb, hasUsers } from '../db/client'
import { logAudit } from '../utils/audit'
import { authenticate } from '../middleware/auth'

const SESSION_DAYS = 90

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Check if initial setup is needed
  app.get('/api/setup/status', async (_req, reply) => {
    return reply.send({ needsSetup: !hasUsers() })
  })

  // Create the first user (only allowed when no users exist)
  app.post('/api/setup/init', async (request, reply) => {
    if (hasUsers()) {
      return reply.code(403).send({ error: 'Setup already complete' })
    }

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
    const hash = await argon2.hash(body.data.password)
    const now = new Date().toISOString()

    const result = db
      .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run(body.data.username, hash, now)

    const userId = result.lastInsertRowid as number

    // Create default accounts
    db.prepare(
      `INSERT INTO accounts (name, type, starting_balance, sort_order, created_at, updated_at)
       VALUES (?, ?, 0, ?, ?, ?)`,
    ).run('Spending', 'transactional', 0, now, now)

    db.prepare(
      `INSERT INTO accounts (name, type, starting_balance, sort_order, created_at, updated_at)
       VALUES (?, ?, 0, ?, ?, ?)`,
    ).run('Emergency', 'savings', 1, now, now)

    logAudit({
      userId,
      username: body.data.username,
      eventType: 'user.created',
      entityType: 'user',
      entityId: userId,
      details: { username: body.data.username, isFirstUser: true },
      ipAddress: request.ip,
    })

    return reply.code(201).send({ ok: true })
  })

  app.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid input' })
    }

    const db = getDb()
    const user = db
      .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
      .get(body.data.username) as
      | { id: number; username: string; password_hash: string }
      | undefined

    if (!user) {
      logAudit({
        userId: null,
        username: body.data.username,
        eventType: 'user.login_failed',
        details: { reason: 'unknown_user' },
        ipAddress: request.ip,
      })
      return reply.code(401).send({ error: 'Invalid credentials' })
    }

    const valid = await argon2.verify(user.password_hash, body.data.password)
    if (!valid) {
      logAudit({
        userId: user.id,
        username: user.username,
        eventType: 'user.login_failed',
        entityType: 'user',
        entityId: user.id,
        details: { reason: 'wrong_password' },
        ipAddress: request.ip,
      })
      return reply.code(401).send({ error: 'Invalid credentials' })
    }

    const sessionId = nanoid(48)
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const now = new Date().toISOString()

    // Prune expired sessions for this user before creating a new one
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').run(user.id, now)

    db.prepare(
      'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    ).run(sessionId, user.id, expiresAt, now)

    logAudit({
      userId: user.id,
      username: user.username,
      eventType: 'user.login',
      entityType: 'user',
      entityId: user.id,
      ipAddress: request.ip,
    })

    reply
      .setCookie('session', sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        expires: new Date(expiresAt),
      })
      .send({ ok: true, user: { id: user.id, username: user.username } })
  })

  app.post('/api/auth/logout', { preHandler: authenticate }, async (request, reply) => {
    const sessionId = request.cookies['session']
    if (sessionId) {
      const db = getDb()
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
    }

    logAudit({
      userId: request.user!.id,
      username: request.user!.username,
      eventType: 'user.logout',
      entityType: 'user',
      entityId: request.user!.id,
      ipAddress: request.ip,
    })

    reply.clearCookie('session', { path: '/' }).send({ ok: true })
  })

  app.get('/api/auth/me', { preHandler: authenticate }, async (request, reply) => {
    return reply.send({ user: request.user })
  })
}

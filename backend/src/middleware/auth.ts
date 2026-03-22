import { FastifyRequest, FastifyReply } from 'fastify'
import { getDb } from '../db/client'

export interface AuthUser {
  id: number
  username: string
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser
  }
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const sessionId = request.cookies['session']
  if (!sessionId) {
    reply.code(401).send({ error: 'Unauthorized' })
    return
  }

  const db = getDb()
  const session = db
    .prepare(
      `SELECT s.user_id, u.username
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sessionId, new Date().toISOString()) as
    | { user_id: number; username: string }
    | undefined

  if (!session) {
    reply.clearCookie('session').code(401).send({ error: 'Unauthorized' })
    return
  }

  request.user = { id: session.user_id, username: session.username }
}

import { FastifyRequest, FastifyReply } from 'fastify'
import { getDb } from '../db/client'

export type UserRole = 'admin' | 'readonly'

export interface AuthUser {
  id: number
  username: string
  role: UserRole
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser
  }
}

// Readonly users can hit GETs on these prefixes, plus a tiny allowlist of
// non-GETs (logout). Everything else returns 403.
const READONLY_GET_PREFIXES = [
  '/api/auth/me',
  '/api/budget',
  '/api/transactions',
  '/api/accounts',
  '/api/payees',
  '/api/reports',
]

function isReadonlyAllowed(method: string, url: string): boolean {
  const path = url.split('?')[0]

  if (method === 'POST' && path === '/api/auth/logout') return true

  if (method !== 'GET') return false

  return READONLY_GET_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))
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
      `SELECT s.user_id, u.username, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sessionId, new Date().toISOString()) as
    | { user_id: number; username: string; role: UserRole }
    | undefined

  if (!session) {
    reply.clearCookie('session').code(401).send({ error: 'Unauthorized' })
    return
  }

  request.user = {
    id: session.user_id,
    username: session.username,
    role: session.role,
  }

  if (session.role === 'readonly' && !isReadonlyAllowed(request.method, request.url)) {
    reply.code(403).send({ error: 'Read-only account' })
    return
  }
}

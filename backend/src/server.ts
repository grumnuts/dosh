import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import staticFiles from '@fastify/static'
import multipart from '@fastify/multipart'
import path from 'path'
import fs from 'fs'
import { initDb } from './db/client'
import { authRoutes } from './routes/auth'
import { userRoutes } from './routes/users'
import { accountRoutes } from './routes/accounts'
import { budgetRoutes } from './routes/budget'
import { transactionRoutes } from './routes/transactions'
import { importRoutes } from './routes/import'
import { auditRoutes } from './routes/audit'
import { payeeRoutes } from './routes/payees'
import { ruleRoutes } from './routes/rules'
import { settingsRoutes } from './routes/settings'
import { reportRoutes } from './routes/reports'

const PORT = parseInt(process.env.PORT ?? '3000', 10)
const HOST = process.env.HOST ?? '0.0.0.0'
const DB_PATH = process.env.DB_PATH ?? './data/dosh.db'
const SECRET_KEY = process.env.SECRET_KEY ?? (() => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SECRET_KEY environment variable is required in production')
  }
  return 'dev-secret-change-me-in-production'
})()

async function start(): Promise<void> {
  initDb(DB_PATH)

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  })

  await app.register(cookie, {
    secret: SECRET_KEY,
  })

  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB max CSV
    },
  })

  // Register API routes
  await app.register(authRoutes)
  await app.register(userRoutes)
  await app.register(accountRoutes)
  await app.register(budgetRoutes)
  await app.register(transactionRoutes)
  await app.register(importRoutes)
  await app.register(auditRoutes)
  await app.register(payeeRoutes)
  await app.register(ruleRoutes)
  await app.register(settingsRoutes)
  await app.register(reportRoutes)

  // Serve frontend static files in production
  const frontendDist = path.join(__dirname, '../../frontend/dist')
  if (fs.existsSync(frontendDist)) {
    await app.register(staticFiles, {
      root: frontendDist,
      prefix: '/',
    })

    // SPA fallback — all non-API routes serve index.html
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not found' })
      }
      return reply.sendFile('index.html')
    })
  } else {
    app.log.warn('Frontend dist not found — running API-only mode')
  }

  try {
    await app.listen({ port: PORT, host: HOST })
    app.log.info(`Dosh running at http://${HOST}:${PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()

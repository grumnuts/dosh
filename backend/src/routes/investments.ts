import { FastifyInstance } from 'fastify'
import { getDb } from '../db/client'
import { authenticate } from '../middleware/auth'
import { refreshAllPrices } from '../services/investments'

export async function investmentRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/investments/holdings — all current holdings with live prices
  app.get('/api/investments/holdings', { preHandler: authenticate }, async (_req, reply) => {
    const db = getDb()

    const rows = db
      .prepare(
        `SELECT ih.account_id, a.name AS account_name,
                ih.ticker, sp.name AS ticker_name,
                ih.quantity, ih.cost_basis_cents,
                COALESCE(sp.price_cents, 0) AS price_cents,
                COALESCE(sp.currency, 'USD') AS currency,
                sp.last_updated
         FROM investment_holdings ih
         JOIN accounts a ON a.id = ih.account_id
         LEFT JOIN share_prices sp ON sp.ticker = ih.ticker
         WHERE ih.quantity > 0
         ORDER BY a.name, ih.ticker`,
      )
      .all() as Array<{
        account_id: number
        account_name: string
        ticker: string
        ticker_name: string | null
        quantity: number
        cost_basis_cents: number
        price_cents: number
        currency: string
        last_updated: string | null
      }>

    const holdings = rows.map((r) => {
      const marketValueCents = Math.round(r.quantity * r.price_cents)
      return {
        accountId: r.account_id,
        accountName: r.account_name,
        ticker: r.ticker,
        name: r.ticker_name,
        quantity: r.quantity,
        costBasisCents: r.cost_basis_cents,
        priceCents: r.price_cents,
        currency: r.currency,
        marketValueCents,
        gainLossCents: marketValueCents - r.cost_basis_cents,
        lastUpdated: r.last_updated,
      }
    })

    const totalMarketValueCents = holdings.reduce((sum, h) => sum + h.marketValueCents, 0)
    const lastUpdated =
      holdings.reduce<string | null>((latest, h) => {
        if (!h.lastUpdated) return latest
        if (!latest) return h.lastUpdated
        return h.lastUpdated > latest ? h.lastUpdated : latest
      }, null) ?? null

    return reply.send({ holdings, totalMarketValueCents, lastUpdated })
  })

  // POST /api/investments/prices/refresh — fetch latest prices for all held tickers
  app.post('/api/investments/prices/refresh', { preHandler: authenticate }, async (_req, reply) => {
    await refreshAllPrices()
    return reply.send({ ok: true })
  })
}

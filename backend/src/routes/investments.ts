import { FastifyInstance } from 'fastify'
import { getDb } from '../db/client'
import { authenticate } from '../middleware/auth'
import { refreshAllPrices } from '../services/investments'

export async function investmentRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/investments/holdings — holdings aggregated per ticker across all accounts
  app.get('/api/investments/holdings', { preHandler: authenticate }, async (_req, reply) => {
    const db = getDb()

    const rows = db
      .prepare(
        `SELECT ih.ticker,
                sp.name AS ticker_name,
                SUM(ih.quantity) AS quantity,
                SUM(ih.cost_basis_cents) AS cost_basis_cents,
                COALESCE(sp.price_cents, 0) AS price_cents,
                COALESCE(sp.currency, 'USD') AS currency,
                sp.last_updated
         FROM investment_holdings ih
         LEFT JOIN share_prices sp ON sp.ticker = ih.ticker
         WHERE ih.quantity > 0
         GROUP BY ih.ticker
         ORDER BY ih.ticker`,
      )
      .all() as Array<{
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

  // GET /api/investments/history — monthly portfolio value per ticker for charting
  app.get('/api/investments/history', { preHandler: authenticate }, async (_req, reply) => {
    const db = getDb()

    // Build cumulative quantity per ticker per month from transactions
    const txRows = db
      .prepare(
        `SELECT strftime('%Y-%m', date) AS month,
                investment_ticker AS ticker,
                SUM(investment_quantity) AS qty_change
         FROM transactions
         WHERE investment_ticker IS NOT NULL
         GROUP BY month, investment_ticker
         ORDER BY month`,
      )
      .all() as Array<{ month: string; ticker: string; qty_change: number }>

    // Running quantity per ticker
    const runningQty = new Map<string, number>()
    const qtyByMonth = new Map<string, Map<string, number>>()

    for (const row of txRows) {
      const prev = runningQty.get(row.ticker) ?? 0
      runningQty.set(row.ticker, prev + row.qty_change)
      if (!qtyByMonth.has(row.month)) qtyByMonth.set(row.month, new Map())
      qtyByMonth.get(row.month)!.set(row.ticker, runningQty.get(row.ticker)!)
    }

    // Price history
    const priceRows = db
      .prepare(`SELECT month, ticker, price_cents FROM share_price_history ORDER BY month`)
      .all() as Array<{ month: string; ticker: string; price_cents: number }>

    const allMonths = [...new Set(priceRows.map((r) => r.month))].sort()
    const lastQty = new Map<string, number>()

    // chart: [{month, [ticker]: valueInDollars, ...}]
    const chartData: Array<Record<string, number | string>> = []

    for (const month of allMonths) {
      // Apply any quantity changes up to and including this month
      for (const [m, qtys] of qtyByMonth) {
        if (m <= month) {
          for (const [t, q] of qtys) lastQty.set(t, q)
        }
      }
      const entry: Record<string, number | string> = { month }
      const pricesThisMonth = priceRows.filter((r) => r.month === month)
      for (const pr of pricesThisMonth) {
        const qty = lastQty.get(pr.ticker) ?? 0
        entry[pr.ticker] = Math.round(qty * pr.price_cents) / 100
      }
      chartData.push(entry)
    }

    const tickers = [...new Set(priceRows.map((r) => r.ticker))]

    return reply.send({ chartData, tickers })
  })

  // POST /api/investments/prices/refresh — fetch latest prices for all held tickers
  app.post('/api/investments/prices/refresh', { preHandler: authenticate }, async (_req, reply) => {
    await refreshAllPrices()
    return reply.send({ ok: true })
  })
}

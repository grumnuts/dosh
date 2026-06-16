import { getDb } from '../db/client'

interface YahooResponse {
  chart: {
    result: Array<{
      meta: {
        regularMarketPrice: number
        currency: string
        longName?: string
        shortName?: string
      }
    }> | null
    error: unknown
  }
}

export async function fetchAndCachePrice(ticker: string): Promise<number | null> {
  const db = getDb()
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; personal-finance-tracker)' },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      console.error(`[investments] Price fetch failed for ${ticker}: HTTP ${res.status}`)
      return null
    }

    const data = (await res.json()) as YahooResponse

    if (data.chart.error || !data.chart.result?.length) {
      console.error(`[investments] No price data for ${ticker}`)
      return null
    }

    const meta = data.chart.result[0].meta
    const priceCents = Math.round(meta.regularMarketPrice * 100)
    const currency = meta.currency ?? 'USD'
    const name = meta.longName ?? meta.shortName ?? null
    const now = new Date().toISOString()
    const month = now.slice(0, 7)

    db.prepare(
      `INSERT OR REPLACE INTO share_prices (ticker, name, price_cents, currency, last_updated)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(ticker.toUpperCase(), name, priceCents, currency, now)

    db.prepare(
      `INSERT OR REPLACE INTO share_price_history (ticker, month, price_cents)
       VALUES (?, ?, ?)`,
    ).run(ticker.toUpperCase(), month, priceCents)

    return priceCents
  } catch (err) {
    console.error(`[investments] Error fetching price for ${ticker}:`, err)
    return null
  }
}

export async function refreshAllPrices(): Promise<void> {
  const db = getDb()
  const rows = db
    .prepare('SELECT DISTINCT ticker FROM investment_holdings')
    .all() as Array<{ ticker: string }>

  for (const { ticker } of rows) {
    const price = await fetchAndCachePrice(ticker)
    if (price !== null) {
      console.log(`[investments] ${ticker}: ${price / 100}`)
    }
  }
}

export function recalculateHoldings(accountId: number): void {
  const db = getDb()
  db.exec('BEGIN TRANSACTION')
  try {
    db.prepare('DELETE FROM investment_holdings WHERE account_id = ?').run(accountId)

    const rows = db
      .prepare(
        `SELECT investment_ticker AS ticker,
                investment_quantity AS quantity,
                amount,
                investment_trade_value_cents AS trade_value_cents,
                investment_fee_cents AS fee_cents
         FROM transactions
         WHERE account_id = ?
           AND investment_ticker IS NOT NULL
           AND investment_quantity IS NOT NULL
         ORDER BY date, id`,
      )
      .all(accountId) as Array<{
        ticker: string
        quantity: number
        amount: number
        trade_value_cents: number | null
        fee_cents: number | null
      }>

    const holdings = new Map<string, { quantity: number; costBasisCents: number }>()

    for (const row of rows) {
      const ticker = row.ticker.toUpperCase()
      const holding = holdings.get(ticker) ?? { quantity: 0, costBasisCents: 0 }
      const quantity = row.quantity
      const feeCents = row.fee_cents ?? 0
      const tradeValueCents = row.trade_value_cents ?? inferTradeValueCents(row.amount, quantity, feeCents)

      if (quantity > 0) {
        holding.quantity += quantity
        holding.costBasisCents += tradeValueCents + feeCents
      } else if (quantity < 0 && holding.quantity > 0) {
        const soldQuantity = Math.min(Math.abs(quantity), holding.quantity)
        const remainingQuantity = holding.quantity - soldQuantity
        const allocatedBasis = remainingQuantity <= 0
          ? holding.costBasisCents
          : Math.round((holding.costBasisCents / holding.quantity) * soldQuantity)

        holding.quantity = remainingQuantity
        holding.costBasisCents -= allocatedBasis
      }

      if (holding.quantity > 0) {
        holdings.set(ticker, holding)
      } else {
        holdings.delete(ticker)
      }
    }

    const insert = db.prepare(
      `INSERT INTO investment_holdings (account_id, ticker, quantity, cost_basis_cents)
       VALUES (?, ?, ?, ?)`,
    )
    for (const [ticker, holding] of holdings) {
      insert.run(accountId, ticker, holding.quantity, holding.costBasisCents)
    }

    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

function inferTradeValueCents(amount: number, quantity: number, feeCents: number): number {
  const absAmount = Math.abs(amount)
  if (quantity < 0) return absAmount + feeCents
  return Math.max(0, absAmount - feeCents)
}

export function recalculateAllHoldings(): void {
  const db = getDb()
  const accounts = db
    .prepare(`SELECT DISTINCT account_id FROM transactions WHERE investment_ticker IS NOT NULL`)
    .all() as Array<{ account_id: number }>
  for (const { account_id } of accounts) {
    recalculateHoldings(account_id)
  }
}

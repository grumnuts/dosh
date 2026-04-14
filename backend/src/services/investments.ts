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
    db.prepare(`
      INSERT INTO investment_holdings (account_id, ticker, quantity, cost_basis_cents)
        SELECT account_id,
               investment_ticker,
               SUM(investment_quantity),
               -SUM(amount)
        FROM transactions
        WHERE account_id = ? AND investment_ticker IS NOT NULL
        GROUP BY investment_ticker
        HAVING SUM(investment_quantity) > 0
    `).run(accountId)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

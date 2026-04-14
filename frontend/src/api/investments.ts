import { api } from './client'

export interface HoldingRow {
  ticker: string
  name: string | null
  quantity: number
  costBasisCents: number
  priceCents: number
  currency: string
  marketValueCents: number
  gainLossCents: number
  lastUpdated: string | null
}

export interface InvestmentPortfolioData {
  holdings: HoldingRow[]
  totalMarketValueCents: number
  lastUpdated: string | null
}

export interface InvestmentHistoryData {
  chartData: Array<Record<string, number | string>>
  tickers: string[]
}

export const investmentsApi = {
  holdings: () => api.get<InvestmentPortfolioData>('/api/investments/holdings'),
  history: () => api.get<InvestmentHistoryData>('/api/investments/history'),
  refreshPrices: () => api.post<{ ok: boolean }>('/api/investments/prices/refresh'),
}

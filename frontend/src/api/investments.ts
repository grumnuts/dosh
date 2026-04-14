import { api } from './client'

export interface HoldingRow {
  accountId: number
  accountName: string
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

export const investmentsApi = {
  holdings: () => api.get<InvestmentPortfolioData>('/api/investments/holdings'),
  refreshPrices: () => api.post<{ ok: boolean }>('/api/investments/prices/refresh'),
}

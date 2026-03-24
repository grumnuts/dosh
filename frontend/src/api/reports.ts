import { api } from './client'

export interface SpendingRow {
  category: string
  group_name: string
  category_id: number
  group_sort: number
  cat_sort: number
  month: string
  total_cents: number
}

export interface OverspendRow {
  category: string
  group_name: string
  group_sort: number
  cat_sort: number
  period_label: string
  spent_cents: number
  budgeted_cents: number
  overspend_cents: number
}

export interface PayeeRow {
  payee: string
  month: string
  income_cents: number
  expense_cents: number
}

export interface GoalPoint {
  month: string
  balance: number
}

export interface GoalSeries {
  accountId: number
  name: string
  goalAmount: number
  currentBalance: number
  history: GoalPoint[]
  projection: GoalPoint[]
}

export interface InVsOutRow {
  month: string
  income_cents: number
  expense_cents: number
}

export interface AccountBalanceHistory {
  id: number
  name: string
  type: string
  history: GoalPoint[]
}

export interface NetWorthData {
  accounts: AccountBalanceHistory[]
  netWorth: GoalPoint[]
}

export const reportsApi = {
  years: () => api.get<string[]>('/api/reports/years'),
  spending: (year: string) => api.get<SpendingRow[]>(`/api/reports/spending?year=${year}`),
  overspend: (year: string) => api.get<OverspendRow[]>(`/api/reports/overspend?year=${year}`),
  payees: (year: string) => api.get<PayeeRow[]>(`/api/reports/payees?year=${year}`),
  goals: () => api.get<GoalSeries[]>('/api/reports/goals'),
  invsout: (year: string) => api.get<InVsOutRow[]>(`/api/reports/invsout?year=${year}`),
  networth: () => api.get<NetWorthData>('/api/reports/networth'),
}

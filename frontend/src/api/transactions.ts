import { api } from './client'

export interface TransactionSplit {
  id: number
  transaction_id: number
  category_id: number | null
  category_name: string | null
  amount: number
  note: string | null
}

export interface Transaction {
  id: number
  date: string
  account_id: number
  account_name: string
  payee: string | null
  description: string | null
  amount: number
  category_id: number | null
  category_name: string | null
  group_name: string | null
  category_is_unlisted: number | null
  type: 'transaction' | 'transfer' | 'cover'
  transfer_pair_id: number | null
  cover_week_start: string | null
  ignore_rules: number
  created_at: string
  splits: TransactionSplit[]
}

export interface TransactionFilters {
  startDate?: string
  endDate?: string
  accountId?: number
  categoryId?: number
  payee?: string
  uncategorised?: boolean
  search?: string
  limit?: number
  offset?: number
}

export interface TransactionSplitInput {
  categoryId?: number | null
  amount: number
  note?: string | null
}

export interface TransactionInput {
  date: string
  accountId: number
  payee?: string | null
  description?: string | null
  amount: number
  categoryId?: number | null
  type?: 'transaction' | 'transfer' | 'starting_balance'
  transferToAccountId?: number | null
  splits?: TransactionSplitInput[]
  ignoreRules?: boolean
}

export const transactionsApi = {
  payees: () => api.get<string[]>('/api/transactions/payees'),

  list: (filters: TransactionFilters = {}) => {
    const params = new URLSearchParams()
    if (filters.startDate) params.set('startDate', filters.startDate)
    if (filters.endDate) params.set('endDate', filters.endDate)
    if (filters.accountId) params.set('accountId', String(filters.accountId))
    if (filters.categoryId) params.set('categoryId', String(filters.categoryId))
    if (filters.payee) params.set('payee', filters.payee)
    if (filters.uncategorised) params.set('uncategorised', 'true')
    if (filters.search) params.set('search', filters.search)
    if (filters.limit) params.set('limit', String(filters.limit))
    if (filters.offset) params.set('offset', String(filters.offset))
    const qs = params.toString()
    return api.get<{ total: number; items: Transaction[] }>(`/api/transactions${qs ? `?${qs}` : ''}`)
  },

  uncategorisedCount: () =>
    api.get<{ count: number }>('/api/transactions/uncategorised-count'),

  create: (data: TransactionInput) =>
    api.post<{ id: number; pairedId?: number }>('/api/transactions', data),

  update: (id: number, data: Omit<TransactionInput, 'type' | 'transferToAccountId'>) =>
    api.put<{ ok: boolean }>(`/api/transactions/${id}`, data),

  delete: (id: number) => api.delete<{ ok: boolean }>(`/api/transactions/${id}`),

  bulkDelete: (ids: number[]) =>
    api.post<{ ok: boolean; deleted: number }>('/api/transactions/bulk-delete', { ids }),
}

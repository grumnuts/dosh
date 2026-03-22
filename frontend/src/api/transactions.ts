import { api } from './client'

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
  type: 'transaction' | 'transfer' | 'cover'
  transfer_pair_id: number | null
  cover_week_start: string | null
  created_at: string
}

export interface TransactionFilters {
  startDate?: string
  endDate?: string
  accountId?: number
  categoryId?: number
  payee?: string
  limit?: number
  offset?: number
}

export interface TransactionInput {
  date: string
  accountId: number
  payee?: string | null
  description?: string | null
  amount: number
  categoryId?: number | null
  type?: 'transaction' | 'transfer'
  transferToAccountId?: number | null
}

export const transactionsApi = {
  list: (filters: TransactionFilters = {}) => {
    const params = new URLSearchParams()
    if (filters.startDate) params.set('startDate', filters.startDate)
    if (filters.endDate) params.set('endDate', filters.endDate)
    if (filters.accountId) params.set('accountId', String(filters.accountId))
    if (filters.categoryId) params.set('categoryId', String(filters.categoryId))
    if (filters.payee) params.set('payee', filters.payee)
    if (filters.limit) params.set('limit', String(filters.limit))
    if (filters.offset) params.set('offset', String(filters.offset))
    const qs = params.toString()
    return api.get<Transaction[]>(`/api/transactions${qs ? `?${qs}` : ''}`)
  },

  create: (data: TransactionInput) =>
    api.post<{ id: number; pairedId?: number }>('/api/transactions', data),

  update: (id: number, data: Omit<TransactionInput, 'type' | 'transferToAccountId'>) =>
    api.put<{ ok: boolean }>(`/api/transactions/${id}`, data),

  delete: (id: number) => api.delete<{ ok: boolean }>(`/api/transactions/${id}`),
}

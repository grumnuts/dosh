import { api } from './client'

export interface Account {
  id: number
  name: string
  type: 'transactional' | 'savings' | 'debt'
  startingBalance: number
  currentBalance: number
  notes: string | null
  sortOrder: number
}

export interface AccountInput {
  name: string
  type: 'transactional' | 'savings' | 'debt'
  notes?: string | null
  sortOrder?: number
}

export interface AccountCreateInput extends AccountInput {
  startingBalance?: number
  startingBalanceDate?: string
}

export const accountsApi = {
  list: () => api.get<Account[]>('/api/accounts'),
  create: (data: AccountCreateInput) => api.post<{ id: number }>('/api/accounts', data),
  update: (id: number, data: AccountInput) => api.put<{ ok: boolean }>(`/api/accounts/${id}`, data),
  delete: (id: number) => api.delete<{ ok: boolean }>(`/api/accounts/${id}`),
}

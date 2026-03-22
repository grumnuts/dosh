import { api } from './client'

export interface Account {
  id: number
  name: string
  type: 'transactional' | 'savings'
  startingBalance: number
  currentBalance: number
  notes: string | null
  sortOrder: number
}

export interface AccountInput {
  name: string
  type: 'transactional' | 'savings'
  startingBalance: number
  notes?: string | null
  sortOrder?: number
}

export const accountsApi = {
  list: () => api.get<Account[]>('/api/accounts'),
  create: (data: AccountInput) => api.post<{ id: number }>('/api/accounts', data),
  update: (id: number, data: AccountInput) => api.put<{ ok: boolean }>(`/api/accounts/${id}`, data),
  delete: (id: number) => api.delete<{ ok: boolean }>(`/api/accounts/${id}`),
}

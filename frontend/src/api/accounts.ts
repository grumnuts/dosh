import { api } from './client'

export interface Account {
  id: number
  name: string
  type: 'transactional' | 'savings' | 'debt'
  currentBalance: number
  notes: string | null
  sortOrder: number
  goalAmount: number | null
  goalTargetDate: string | null
}

export interface AccountInput {
  name: string
  type: 'transactional' | 'savings' | 'debt'
  notes?: string | null
  sortOrder?: number
  goalAmount?: number | null
  goalTargetDate?: string | null
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
  reorder: (items: { id: number; sortOrder: number }[]) => api.patch<{ ok: boolean }>('/api/accounts/reorder', items),
  reconcile: (id: number, data: { actualBalance: number; date?: string }) =>
    api.post<{ ok: boolean; adjustment: number; transactionId?: number }>(`/api/accounts/${id}/reconcile`, data),
}

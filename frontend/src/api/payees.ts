import { api } from './client'

export interface Payee {
  id: number
  name: string
}

export const payeesApi = {
  list: () => api.get<Payee[]>('/api/payees'),
}

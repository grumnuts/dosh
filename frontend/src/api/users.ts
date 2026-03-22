import { api } from './client'

export interface User {
  id: number
  username: string
  created_at: string
}

export const usersApi = {
  list: () => api.get<User[]>('/api/users'),
  create: (username: string, password: string) =>
    api.post<{ id: number; username: string }>('/api/users', { username, password }),
  changePassword: (id: number, password: string) =>
    api.put<{ ok: boolean }>(`/api/users/${id}/password`, { password }),
  delete: (id: number) => api.delete<{ ok: boolean }>(`/api/users/${id}`),
}

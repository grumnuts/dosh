import { api } from './client'
import { UserRole } from './auth'

export interface User {
  id: number
  username: string
  role: UserRole
  created_at: string
}

export const usersApi = {
  list: () => api.get<User[]>('/api/users'),
  create: (username: string, password: string, role: UserRole = 'admin') =>
    api.post<{ id: number; username: string; role: UserRole }>('/api/users', { username, password, role }),
  changePassword: (id: number, password: string) =>
    api.put<{ ok: boolean }>(`/api/users/${id}/password`, { password }),
  changeRole: (id: number, role: UserRole) =>
    api.put<{ ok: boolean }>(`/api/users/${id}/role`, { role }),
  delete: (id: number) => api.delete<{ ok: boolean }>(`/api/users/${id}`),
}

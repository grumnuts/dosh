import { api } from './client'

export type UserRole = 'admin' | 'readonly'

export interface AuthUser {
  id: number
  username: string
  role: UserRole
}

export const authApi = {
  me: () => api.get<{ user: AuthUser }>('/api/auth/me'),
  login: (username: string, password: string) =>
    api.post<{ ok: boolean; user: AuthUser }>('/api/auth/login', { username, password }),
  logout: () => api.post<{ ok: boolean }>('/api/auth/logout'),
  setupStatus: () => api.get<{ needsSetup: boolean }>('/api/setup/status'),
  setupInit: (username: string, password: string) =>
    api.post<{ ok: boolean }>('/api/setup/init', { username, password }),
}

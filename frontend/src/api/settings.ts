import { api } from './client'

export interface AppSettings {
  week_start_day: '0' | '1'
}

export const settingsApi = {
  get: () => api.get<AppSettings>('/api/settings'),
  update: (key: string, value: string) =>
    api.put<{ ok: boolean }>(`/api/settings/${key}`, { value }),
}

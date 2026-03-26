import { api } from './client'

export interface AppSettings {
  week_start_day: '0' | '1'
  dynamic_calculations: 'true' | 'false'
}

export const settingsApi = {
  get: () => api.get<AppSettings>('/api/settings'),
  update: (key: string, value: string) =>
    api.put<{ ok: boolean }>(`/api/settings/${key}`, { value }),
}

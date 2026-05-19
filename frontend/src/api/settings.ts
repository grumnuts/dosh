import { api } from './client'

export interface AppSettings {
  week_start_day: '0' | '1'
  ai_api_token?: string
}

export interface SystemInfo {
  version: string
  uptimeSeconds: number
  dbSizeBytes: number | null
}

export const settingsApi = {
  get: () => api.get<AppSettings>('/api/settings'),
  update: (key: string, value: string) =>
    api.put<{ ok: boolean }>(`/api/settings/${key}`, { value }),
  systemInfo: () => api.get<SystemInfo>('/api/system/info'),
}

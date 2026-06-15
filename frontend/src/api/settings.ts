import { api } from './client'
import type { DateFormatOption } from '../utils/dateFormat'

export interface AppSettings {
  week_start_day: '0' | '1'
  date_format?: DateFormatOption
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

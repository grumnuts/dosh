import { api } from './client'

export interface AuditEntry {
  id: number
  occurred_at: string
  user_id: number | null
  username: string
  event_type: string
  entity_type: string | null
  entity_id: number | null
  details: Record<string, unknown> | null
  ip_address: string | null
}

export interface AuditFilters {
  startDate?: string
  endDate?: string
  userId?: number
  eventType?: string
  search?: string
  limit?: number
  offset?: number
}

export const auditApi = {
  list: (filters: AuditFilters = {}) => {
    const params = new URLSearchParams()
    if (filters.startDate) params.set('startDate', filters.startDate)
    if (filters.endDate) params.set('endDate', filters.endDate)
    if (filters.userId) params.set('userId', String(filters.userId))
    if (filters.eventType) params.set('eventType', filters.eventType)
    if (filters.search) params.set('search', filters.search)
    if (filters.limit) params.set('limit', String(filters.limit))
    if (filters.offset) params.set('offset', String(filters.offset))
    const qs = params.toString()
    return api.get<AuditEntry[]>(`/api/audit${qs ? `?${qs}` : ''}`)
  },
}

import { api } from './client'

export interface ColumnMapping {
  date: number
  payee?: number
  description?: number
  amount?: number
  debit?: number
  credit?: number
}

export interface PreviewRow {
  date: string
  payee: string
  description: string
  amount: number
  isDuplicate: boolean
  existingId?: number
  skip: boolean
  raw: string[]
}

export interface ImportPreviewResponse {
  rows: PreviewRow[]
  accountName: string
}

export const importApi = {
  preview: (data: {
    csvText: string
    hasHeader: boolean
    accountId: number
    dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
    mapping: ColumnMapping
  }) => api.post<ImportPreviewResponse>('/api/import/preview', data),

  confirm: (data: {
    accountId: number
    rows: Array<{
      date: string
      payee: string
      description: string
      amount: number
      skip: boolean
    }>
  }) => api.post<{ imported: number }>('/api/import/confirm', data),
}

import { ApiError } from './client'

export interface Receipt {
  id: number
  transaction_id: number
  filename: string
  mime_type: string
  size: number
  created_at: string
}

async function uploadReceipt(transactionId: number, file: File): Promise<Receipt> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`/api/receipts/${transactionId}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })

  if (!res.ok) {
    let errorBody: unknown
    try {
      errorBody = await res.json()
    } catch {
      errorBody = { error: res.statusText }
    }
    const message =
      typeof errorBody === 'object' && errorBody !== null && 'error' in errorBody
        ? String((errorBody as { error: unknown }).error)
        : res.statusText
    throw new ApiError(res.status, message, errorBody)
  }

  return res.json() as Promise<Receipt>
}

export const receiptsApi = {
  list: async (transactionId: number): Promise<Receipt[]> => {
    const res = await fetch(`/api/receipts/${transactionId}`, { credentials: 'include' })
    if (!res.ok) throw new ApiError(res.status, res.statusText)
    return res.json()
  },

  upload: uploadReceipt,

  delete: async (transactionId: number, receiptId: number): Promise<void> => {
    const res = await fetch(`/api/receipts/${transactionId}/${receiptId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok) {
      let errorBody: unknown
      try { errorBody = await res.json() } catch { errorBody = { error: res.statusText } }
      const message =
        typeof errorBody === 'object' && errorBody !== null && 'error' in errorBody
          ? String((errorBody as { error: unknown }).error)
          : res.statusText
      throw new ApiError(res.status, message, errorBody)
    }
  },

  viewUrl: (transactionId: number, receiptId: number): string =>
    `/api/receipts/${transactionId}/${receiptId}`,
}

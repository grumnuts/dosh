import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { receiptsApi } from '../../api/receipts'

const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp,image/gif,application/pdf'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === 'application/pdf') {
    return (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    )
  }
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
    </svg>
  )
}

interface Props {
  transactionId: number
}

export function ReceiptsSection({ transactionId }: Props) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ['receipts', transactionId],
    queryFn: () => receiptsApi.list(transactionId),
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => receiptsApi.upload(transactionId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts', transactionId] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (receiptId: number) => receiptsApi.delete(transactionId, receiptId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts', transactionId] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    uploadMutation.mutate(file)
    e.target.value = ''
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-secondary uppercase tracking-wide">Receipts</span>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
          className="text-xs text-accent hover:text-accent/80 transition-colors disabled:opacity-50"
        >
          {uploadMutation.isPending ? 'Uploading…' : '+ Attach'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {isLoading && (
        <p className="text-xs text-muted">Loading…</p>
      )}

      {uploadMutation.isError && (
        <p className="text-xs text-danger">{(uploadMutation.error as Error).message}</p>
      )}

      {deleteMutation.isError && (
        <p className="text-xs text-danger">{(deleteMutation.error as Error).message}</p>
      )}

      {receipts.length === 0 && !isLoading && (
        <p className="text-xs text-muted italic">No receipts attached</p>
      )}

      {receipts.map((receipt) => (
        <div
          key={receipt.id}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 group"
        >
          <span className="text-muted">
            <FileIcon mimeType={receipt.mime_type} />
          </span>
          <a
            href={receiptsApi.viewUrl(transactionId, receipt.id)}
            target="_blank"
            rel="noreferrer"
            className="flex-1 min-w-0 text-sm text-primary hover:text-accent transition-colors truncate"
            onClick={(e) => e.stopPropagation()}
          >
            {receipt.filename}
          </a>
          <span className="text-xs text-muted shrink-0">{formatBytes(receipt.size)}</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(receipt.id) }}
            disabled={deleteMutation.isPending}
            className="p-1 text-muted hover:text-danger transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
            aria-label="Delete receipt"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}

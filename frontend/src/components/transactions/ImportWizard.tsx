import { useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Select } from '../ui/Input'
import { Amount } from '../ui/AmountDisplay'
import { importApi, PreviewRow, ColumnMapping } from '../../api/import'
import { accountsApi } from '../../api/accounts'

type Step = 'upload' | 'map' | 'preview' | 'done'

const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const

interface Props {
  open: boolean
  onClose: () => void
}

export function ImportWizard({ open, onClose }: Props) {
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>('upload')
  const [csvText, setCsvText] = useState('')
  const [hasHeader, setHasHeader] = useState(true)
  const [accountId, setAccountId] = useState<number | ''>('')
  const [dateFormat, setDateFormat] = useState<typeof DATE_FORMATS[number]>('DD/MM/YYYY')
  const [mapping, setMapping] = useState<ColumnMapping>({ date: 0 })
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [skips, setSkips] = useState<Set<number>>(new Set())
  const [importedCount, setImportedCount] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list })

  // Parse header row to show column names for mapping
  const headerRow = (() => {
    if (!csvText) return []
    const firstLine = csvText.split('\n')[0]
    return firstLine.split(',').map((c, i) => ({
      index: i,
      label: hasHeader ? c.trim().replace(/^["']|["']$/g, '') : `Column ${i + 1}`,
    }))
  })()

  const preview = useMutation({
    mutationFn: () =>
      importApi.preview({
        csvText,
        hasHeader,
        accountId: accountId as number,
        dateFormat,
        mapping,
      }),
    onSuccess: (data) => {
      setPreviewRows(data.rows)
      setSkips(new Set(data.rows.map((r, i) => (r.isDuplicate ? i : -1)).filter((i) => i >= 0)))
      setStep('preview')
    },
  })

  const confirm = useMutation({
    mutationFn: () =>
      importApi.confirm({
        accountId: accountId as number,
        rows: previewRows.map((r, i) => ({ ...r, skip: skips.has(i) })),
      }),
    onSuccess: (data) => {
      setImportedCount(data.imported)
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      setStep('done')
    },
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setCsvText(ev.target?.result as string)
    reader.readAsText(file)
  }

  const handleClose = () => {
    setStep('upload')
    setCsvText('')
    setMapping({ date: 0 })
    setPreviewRows([])
    setSkips(new Set())
    onClose()
  }

  const toggleSkip = (i: number) => {
    setSkips((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const toImportCount = previewRows.filter((_, i) => !skips.has(i)).length

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Import CSV"
      maxWidth="max-w-3xl"
    >
      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="space-y-4">
          <div
            className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-accent transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <svg className="w-10 h-10 mx-auto text-muted mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-secondary text-sm">Click to select a CSV file</p>
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} className="hidden" />
          </div>

          {csvText && (
            <p className="text-xs text-accent text-center">
              ✓ File loaded ({csvText.split('\n').length} lines)
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Select label="Import into account" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
              <option value="">Select account...</option>
              {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>

            <Select label="Date format" value={dateFormat} onChange={(e) => setDateFormat(e.target.value as typeof dateFormat)}>
              {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="has-header"
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => setHasHeader(e.target.checked)}
              className="w-4 h-4 rounded accent-accent"
            />
            <label htmlFor="has-header" className="text-sm text-secondary">
              File has a header row
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button onClick={() => setStep('map')} disabled={!csvText || !accountId}>
              Next: Map Columns
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Column mapping */}
      {step === 'map' && (
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            Map your CSV columns to the required fields. First data row preview:
          </p>

          {headerRow.length > 0 && (
            <div className="bg-surface-2 rounded-lg p-3 text-xs font-mono text-muted overflow-x-auto">
              {headerRow.map((col) => (
                <span key={col.index} className="mr-4">[{col.index}] {col.label}</span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'date', label: 'Date *', required: true },
              { key: 'payee', label: 'Payee' },
              { key: 'description', label: 'Description' },
              { key: 'amount', label: 'Amount (single column)' },
              { key: 'debit', label: 'Debit column' },
              { key: 'credit', label: 'Credit column' },
            ].map(({ key, label }) => (
              <Select
                key={key}
                label={label}
                value={mapping[key as keyof ColumnMapping] ?? ''}
                onChange={(e) =>
                  setMapping((prev) => ({
                    ...prev,
                    [key]: e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                  }))
                }
              >
                <option value="">Not mapped</option>
                {headerRow.map((col) => (
                  <option key={col.index} value={col.index}>
                    [{col.index}] {col.label}
                  </option>
                ))}
              </Select>
            ))}
          </div>

          {preview.isError && (
            <p className="text-sm text-danger">{(preview.error as Error).message}</p>
          )}

          <div className="flex justify-between gap-3 pt-2">
            <Button variant="ghost" onClick={() => setStep('upload')}>Back</Button>
            <Button
              onClick={() => preview.mutate()}
              loading={preview.isPending}
              disabled={mapping.date === undefined}
            >
              Preview
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 'preview' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-secondary">
              {toImportCount} of {previewRows.length} rows will be imported.
              Duplicates are pre-skipped.
            </p>
            <div className="flex gap-2">
              <button className="text-xs text-muted hover:text-primary" onClick={() => setSkips(new Set())}>
                Select all
              </button>
              <button className="text-xs text-muted hover:text-primary" onClick={() => setSkips(new Set(previewRows.map((_, i) => i)))}>
                Skip all
              </button>
            </div>
          </div>

          <div className="overflow-x-auto max-h-80 overflow-y-auto border border-border rounded-lg">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-2">
                <tr className="text-muted">
                  <th className="px-3 py-2 text-left">Import</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Payee</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-t border-border/50 cursor-pointer ${skips.has(i) ? 'opacity-40' : ''}`}
                    onClick={() => toggleSkip(i)}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={!skips.has(i)}
                        onChange={() => toggleSkip(i)}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-accent"
                      />
                    </td>
                    <td className="px-3 py-2 font-mono">{row.date}</td>
                    <td className="px-3 py-2 truncate max-w-[160px]">{row.payee || row.description || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      <Amount cents={row.amount} />
                    </td>
                    <td className="px-3 py-2">
                      {row.isDuplicate && (
                        <span className="text-warn">duplicate</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {confirm.isError && (
            <p className="text-sm text-danger">{(confirm.error as Error).message}</p>
          )}

          <div className="flex justify-between gap-3 pt-2">
            <Button variant="ghost" onClick={() => setStep('map')}>Back</Button>
            <Button
              onClick={() => confirm.mutate()}
              loading={confirm.isPending}
              disabled={toImportCount === 0}
            >
              Import {toImportCount} transactions
            </Button>
          </div>
        </div>
      )}

      {/* Done */}
      {step === 'done' && (
        <div className="text-center py-4 space-y-4">
          <div className="text-4xl">✓</div>
          <p className="text-primary font-semibold">{importedCount} transactions imported</p>
          <p className="text-sm text-secondary">
            Uncategorised transactions can be assigned a category from the Transactions page.
          </p>
          <Button onClick={handleClose}>Done</Button>
        </div>
      )}
    </Modal>
  )
}

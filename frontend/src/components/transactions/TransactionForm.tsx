import { format, startOfWeek } from 'date-fns'
import { useEffect, useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input, Select } from '../ui/Input'
import { formatMoney } from '../ui/AmountDisplay'
import { CategoryCombobox } from '../ui/CategoryCombobox'
import { ConfirmModal } from '../ui/ConfirmModal'
import { transactionsApi, Transaction } from '../../api/transactions'
import { accountsApi } from '../../api/accounts'
import { budgetApi } from '../../api/budget'
import { payeesApi } from '../../api/payees'
import { settingsApi } from '../../api/settings'

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required'),
  type: z.enum(['debit', 'credit', 'transfer', 'starting_balance']),
  accountId: z.string().min(1, 'Required'),
  transferToAccountId: z.string().optional(),
  payee: z.string().optional(),
  description: z.string().optional(),
  amount: z.string().refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, 'Enter a positive amount'),
  categoryId: z.string().optional(),
  ignoreRules: z.boolean().optional().default(false),
  investmentTicker: z.string().max(20).optional(),
  investmentQuantity: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface SplitRow {
  categoryId: string
  amount: string
  note: string
}

interface Props {
  open: boolean
  onClose: () => void
  transaction?: Transaction | null
}

function PayeeCombobox({
  value,
  onChange,
  payees,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  payees: { id: number; name: string }[]
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const filtered = value.trim()
    ? payees.filter((p) => p.name.toLowerCase().includes(value.toLowerCase()))
    : payees

  const exactMatch = payees.some((p) => p.name.toLowerCase() === value.trim().toLowerCase())
  const showAdd = value.trim() && !exactMatch

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1">
      <label className="text-xs font-medium text-secondary uppercase tracking-wide">Payee</label>
      <input
        className="input-base"
        placeholder="Who was this from/to?"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => { if (!disabled) setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
        autoComplete="off"
        disabled={disabled}
      />
      {open && (filtered.length > 0 || showAdd) && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-surface-2 border border-border rounded-lg shadow-lg overflow-hidden">
          {filtered.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-xs font-semibold text-muted uppercase tracking-wide">Payees</div>
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-surface-3 transition-colors"
                  onMouseDown={(e) => { e.preventDefault(); onChange(p.name); setOpen(false) }}
                >
                  {p.name}
                </button>
              ))}
            </>
          )}
          {showAdd && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm text-accent hover:bg-surface-3 transition-colors border-t border-border/50"
              onMouseDown={(e) => { e.preventDefault(); onChange(value.trim()); setOpen(false) }}
            >
              + Add "{value.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function deriveEditType(tx: Transaction): 'debit' | 'credit' | 'transfer' {
  if (tx.type === 'transfer') return 'transfer'
  return tx.amount < 0 ? 'debit' : 'credit'
}

const blankSplits = (): SplitRow[] => [
  { categoryId: '', amount: '', note: '' },
  { categoryId: '', amount: '', note: '' },
]

export function TransactionForm({ open, onClose, transaction }: Props) {
  const qc = useQueryClient()
  const isEdit = !!transaction
  const isCover = isEdit && transaction?.type === 'cover'

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => accountsApi.list() })
  const { data: payees } = useQuery({ queryKey: ['payees'], queryFn: payeesApi.list })
  const { data: budgetWeek } = useQuery({
    queryKey: ['budget', 'categories-flat'],
    queryFn: () => budgetApi.getCategories(),
  })
  const { data: groups } = useQuery({ queryKey: ['budget', 'groups'], queryFn: budgetApi.getGroups })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get })
  const weekStartsOn: 0 | 1 = settings?.week_start_day === '1' ? 1 : 0
  const currentWeekStart = format(startOfWeek(new Date(), { weekStartsOn }), 'yyyy-MM-dd')
  const { data: currentBudget } = useQuery({
    queryKey: ['budget', currentWeekStart],
    queryFn: () => budgetApi.getWeek(currentWeekStart),
  })
  const balances: Record<number, number> = {}
  for (const g of currentBudget?.groups ?? []) {
    for (const c of g.categories) balances[c.id] = c.balance
  }

  const today = format(new Date(), 'yyyy-MM-dd')

  const { register, handleSubmit, watch, reset, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: today,
      type: 'debit',
      accountId: '',
      transferToAccountId: '',
      payee: '',
      description: '',
      amount: '',
      categoryId: '',
    },
  })

  const [isSplit, setIsSplit] = useState(false)
  const [splits, setSplits] = useState<SplitRow[]>(blankSplits())
  const [splitError, setSplitError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const txType = watch('type')
  const amountStr = watch('amount')
  const totalCents = !isNaN(parseFloat(amountStr)) ? Math.round(parseFloat(amountStr) * 100) : 0
  const splitTotalCents = splits.reduce((sum, s) => {
    const v = parseFloat(s.amount)
    return sum + (!isNaN(v) ? Math.round(v * 100) : 0)
  }, 0)
  const splitRemainder = totalCents - splitTotalCents

  const categories = budgetWeek as Array<{ id: number; group_id: number; name: string; period: string; is_investment: number }> | undefined

  useEffect(() => {
    if (open) {
      setSplitError(null)
      if (transaction) {
        reset({
          date: transaction.date,
          type: deriveEditType(transaction),
          accountId: String(transaction.account_id),
          transferToAccountId: transaction.transfer_pair_account_id
            ? String(transaction.transfer_pair_account_id)
            : '',
          payee: transaction.payee ?? '',
          description: transaction.description ?? '',
          amount: (Math.abs(transaction.amount) / 100).toFixed(2),
          categoryId: transaction.category_id ? String(transaction.category_id) : '',
          ignoreRules: transaction.ignore_rules === 1,
          investmentTicker: transaction.investment_ticker ?? '',
          investmentQuantity: transaction.investment_quantity != null ? String(transaction.investment_quantity) : '',
        })
        if (transaction.splits.length > 0) {
          setIsSplit(true)
          setSplits(transaction.splits.map((s) => ({
            categoryId: s.category_id ? String(s.category_id) : '',
            amount: (Math.abs(s.amount) / 100).toFixed(2),
            note: s.note ?? '',
          })))
        } else {
          setIsSplit(false)
          setSplits(blankSplits())
        }
      } else {
        reset({
          date: today,
          type: 'debit',
          accountId: accounts?.[0] ? String(accounts[0].id) : '',
          transferToAccountId: '',
          payee: '',
          description: '',
          amount: '',
          categoryId: '',
          ignoreRules: false,
          investmentTicker: '',
          investmentQuantity: '',
        })
        setIsSplit(false)
        setSplits(blankSplits())
      }
    }
  }, [open, transaction, reset, accounts, today])

  const updateSplit = (i: number, field: keyof SplitRow, value: string) => {
    setSplits((prev) => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  const addSplit = () => setSplits((prev) => [...prev, { categoryId: '', amount: '', note: '' }])

  const removeSplit = (i: number) => {
    if (splits.length <= 2) return
    setSplits((prev) => prev.filter((_, idx) => idx !== i))
  }

  const mutation = useMutation({
    mutationFn: async (data: FormData): Promise<{ id: number; pairedId?: number }> => {
      const absAmount = Math.round(parseFloat(data.amount) * 100)
      const amount = data.type === 'credit' || data.type === 'starting_balance' ? absAmount : -absAmount

      // Validate splits if active
      if (isSplit) {
        if (splitTotalCents !== totalCents) {
          throw new Error(`Splits total ${formatMoney(splitTotalCents)} — must equal ${formatMoney(totalCents)}`)
        }
        const splitsPayload = splits.map((s) => ({
          categoryId: s.categoryId ? parseInt(s.categoryId, 10) : null,
          amount: Math.round(parseFloat(s.amount) * 100) * (amount < 0 ? -1 : 1),
          note: s.note || null,
        }))

        if (isEdit) {
          await transactionsApi.update(transaction!.id, {
            date: data.date,
            accountId: parseInt(data.accountId, 10),
            payee: data.payee || null,
            description: data.description || null,
            amount,
            categoryId: null,
            type: 'transaction',
            splits: splitsPayload,
            ignoreRules: data.ignoreRules,
          })
          return { id: transaction!.id }
        }
        return transactionsApi.create({
          date: data.date,
          accountId: parseInt(data.accountId, 10),
          payee: data.payee || null,
          description: data.description || null,
          amount,
          splits: splitsPayload,
          ignoreRules: data.ignoreRules,
        })
      }

      const investmentTicker = isInvestmentCategory && data.investmentTicker ? data.investmentTicker.toUpperCase() : null
      const investmentQuantity = isInvestmentCategory && data.investmentQuantity ? parseFloat(data.investmentQuantity) : null

      if (isEdit) {
        await transactionsApi.update(transaction!.id, {
          date: data.date,
          accountId: parseInt(data.accountId, 10),
          payee: data.payee || null,
          description: data.description || null,
          amount: data.type === 'transfer' ? Math.abs(amount) : amount,
          categoryId: data.type === 'transfer' ? null : (data.categoryId ? parseInt(data.categoryId, 10) : null),
          type: data.type === 'transfer' ? 'transfer' : 'transaction',
          transferToAccountId: data.type === 'transfer' && transaction?.type === 'transfer' && data.transferToAccountId
            ? parseInt(data.transferToAccountId, 10)
            : null,
          splits: [],
          ignoreRules: data.ignoreRules,
          investmentTicker,
          investmentQuantity,
        })
        return { id: transaction!.id }
      }

      if (data.type === 'starting_balance') {
        return transactionsApi.create({
          date: data.date,
          accountId: parseInt(data.accountId, 10),
          payee: data.payee || null,
          description: data.description || null,
          amount: absAmount,
          type: 'starting_balance',
        })
      }

      return transactionsApi.create({
        date: data.date,
        accountId: parseInt(data.accountId, 10),
        payee: data.payee || null,
        description: data.description || null,
        amount,
        categoryId: data.categoryId ? parseInt(data.categoryId, 10) : null,
        type: data.type === 'transfer' ? 'transfer' : 'transaction',
        transferToAccountId: data.transferToAccountId
          ? parseInt(data.transferToAccountId, 10)
          : null,
        ignoreRules: data.ignoreRules,
        investmentTicker,
        investmentQuantity,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      qc.invalidateQueries({ queryKey: ['payees'] })
      qc.invalidateQueries({ queryKey: ['investments'] })
      onClose()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => transactionsApi.delete(transaction!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      onClose()
    },
  })

  const canSplit = txType === 'debit' || txType === 'credit'

  const watchedCategoryId = watch('categoryId')
  const selectedCategory = categories?.find((c) => String(c.id) === watchedCategoryId)
  const isInvestmentCategory = Boolean(selectedCategory?.is_investment)
  const watchedTicker = watch('investmentTicker') ?? ''
  const watchedQty = watch('investmentQuantity') ?? ''

  // Auto-populate description when ticker and quantity are set for a new transaction
  useEffect(() => {
    if (!isInvestmentCategory || !watchedTicker || !watchedQty) return
    const currentDesc = watch('description')
    if (currentDesc) return
    const label = txType === 'credit' ? 'Sold' : 'Bought'
    setValue('description', `${label} ${watchedQty} ${watchedTicker.toUpperCase()}`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedTicker, watchedQty, isInvestmentCategory, txType])

  const CategorySelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <CategoryCombobox
      value={value}
      onChange={onChange}
      categories={categories ?? []}
      groups={groups ?? []}
      balances={balances}
    />
  )

  const modalTitle = isCover ? 'Cover Transfer' : isEdit ? 'Edit Transaction' : 'Add Transaction'

  return (
    <Modal open={open} onClose={onClose} title={modalTitle}>
      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" {...register('date')} error={errors.date?.message} />

          <Select label="Type" {...register('type')} disabled={isCover}>
            <option value="debit">Debit</option>
            <option value="credit">Credit</option>
            <option value="transfer">Transfer</option>
            {!isEdit && <option value="starting_balance">Starting Balance</option>}
          </Select>
        </div>

        <Select label="Account" {...register('accountId')} error={errors.accountId?.message}>
          <option value="">Select account...</option>
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>

        {txType === 'transfer' && (!isEdit || transaction?.type === 'transfer') && (
          <Select label="Transfer To" {...register('transferToAccountId')} disabled={isCover}>
            <option value="">Select account...</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        )}

        <PayeeCombobox
          value={watch('payee') ?? ''}
          onChange={(v) => setValue('payee', v)}
          payees={payees ?? []}
          disabled={isCover}
        />

        <Input
          label="Description"
          placeholder="Optional details"
          {...register('description')}
          disabled={isCover}
        />

        <Input
          label="Amount ($)"
          type="number"
          step="0.01"
          min="0.01"
          placeholder="0.00"
          {...register('amount')}
          error={errors.amount?.message}
          disabled={isCover}
        />

        {/* Investment fields */}
        {isInvestmentCategory && !isCover && canSplit && (
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Ticker"
              placeholder="e.g. VAS.AX"
              {...register('investmentTicker')}
            />
            <Input
              label="Quantity"
              type="number"
              step="0.0001"
              min="0.0001"
              placeholder="0.0000"
              {...register('investmentQuantity')}
            />
          </div>
        )}

        {/* Category / Split section */}
        {!isCover && canSplit && !(isEdit && !!transaction?.category_is_unlisted) && (
          isSplit ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-secondary uppercase tracking-wide">Splits</span>
                <button
                  type="button"
                  className="text-xs text-muted hover:text-primary transition-colors"
                  onClick={() => { setIsSplit(false); setSplits(blankSplits()); setSplitError(null) }}
                >
                  Remove split
                </button>
              </div>

              {splits.map((s, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="flex-1">
                    <CategorySelect value={s.categoryId} onChange={(v) => updateSplit(i, 'categoryId', v)} />
                  </div>
                  <div className="w-28">
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      value={s.amount}
                      onChange={(e) => { updateSplit(i, 'amount', e.target.value); setSplitError(null) }}
                      className="input-base text-sm text-right"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSplit(i)}
                    disabled={splits.length <= 2}
                    className="mt-1 p-1 text-muted hover:text-danger disabled:opacity-30 transition-colors"
                    aria-label="Remove split"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={addSplit}
                className="text-xs text-accent hover:text-accent/80 transition-colors"
              >
                + Add split
              </button>

              {/* Running total */}
              <div className={`text-xs px-3 py-2 rounded flex items-center justify-between ${
                splitRemainder === 0
                  ? 'bg-accent/10 text-accent'
                  : 'bg-surface-2 text-secondary'
              }`}>
                <span>{splitRemainder === 0 ? 'Fully allocated' : `Remaining: ${formatMoney(Math.abs(splitRemainder))}`}</span>
                <span className="font-mono">{formatMoney(splitTotalCents)} / {formatMoney(totalCents)}</span>
              </div>

              {splitError && <p className="text-xs text-danger">{splitError}</p>}
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-secondary uppercase tracking-wide">Category (optional)</span>
                <button
                  type="button"
                  className="text-xs text-muted hover:text-accent transition-colors"
                  onClick={() => setIsSplit(true)}
                >
                  Split
                </button>
              </div>
              <CategoryCombobox
                value={watch('categoryId') ?? ''}
                onChange={(v) => setValue('categoryId', v)}
                categories={categories ?? []}
                groups={groups ?? []}
                balances={balances}
              />
            </div>
          )
        )}

        {/* Read-only unlisted category */}
        {!isCover && txType !== 'transfer' && txType !== 'starting_balance' && isEdit && !!transaction?.category_is_unlisted && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-secondary uppercase tracking-wide">Category</label>
            <div className="input-base text-sm text-muted cursor-not-allowed">
              {transaction.category_name ?? 'Uncategorised'}
            </div>
          </div>
        )}

        {!isCover && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" {...register('ignoreRules')} className="w-4 h-4 accent-accent" />
            <span className="text-sm text-secondary">Ignore rules</span>
          </label>
        )}

        {mutation.isError && (
          <p className="text-sm text-danger">{(mutation.error as Error).message}</p>
        )}

        <div className="flex items-center gap-3 pt-2 pb-safe">
          {isEdit && (
            <Button
              type="button"
              variant="danger"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {isEdit ? 'Save' : 'Add'}
          </Button>
        </div>
        <ConfirmModal
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => { deleteMutation.mutate(); setConfirmDelete(false) }}
          title="Delete Transaction"
          message="Are you sure you want to delete this transaction? This cannot be undone."
          loading={deleteMutation.isPending}
        />
      </form>
    </Modal>
  )
}

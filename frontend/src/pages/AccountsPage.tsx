import { useState, useEffect } from 'react'
import { useLocalStorageBool } from '../hooks/useLocalStorageBool'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DraggableAttributes,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { format, parseISO, startOfWeek } from 'date-fns'
import { accountsApi, Account, AccountInput, AccountCreateInput } from '../api/accounts'
import { transactionsApi, Transaction } from '../api/transactions'
import { budgetApi } from '../api/budget'
import { settingsApi } from '../api/settings'
import { formatMoney, Amount } from '../components/ui/AmountDisplay'
import { Modal } from '../components/ui/Modal'
import { ConfirmModal } from '../components/ui/ConfirmModal'
import { Button } from '../components/ui/Button'
import { Input, Select, Textarea } from '../components/ui/Input'
import { TransactionForm } from '../components/transactions/TransactionForm'
import { ImportWizard } from '../components/transactions/ImportWizard'
import { BulkEditModal } from '../components/transactions/BulkEditModal'
import { CategoryCombobox } from '../components/ui/CategoryCombobox'
import { SearchableSelect } from '../components/ui/SearchableSelect'
import { useResizableCols, ResizeHandle } from '../hooks/useResizableCols'

const DEFAULT_COL_WIDTHS = {
  date: 68, account: 205, payee: 160, description: 240, category: 160, amount: 110,
}

function ReconcileModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const qc = useQueryClient()
  const [actualBalance, setActualBalance] = useState('')
  const today = format(new Date(), 'yyyy-MM-dd')
  const [date, setDate] = useState(today)

  const actualBalanceCents = actualBalance !== '' ? Math.round(parseFloat(actualBalance) * 100) : null
  const adjustment = actualBalanceCents !== null ? actualBalanceCents - account.currentBalance : null
  const isBalanced = adjustment === 0

  const mutation = useMutation({
    mutationFn: () =>
      accountsApi.reconcile(account.id, { actualBalance: actualBalanceCents!, date }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      onClose()
    },
  })

  return (
    <Modal open onClose={onClose} title={`Reconcile ${account.name}`}>
      <div className="space-y-4">
        <div className="flex items-center justify-between py-2 border-b border-border">
          <span className="text-sm text-secondary">Current balance</span>
          <span className={`font-mono font-bold ${account.currentBalance < 0 ? 'text-danger' : 'text-accent'}`}>
            {formatMoney(account.currentBalance)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Actual Balance ($)"
            type="number"
            step="0.01"
            placeholder="0.00"
            value={actualBalance}
            onChange={(e) => setActualBalance(e.target.value)}
            autoFocus
          />
          <Input
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {adjustment !== null && (
          <div className={`text-sm px-3 py-2 rounded ${isBalanced ? 'bg-accent/10 text-accent' : 'bg-surface-2 text-secondary'}`}>
            {isBalanced
              ? 'Account is already balanced — no transaction will be created.'
              : `A ${adjustment > 0 ? 'credit' : 'debit'} of ${formatMoney(Math.abs(adjustment))} will be created.`}
          </div>
        )}

        {mutation.isError && (
          <p className="text-sm text-danger">{(mutation.error as Error).message}</p>
        )}

        <div className="flex items-center gap-3 pt-2">
          <div className="flex-1" />
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => isBalanced ? onClose() : mutation.mutate()}
            loading={mutation.isPending}
            disabled={actualBalanceCents === null || isNaN(actualBalanceCents)}
          >
            {isBalanced ? 'Done' : 'Reconcile'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

const baseAccountSchema = z.object({
  name: z.string().min(1, 'Required'),
  type: z.enum(['transactional', 'savings', 'debt']),
  notes: z.string().optional(),
  goalAmount: z.string().optional(),
  goalTargetDate: z.string().optional(),
})

const createAccountSchema = baseAccountSchema.extend({
  startingBalance: z.string(),
  startingBalanceDate: z.string(),
})

type CreateAccountFormData = z.infer<typeof createAccountSchema>

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function MonthYearPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 31 }, (_, i) => currentYear + i)

  const [year, month] = value ? value.split('-') : ['', '']
  const [localMonth, setLocalMonth] = useState(month ? String(parseInt(month, 10)) : '')
  const [localYear, setLocalYear] = useState(year || '')

  const handleMonth = (m: string) => {
    setLocalMonth(m)
    if (m && localYear) onChange(`${localYear}-${m.padStart(2, '0')}`)
    else if (!m) onChange('')
  }

  const handleYear = (y: string) => {
    setLocalYear(y)
    if (y && localMonth) onChange(`${y}-${localMonth.padStart(2, '0')}`)
    else if (!y) onChange('')
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-secondary uppercase tracking-wide">Target Date</span>
      <div className="grid grid-cols-2 gap-2">
        <select className="input-base" value={localMonth} onChange={(e) => handleMonth(e.target.value)}>
          <option value="">Month</option>
          {MONTHS.map((name, i) => (
            <option key={i} value={String(i + 1)}>{name}</option>
          ))}
        </select>
        <select className="input-base" value={localYear} onChange={(e) => handleYear(e.target.value)}>
          <option value="">Year</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>{y}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

function AccountForm({ account, onClose }: { account?: Account | null; onClose: () => void }) {
  const qc = useQueryClient()
  const isEdit = !!account
  const isClosed = !!account?.closedAt
  const today = format(new Date(), 'yyyy-MM-dd')

  const [closeStep, setCloseStep] = useState<'idle' | 'confirm' | 'transfer' | 'negative'>('idle')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [transferToId, setTransferToId] = useState('')

  const { data: openAccounts } = useQuery({ queryKey: ['accounts'], queryFn: () => accountsApi.list() })
  const transferTargets = openAccounts?.filter((a) => a.id !== account?.id) ?? []

  const { register, watch, handleSubmit, control, formState: { errors } } = useForm<CreateAccountFormData>({
    resolver: zodResolver(isEdit ? baseAccountSchema : createAccountSchema),
    defaultValues: {
      name: account?.name ?? '',
      type: account?.type ?? 'transactional',
      notes: account?.notes ?? '',
      goalAmount: account?.goalAmount ? (account.goalAmount / 100).toFixed(2) : '',
      goalTargetDate: account?.goalTargetDate ?? '',
      startingBalance: '0.00',
      startingBalanceDate: today,
    },
  })

  const watchedType = watch('type')

  const mutation = useMutation({
    mutationFn: async (data: AccountInput | AccountCreateInput): Promise<{ id: number }> => {
      if (isEdit) {
        await accountsApi.update(account!.id, data as AccountInput)
        return { id: account!.id }
      }
      return accountsApi.create(data as AccountCreateInput)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      onClose()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => accountsApi.delete(account!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      onClose()
    },
  })

  const closeMutation = useMutation({
    mutationFn: (transferToAccountId?: number) => accountsApi.close(account!.id, transferToAccountId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      onClose()
    },
  })

  const reopenMutation = useMutation({
    mutationFn: () => accountsApi.reopen(account!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      onClose()
    },
  })

  const handleCloseAccount = () => {
    if (account!.currentBalance < 0) {
      setCloseStep('negative')
    } else if (account!.currentBalance === 0) {
      setCloseStep('confirm')
    } else {
      setCloseStep('transfer')
    }
  }

  const handleTransferAndClose = () => {
    if (!transferToId) return
    closeMutation.mutate(parseInt(transferToId, 10))
  }

  const onSubmit = (data: CreateAccountFormData) => {
    const goalCents = data.type === 'savings' && data.goalAmount
      ? Math.round(parseFloat(data.goalAmount) * 100) || null
      : null
    const goalTargetDate = data.type === 'savings' && data.goalTargetDate ? data.goalTargetDate : null
    if (isEdit) {
      mutation.mutate({ name: data.name, type: data.type, notes: data.notes || null, goalAmount: goalCents, goalTargetDate })
    } else {
      const balanceCents = Math.round(parseFloat(data.startingBalance || '0') * 100)
      mutation.mutate({
        name: data.name,
        type: data.type,
        notes: data.notes || null,
        goalAmount: goalCents,
        goalTargetDate,
        startingBalance: balanceCents || undefined,
        startingBalanceDate: balanceCents ? data.startingBalanceDate : undefined,
      })
    }
  }

  if (closeStep === 'confirm') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-secondary">
          Are you sure you want to close <span className="font-medium text-primary">{account!.name}</span>? It will become read-only and hidden from the UI.
        </p>
        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost" type="button" onClick={() => setCloseStep('idle')}>Cancel</Button>
          <Button variant="danger" type="button" onClick={() => closeMutation.mutate(undefined)} loading={closeMutation.isPending}>Close Account</Button>
        </div>
      </div>
    )
  }

  if (closeStep === 'negative') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-danger">
          Account cannot be closed while the balance is negative. Please zero the account before closing.
        </p>
        <div className="flex justify-end">
          <Button variant="ghost" type="button" onClick={() => setCloseStep('idle')}>Back</Button>
        </div>
      </div>
    )
  }

  if (closeStep === 'transfer') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-secondary">
          <span className="font-medium text-primary">{account!.name}</span> has a balance of{' '}
          <span className={`font-mono font-semibold ${account!.currentBalance < 0 ? 'text-danger' : 'text-accent'}`}>
            {formatMoney(account!.currentBalance)}
          </span>
          . Select an account to transfer the funds into before closing.
        </p>
        <Select
          label="Transfer funds to"
          value={transferToId}
          onChange={(e) => setTransferToId(e.target.value)}
        >
          <option value="">Select account…</option>
          {transferTargets.map((a) => (
            <option key={a.id} value={String(a.id)}>{a.name}</option>
          ))}
        </Select>
        {closeMutation.isError && (
          <p className="text-sm text-danger">{(closeMutation.error as Error).message}</p>
        )}
        <div className="flex items-center gap-3 pt-2">
          <Button variant="ghost" type="button" onClick={() => setCloseStep('idle')}>Back</Button>
          <div className="flex-1" />
          <Button
            variant="danger"
            type="button"
            onClick={handleTransferAndClose}
            loading={closeMutation.isPending}
            disabled={!transferToId}
          >
            Transfer &amp; Close
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit as (data: CreateAccountFormData) => void)} className="space-y-4">
      <Input label="Account Name" {...register('name')} error={errors.name?.message} autoFocus disabled={isClosed} />
      <Select label="Type" {...register('type')} disabled={isClosed}>
        <option value="transactional">Transactional</option>
        <option value="savings">Savings</option>
        <option value="debt">Debt</option>
      </Select>
      {watchedType === 'savings' && (
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Goal ($)"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            {...register('goalAmount')}
            disabled={isClosed}
          />
          <Controller
            name="goalTargetDate"
            control={control}
            render={({ field }) => (
              <MonthYearPicker value={field.value ?? ''} onChange={field.onChange} />
            )}
          />
        </div>
      )}
      {!isEdit && (
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Starting Balance ($)"
            type="number"
            step="0.01"
            {...register('startingBalance')}
            hint="Creates a Starting Balance transaction"
          />
          <Input
            label="As of date"
            type="date"
            {...register('startingBalanceDate')}
          />
        </div>
      )}
      <Textarea label="Notes (optional)" {...register('notes')} rows={2} disabled={isClosed} />
      {mutation.isError && (
        <p className="text-sm text-danger">{(mutation.error as Error).message}</p>
      )}
      {isEdit && !isClosed ? (
        <div className="grid grid-cols-2 gap-x-2 gap-y-5 pt-2 sm:flex sm:items-center sm:gap-3">
          <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)} className="w-full sm:w-auto px-2 sm:px-4">Delete</Button>
          <Button type="button" variant="ghost" onClick={handleCloseAccount} loading={closeMutation.isPending} className="w-full sm:w-auto px-2 sm:px-4 text-muted hover:text-secondary border border-border">Close Account</Button>
          <Button variant="ghost" type="button" onClick={onClose} className="w-full sm:w-auto px-2 sm:px-4 sm:ml-auto">Cancel</Button>
          <Button type="submit" loading={mutation.isPending} className="w-full sm:w-auto px-2 sm:px-4">Save</Button>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2 pt-2">
          {isEdit && isClosed && (
            <Button type="button" variant="ghost" onClick={() => reopenMutation.mutate()} loading={reopenMutation.isPending}>Reopen Account</Button>
          )}
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          {!isClosed && <Button type="submit" loading={mutation.isPending}>Add Account</Button>}
        </div>
      )}
      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => { deleteMutation.mutate(); setConfirmDelete(false) }}
        title="Delete Account"
        message={`Are you sure you want to delete "${account?.name}"? This cannot be undone.`}
        loading={deleteMutation.isPending}
      />
    </form>
  )
}

type SyntheticListenerMap = Record<string, (event: Event) => void>

function GripHandle({ listeners, attributes }: { listeners?: SyntheticListenerMap; attributes?: DraggableAttributes }) {
  return (
    <div
      {...attributes}
      {...(listeners as React.HTMLAttributes<HTMLDivElement> | undefined)}
      className="cursor-grab active:cursor-grabbing touch-none text-muted hover:text-secondary opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-5 shrink-0"
      onClick={(e) => e.stopPropagation()}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
        <circle cx="5" cy="2.5" r="1.1" />
        <circle cx="9" cy="2.5" r="1.1" />
        <circle cx="5" cy="7" r="1.1" />
        <circle cx="9" cy="7" r="1.1" />
        <circle cx="5" cy="11.5" r="1.1" />
        <circle cx="9" cy="11.5" r="1.1" />
      </svg>
    </div>
  )
}

function SortableAccountRow({
  account,
  onEdit,
  onReconcile,
  onSelect,
  isSelected,
}: {
  account: Account
  onEdit: () => void
  onReconcile: () => void
  onSelect: () => void
  isSelected: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: account.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : undefined }

  const typeLabel = account.type.charAt(0).toUpperCase() + account.type.slice(1)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 pl-7 md:pl-2 pr-4 py-1.5 cursor-pointer group border-t border-border transition-colors ${isSelected ? 'bg-accent/10' : 'hover:bg-surface-2/50'}`}
      onClick={onSelect}
    >
      <div className="hidden md:flex">
        <GripHandle listeners={listeners as SyntheticListenerMap | undefined} attributes={attributes} />
      </div>
      <div className="w-36 min-w-0 shrink-0">
        <div className={`text-sm font-medium truncate ${isSelected ? 'text-accent' : 'text-primary'}`}>{account.name}</div>
        <div className="text-xs text-muted sm:hidden">{typeLabel}</div>
      </div>
      <div className="hidden sm:block w-28 shrink-0">
        <span className="text-sm text-secondary">{typeLabel}</span>
      </div>
      <div className="hidden sm:block flex-1 min-w-0">
        <span className="text-sm text-muted truncate block">{account.notes ?? ''}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <div className="text-right">
          <div className={`text-sm font-bold font-mono ${account.currentBalance < 0 ? 'text-danger' : 'text-accent'}`}>
            {formatMoney(account.currentBalance)}
          </div>
          {account.goalAmount != null && (
            <div className="text-xs text-muted">
              {Math.min(Math.round(Math.max(account.currentBalance, 0) / account.goalAmount * 100), 100)}% of {formatMoney(account.goalAmount)}
            </div>
          )}
        </div>
        <button
          title="Edit account"
          className="p-1 rounded text-muted hover:text-primary transition-colors"
          onClick={(e) => { e.stopPropagation(); onEdit() }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        <button
          title="Reconcile"
          className="hidden sm:block p-1 rounded text-muted hover:text-primary transition-colors"
          onClick={(e) => { e.stopPropagation(); onReconcile() }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function ClosedAccountRow({ account, onEdit }: { account: Account; onEdit: () => void }) {
  const typeLabel = account.type.charAt(0).toUpperCase() + account.type.slice(1)
  return (
    <div className="flex items-center gap-2 pl-7 md:pl-9 pr-4 py-1.5 border-t border-border opacity-50">
      <div className="w-36 min-w-0 shrink-0">
        <div className="text-sm font-medium truncate text-secondary">{account.name}</div>
        <div className="text-xs text-muted sm:hidden">{typeLabel}</div>
      </div>
      <div className="hidden sm:block w-28 shrink-0">
        <span className="text-sm text-muted">{typeLabel}</span>
      </div>
      <div className="hidden sm:block flex-1 min-w-0">
        <span className="text-xs font-medium text-muted uppercase tracking-wide border border-border rounded px-1.5 py-0.5">Closed</span>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <div className="text-right">
          <div className="text-sm font-bold font-mono text-muted">{formatMoney(account.currentBalance)}</div>
        </div>
        <button
          title="Edit account"
          className="p-1 rounded text-muted hover:text-primary transition-colors"
          onClick={(e) => { e.stopPropagation(); onEdit() }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        {/* Spacer to align with open account rows that have a reconcile button */}
        <div className="hidden sm:block w-6" />
      </div>
    </div>
  )
}

export function AccountsPage() {
  const qc = useQueryClient()

  // Collapse state
  const [accountsCollapsed, setAccountsCollapsed] = useLocalStorageBool('dosh:collapsed:accounts', false)
  const [transactionsCollapsed, setTransactionsCollapsed] = useLocalStorageBool('dosh:collapsed:transactions', false)
  const [showRunningBalance, setShowRunningBalance] = useLocalStorageBool('dosh:show-running-balance', false)

  // Account state
  const [accountModal, setAccountModal] = useState<{ open: boolean; account?: Account | null }>({ open: false })
  const [reconcileAccount, setReconcileAccount] = useState<Account | null>(null)
  const [orderedAccounts, setOrderedAccounts] = useState<Account[]>([])
  const [showClosed, setShowClosed] = useLocalStorageBool('dosh:show-closed-accounts', false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  // Transaction state
  const [filters, setFilters] = useState({ startDate: '', endDate: '', accountId: '', categoryId: '', payee: '', search: '' })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [uncategorisedOnly, setUncategorisedOnly] = useState(false)
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [addTxOpen, setAddTxOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [page, setPage] = useState(0)

  const PAGE_SIZE = 100

  const { data: accounts, isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts', { includeClosed: showClosed }],
    queryFn: () => accountsApi.list(showClosed),
  })

  const closedAccounts = accounts?.filter((a) => !!a.closedAt) ?? []

  useEffect(() => {
    if (accounts) setOrderedAccounts(accounts.filter((a) => !a.closedAt))
  }, [accounts])

  const handleAccountDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrderedAccounts((all) => {
      const oldIdx = all.findIndex((a) => a.id === active.id)
      const newIdx = all.findIndex((a) => a.id === over.id)
      const reordered = arrayMove(all, oldIdx, newIdx)
      accountsApi.reorder(reordered.map((a, i) => ({ id: a.id, sortOrder: i })))
      return reordered
    })
  }

  const { data: categories } = useQuery({ queryKey: ['budget', 'categories-flat'], queryFn: budgetApi.getCategories })
  const { data: groups } = useQuery({ queryKey: ['budget', 'groups'], queryFn: budgetApi.getGroups })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get })
  const weekStartsOn: 0 | 1 = settings?.week_start_day === '1' ? 1 : 0
  const currentWeekStart = format(startOfWeek(new Date(), { weekStartsOn }), 'yyyy-MM-dd')
  const { data: currentBudget } = useQuery({
    queryKey: ['budget', currentWeekStart],
    queryFn: () => budgetApi.getWeek(currentWeekStart),
  })
  const categoryBalances: Record<number, number> = {}
  for (const g of currentBudget?.groups ?? []) {
    for (const c of g.categories) categoryBalances[c.id] = c.balance
  }
  const { data: payees } = useQuery({ queryKey: ['transactions', 'payees'], queryFn: transactionsApi.payees })
  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['transactions', filters, uncategorisedOnly, page],
    queryFn: () =>
      transactionsApi.list({
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
        accountId: filters.accountId ? parseInt(filters.accountId, 10) : undefined,
        categoryId: filters.categoryId ? parseInt(filters.categoryId, 10) : undefined,
        payee: filters.payee || undefined,
        uncategorised: uncategorisedOnly || undefined,
        search: filters.search || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  })
  const transactions = txData?.items
  const totalTransactions = txData?.total ?? 0
  const totalPages = Math.ceil(totalTransactions / PAGE_SIZE)

  const { data: uncategorisedData } = useQuery({
    queryKey: ['transactions', 'uncategorised-count'],
    queryFn: transactionsApi.uncategorisedCount,
  })

  const assignCategory = useMutation({
    mutationFn: ({ id, tx, categoryId }: { id: number; tx: Transaction; categoryId: number | null }) =>
      transactionsApi.update(id, {
        date: tx.date,
        accountId: tx.account_id,
        payee: tx.payee,
        description: tx.description,
        amount: tx.amount,
        categoryId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
    },
  })

  const bulkDelete = useMutation({
    mutationFn: (ids: number[]) => transactionsApi.bulkDelete(ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      setSelectedIds(new Set())
    },
  })


  const selectableIds = transactions?.map((t) => t.id) ?? []
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))
  const someSelected = selectedIds.size > 0

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(selectableIds))
    }
  }

  const toggleOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const { widths, onResizeStart } = useResizableCols(DEFAULT_COL_WIDTHS, 'dosh:tx-col-widths-v2')

  const setFilter = (key: string, value: string) => { setFilters((prev) => ({ ...prev, [key]: value })); setPage(0) }
  const clearFilters = () => {
    setFilters({ startDate: '', endDate: '', accountId: '', categoryId: '', payee: '', search: '' })
    setUncategorisedOnly(false)
    setPage(0)
  }
  const hasFilters = Object.values(filters).some(Boolean) || uncategorisedOnly

  const openAccountsAll = accounts?.filter((a) => !a.closedAt) ?? []
  const totalBalance = openAccountsAll.reduce((sum, a) => sum + a.currentBalance, 0)
  const transactionalTotal = openAccountsAll.filter((a) => a.type === 'transactional').reduce((sum, a) => sum + a.currentBalance, 0)
  const savingsTotal = openAccountsAll.filter((a) => a.type === 'savings').reduce((sum, a) => sum + a.currentBalance, 0)
  const debtTotal = openAccountsAll.filter((a) => a.type === 'debt').reduce((sum, a) => sum + a.currentBalance, 0)
  const hasDebt = openAccountsAll.some((a) => a.type === 'debt')

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-3 md:px-6">
      {/* Accounts header */}
      <div className="flex items-center justify-between gap-2">
        <button
          className="flex items-center gap-2 text-xl font-bold text-primary hover:text-accent transition-colors"
          onClick={() => setAccountsCollapsed((c) => !c)}
        >
          <svg className={`w-4 h-4 transition-transform duration-150 ${accountsCollapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          Accounts
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <button
            className={`text-xs px-2 py-1 rounded border transition-colors ${showClosed ? 'border-accent text-accent' : 'border-border text-muted hover:text-secondary'}`}
            onClick={() => setShowClosed((v) => !v)}
          >
            {showClosed ? 'Hide closed' : 'Show closed'}
          </button>
          <Button size="sm" onClick={() => setAccountModal({ open: true, account: null })}>
            + Add Account
          </Button>
        </div>
      </div>

      {!accountsCollapsed && (
      <>
      {/* Desktop summary cards */}
      <div className={`hidden sm:grid gap-3 ${hasDebt ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
        {[
          { label: 'Net Worth', value: totalBalance },
          { label: 'Transactional', value: transactionalTotal },
          { label: 'Savings', value: savingsTotal },
          ...(hasDebt ? [{ label: 'Debt', value: debtTotal }] : []),
        ].map(({ label, value }) => (
          <div key={label} className="border border-border p-4 bg-white/5 rounded-xl">
            <div className="text-xs text-muted mb-1 truncate">{label}</div>
            <div className={`text-lg font-bold font-mono truncate ${value < 0 ? 'text-danger' : 'text-accent'}`}>
              {formatMoney(value)}
            </div>
          </div>
        ))}
      </div>

      {/* Account list grouped by type (mobile net worth card sits above groups with consistent spacing) */}
      {accountsLoading ? (
        <div className="text-center py-12 text-secondary">Loading...</div>
      ) : orderedAccounts.length === 0 && closedAccounts.length === 0 ? (
        <div className="border-y border-border px-5 py-12 text-center text-secondary -mx-4 md:mx-0">No accounts yet.</div>
      ) : (
        <div className="-mx-4 md:mx-0 overflow-hidden md:rounded-t-lg">
          {/* Header */}
          <div className="flex items-center gap-2 pl-7 md:pl-9 pr-4 py-1.5 border-b border-border bg-white/5">
            <div className="w-36 shrink-0">
              <span className="text-xs font-medium text-muted uppercase tracking-wide">Name</span>
            </div>
            <div className="hidden sm:block w-28 shrink-0">
              <span className="text-xs font-medium text-muted uppercase tracking-wide">Type</span>
            </div>
            <div className="hidden sm:block flex-1 min-w-0">
              <span className="text-xs font-medium text-muted uppercase tracking-wide">Notes</span>
            </div>
            <div className="ml-auto shrink-0 pr-16">
              <span className="text-xs font-medium text-muted uppercase tracking-wide">Balance</span>
            </div>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleAccountDragEnd}>
            <SortableContext items={orderedAccounts.map((a) => a.id)} strategy={verticalListSortingStrategy}>
              {orderedAccounts.map((account) => (
                <SortableAccountRow
                  key={account.id}
                  account={account}
                  onEdit={() => setAccountModal({ open: true, account })}
                  onReconcile={() => setReconcileAccount(account)}
                  onSelect={() => {
                    const id = String(account.id)
                    const next = filters.accountId === id ? '' : id
                    setFilter('accountId', next)
                    setTransactionsCollapsed(false)
                    if (next) setFiltersOpen(true)
                    else setFiltersOpen(false)
                  }}
                  isSelected={filters.accountId === String(account.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
          {showClosed && closedAccounts.map((account) => (
            <ClosedAccountRow
              key={account.id}
              account={account}
              onEdit={() => setAccountModal({ open: true, account })}
            />
          ))}
          {/* Mobile: Net Worth footer */}
          <div className="flex items-center justify-between px-4 py-2 sm:hidden border-t border-b border-border">
            <span className="text-xs font-medium text-muted uppercase tracking-wide">Net Worth</span>
            <span className={`text-xs font-bold font-mono ${totalBalance < 0 ? 'text-danger' : 'text-accent'}`}>
              {formatMoney(totalBalance)}
            </span>
          </div>
        </div>
      )}

      </>
      )}

      {/* Transactions header */}
      <div className="flex items-center justify-between gap-2">
        <button
          className="flex items-center gap-2 text-lg font-semibold text-primary hover:text-accent transition-colors shrink-0"
          onClick={() => setTransactionsCollapsed((c) => !c)}
        >
          <svg className={`w-4 h-4 transition-transform duration-150 ${transactionsCollapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          Transactions
        </button>
        <div className="flex items-center gap-2">
          {someSelected && (
            <>
              <span className="text-sm text-secondary shrink-0">{selectedIds.size} selected</span>
              <Button size="sm" variant="outline" onClick={() => setBulkEditOpen(true)}>Edit</Button>
              <Button
                size="sm"
                variant="danger"
                loading={bulkDelete.isPending}
                onClick={() => {
                  if (confirm(`Delete ${selectedIds.size} transaction${selectedIds.size !== 1 ? 's' : ''}?`)) {
                    bulkDelete.mutate([...selectedIds])
                  }
                }}
              >
                Delete
              </Button>
              <button className="text-xs text-muted hover:text-primary shrink-0" onClick={() => setSelectedIds(new Set())}>Clear</button>
              <div className="w-px h-4 bg-border shrink-0" />
            </>
          )}
          {/* Desktop only: running balance toggle */}
          <label className="hidden sm:flex items-center gap-1.5 cursor-pointer select-none shrink-0">
            <span className="text-xs text-muted">Balance</span>
            <button
              type="button"
              role="switch"
              aria-checked={showRunningBalance}
              onClick={() => setShowRunningBalance((v) => !v)}
              className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors focus:outline-none ${showRunningBalance ? 'bg-accent' : 'bg-surface-3'}`}
            >
              <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${showRunningBalance ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
            </button>
          </label>
          {!!uncategorisedData?.count && (
            <>
              {/* Mobile: ? icon */}
              <button
                className={`sm:hidden p-1.5 rounded transition-colors ${uncategorisedOnly ? 'text-danger bg-danger/20' : 'text-danger hover:bg-danger/20'}`}
                onClick={() => { setUncategorisedOnly((v) => !v); setPage(0) }}
                aria-label="Show uncategorised"
              >
                <span className="text-lg font-bold leading-none">?</span>
              </button>
              {/* Desktop: text badge */}
              <button
                className={`hidden sm:block text-xs px-2 py-1 rounded transition-colors ${uncategorisedOnly ? 'bg-danger/20 text-danger' : 'bg-danger/15 text-danger hover:bg-danger/25'}`}
                onClick={() => { setUncategorisedOnly((v) => !v); setPage(0) }}
              >
                {uncategorisedData.count} Uncategorised
              </button>
            </>
          )}
          <button
            className={`p-1.5 rounded transition-colors ${searchOpen ? 'text-accent bg-accent/10' : 'text-muted hover:text-primary'}`}
            onClick={() => setSearchOpen((o) => !o)}
            aria-label="Toggle search"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
          </button>
          <button
            className={`p-1.5 rounded transition-colors ${filtersOpen ? 'text-accent bg-accent/10' : 'text-muted hover:text-primary'}`}
            onClick={() => setFiltersOpen((o) => { if (o) clearFilters(); return !o; })}
            aria-label="Toggle filters"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </button>
          {/* Upload: desktop only */}
          <button
            className="hidden sm:block p-1.5 rounded text-muted hover:text-primary transition-colors"
            onClick={() => setImportOpen(true)}
            aria-label="Import CSV"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </button>
          {/* Add: mobile = icon, desktop = button */}
          <button
            className="sm:hidden p-1.5 rounded transition-colors text-muted hover:text-primary"
            onClick={() => setAddTxOpen(true)}
            aria-label="Add transaction"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <Button size="sm" onClick={() => setAddTxOpen(true)} className="hidden sm:inline-flex">+ Add</Button>
        </div>
      </div>

      {searchOpen && (
        <input
          type="text"
          placeholder="Search transactions..."
          value={filters.search}
          onChange={(e) => setFilter('search', e.target.value)}
          autoFocus
          className="input-base text-sm w-full"
        />
      )}

      {!transactionsCollapsed && filtersOpen && (
        <div className="card p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted uppercase tracking-wide">From</label>
              <input type="date" value={filters.startDate} onChange={(e) => setFilter('startDate', e.target.value)} className="input-base text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted uppercase tracking-wide">To</label>
              <input type="date" value={filters.endDate} onChange={(e) => setFilter('endDate', e.target.value)} className="input-base text-sm" />
            </div>
            <SearchableSelect
              label="Account"
              value={filters.accountId}
              onChange={(v) => setFilter('accountId', v)}
              items={openAccountsAll.map((a) => ({ id: String(a.id), label: a.name }))}
              allLabel="All accounts"
            />
            <SearchableSelect
              label="Payee"
              value={filters.payee}
              onChange={(v) => setFilter('payee', v)}
              items={(payees ?? []).map((p) => ({ id: p, label: p }))}
              allLabel="All payees"
            />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted uppercase tracking-wide">Category</label>
              <CategoryCombobox
                value={filters.categoryId}
                onChange={(v) => setFilter('categoryId', v)}
                categories={(categories as Array<{ id: number; group_id: number; name: string }> | undefined) ?? []}
                groups={groups ?? []}
                placeholder="All categories"
                showClear
              />
            </div>
          </div>
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-muted hover:text-primary">Clear filters</button>
          )}
        </div>
      )}


      {/* Transaction list */}
      {!transactionsCollapsed && <div className="card overflow-hidden -mx-4 rounded-none md:rounded-t-lg border-x-0 border-t-0 bg-transparent md:mx-0">
        {txLoading ? (
          <div className="text-center py-12 text-secondary">Loading...</div>
        ) : transactions?.length === 0 ? (
          <div className="text-center py-12 text-secondary">
            No transactions found.
            {!hasFilters && (
              <div className="mt-2">
                <button className="text-accent text-sm" onClick={() => setImportOpen(true)}>Import your first CSV</button>
              </div>
            )}
          </div>
        ) : (
          <table className="w-full text-sm table-fixed">
              <thead>
                <tr className="border-b border-border text-xs text-muted uppercase tracking-wide bg-white/5">
                  <th className="pl-3 pr-1 py-3 w-8 hidden sm:table-cell">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
                      onChange={toggleAll}
                      className="w-3.5 h-3.5 accent-accent cursor-pointer"
                    />
                  </th>
                  <th className="pl-2 pr-1 py-3 text-left font-medium relative sm:px-3" style={{ width: widths.date }}>
                    Date
                    <ResizeHandle onMouseDown={(e) => onResizeStart('date', e)} />
                  </th>
                  <th className="pl-5 pr-3 py-3 text-left font-medium relative sm:px-3" style={{ width: widths.account }}>
                    Account
                    <ResizeHandle onMouseDown={(e) => onResizeStart('account', e)} />
                  </th>
                  <th className="px-3 py-3 text-left font-medium hidden sm:table-cell relative" style={{ width: widths.payee }}>
                    Payee
                    <ResizeHandle onMouseDown={(e) => onResizeStart('payee', e)} />
                  </th>
                  <th className="px-3 py-3 text-left font-medium hidden lg:table-cell relative" style={{ width: widths.description }}>
                    Description
                    <ResizeHandle onMouseDown={(e) => onResizeStart('description', e)} />
                  </th>
                  <th className="px-3 py-3 text-left font-medium hidden md:table-cell relative" style={{ width: widths.category }}>
                    Category
                    <ResizeHandle onMouseDown={(e) => onResizeStart('category', e)} />
                  </th>
                  <th className="pl-2 pr-3 py-3 text-right font-medium min-w-[100px]" style={{ width: widths.amount }}>Amount</th>
                  {showRunningBalance && (
                    <th className="hidden sm:table-cell pl-2 pr-3 py-3 text-right font-medium w-28">Balance</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {transactions?.map((tx) => (
                  <>
                  <tr
                    key={tx.id}
                    className={`border-b ${tx.splits.length > 0 ? 'border-border/20' : 'border-border/50'} hover:bg-surface-2/50 cursor-pointer ${selectedIds.has(tx.id) ? 'bg-surface-2/30' : ''}`}
                    onClick={() => {
                      if (someSelected) { toggleOne(tx.id); return }
                      setEditTx(tx)
                    }}
                  >
                    <td className="pl-3 pr-1 py-2.5 w-px hidden sm:table-cell" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(tx.id)}
                        onChange={() => toggleOne(tx.id)}
                        className="w-3.5 h-3.5 accent-accent cursor-pointer"
                      />
                    </td>
                    <td className="pl-2 pr-1 py-2.5 font-mono text-xs text-primary whitespace-nowrap sm:px-4">
                      {format(parseISO(tx.date), 'dd/MM/yy')}
                    </td>
                    <td className="pl-5 pr-2 py-2.5 sm:px-3 overflow-hidden">
                      <div className="text-sm text-primary truncate">{tx.account_name}</div>
                      <div className="text-xs mt-0.5 truncate sm:hidden">
                        {tx.splits.length > 0
                          ? <span className="text-muted italic">Split</span>
                          : tx.category_name
                            ? <span className="text-secondary">{tx.category_name}</span>
                            : <span className="text-muted italic">Uncategorised</span>
                        }
                      </div>
                      {tx.description && (
                        <div className="text-xs text-secondary mt-0.5 truncate sm:hidden">
                          {tx.description}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 hidden sm:table-cell text-sm text-primary overflow-hidden">
                      <span className="truncate block">{tx.payee || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 hidden lg:table-cell text-sm text-primary overflow-hidden">
                      <span className="truncate block">{tx.description || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell overflow-hidden" onClick={(e) => e.stopPropagation()}>
                      {tx.splits.length > 0 ? (
                        <span className="text-sm text-muted italic">Split</span>
                      ) : tx.type === 'transaction' ? (
                        tx.category_is_unlisted ? (
                          <span className="text-sm text-secondary">{tx.category_name}</span>
                        ) : (
                          <CategoryCombobox
                            value={tx.category_id ? String(tx.category_id) : ''}
                            onChange={(v) => assignCategory.mutate({ id: tx.id, tx, categoryId: v ? parseInt(v, 10) : null })}
                            categories={(categories as Array<{ id: number; group_id: number; name: string }> | undefined) ?? []}
                            groups={groups ?? []}
                            placeholder="Assign category"
                            buttonClassName={`text-sm text-left ${tx.category_name ? 'text-primary hover:text-accent' : 'text-muted hover:text-accent italic'} transition-colors`}
                            showSplit={tx.splits.length === 0}
                            onSplitClick={() => setEditTx(tx)}
                            balances={categoryBalances}
                          />
                        )
                      ) : (
                        <span className="text-sm text-primary">{tx.type === 'cover' ? 'Cover transfer' : 'Transfer'}</span>
                      )}
                    </td>
                    <td className="pl-2 pr-3 py-2.5 text-right whitespace-nowrap sm:w-auto sm:px-3">
                      <Amount cents={tx.amount} type={tx.type} />
                    </td>
                    {showRunningBalance && (
                      <td className="hidden sm:table-cell pl-2 pr-3 py-2.5 text-right whitespace-nowrap">
                        <span className={`text-sm font-mono ${tx.running_balance < 0 ? 'text-danger' : 'text-accent'}`}>
                          {formatMoney(tx.running_balance)}
                        </span>
                      </td>
                    )}
                  </tr>
                  {tx.splits.map((split, i) => (
                    <tr
                      key={`split-${split.id}`}
                      className={`${i === tx.splits.length - 1 ? 'border-b border-border/50' : 'border-b border-border/20'} bg-surface-2/20 cursor-pointer hover:bg-surface-2/40`}
                      onClick={() => setEditTx(tx)}
                    >
                      <td className="pl-3 pr-1 py-1.5 w-px hidden sm:table-cell" />
                      <td className="pl-1 pr-1 py-1.5 w-px sm:w-auto sm:px-4" />
                      <td className="px-2 py-1.5 sm:px-3">
                        <div className="flex items-center gap-1.5 sm:hidden">
                          <span className="text-muted text-xs">↳</span>
                          <span className="text-xs text-secondary truncate">{split.category_name ?? <span className="italic text-muted">Uncategorised</span>}</span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 hidden sm:table-cell" />
                      <td className="px-3 py-1.5 hidden lg:table-cell">
                        {split.note && <span className="text-xs text-muted truncate block">{split.note}</span>}
                      </td>
                      <td className="px-3 py-1.5 hidden md:table-cell">
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted text-xs">↳</span>
                          <span className="text-sm text-secondary">{split.category_name ?? <span className="italic text-muted">Uncategorised</span>}</span>
                        </div>
                      </td>
                      <td className="pl-2 pr-3 py-1.5 text-right whitespace-nowrap sm:w-auto sm:px-3">
                        <span className={`text-sm font-mono ${split.amount < 0 ? 'text-danger' : 'text-accent'}`}>
                          {formatMoney(Math.abs(split.amount))}
                        </span>
                      </td>
                      {showRunningBalance && <td className="hidden sm:table-cell" />}
                    </tr>
                  ))}
                  </>
                ))}
              </tbody>
            </table>
        )}
        {!txLoading && totalPages > 1 && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-3">
            <span className="text-xs text-muted">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalTransactions)} of {totalTransactions}
            </span>
            <div className="flex items-center gap-1">
              <button
                className="p-1.5 rounded text-muted hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 0}
                aria-label="Previous page"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="text-xs text-secondary px-1">Page {page + 1} of {totalPages}</span>
              <button
                className="p-1.5 rounded text-muted hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages - 1}
                aria-label="Next page"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>}

      {/* Modals */}
      <Modal open={accountModal.open} onClose={() => setAccountModal({ open: false })} title={accountModal.account ? 'Edit Account' : 'Add Account'}>
        <AccountForm account={accountModal.account} onClose={() => setAccountModal({ open: false })} />
      </Modal>

      <TransactionForm open={addTxOpen} onClose={() => setAddTxOpen(false)} />
      {editTx && <TransactionForm open={true} onClose={() => setEditTx(null)} transaction={editTx} />}
      <ImportWizard open={importOpen} onClose={() => setImportOpen(false)} />
      {reconcileAccount && <ReconcileModal account={reconcileAccount} onClose={() => setReconcileAccount(null)} />}
      <BulkEditModal
        open={bulkEditOpen}
        onClose={() => { setBulkEditOpen(false); setSelectedIds(new Set()) }}
        selectedIds={selectedIds}
        transactions={transactions ?? []}
        accounts={accounts ?? []}
        groups={groups ?? []}
        categories={(categories as unknown as Array<{ id: number; group_id: number; name: string }>) ?? []}
      />
    </div>
  )
}

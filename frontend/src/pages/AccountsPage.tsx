import { useState, useEffect } from 'react'
import { useLocalStorageBool } from '../hooks/useLocalStorageBool'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
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
import { format, parseISO } from 'date-fns'
import { accountsApi, Account, AccountInput, AccountCreateInput } from '../api/accounts'
import { transactionsApi, Transaction } from '../api/transactions'
import { budgetApi } from '../api/budget'
import { formatMoney, Amount } from '../components/ui/AmountDisplay'
import { Modal } from '../components/ui/Modal'
import { Button } from '../components/ui/Button'
import { Input, Select, Textarea } from '../components/ui/Input'
import { TransactionForm } from '../components/transactions/TransactionForm'
import { ImportWizard } from '../components/transactions/ImportWizard'
import { BulkEditModal } from '../components/transactions/BulkEditModal'
import { CategoryCombobox } from '../components/ui/CategoryCombobox'
import { useResizableCols, ResizeHandle } from '../hooks/useResizableCols'

const DEFAULT_COL_WIDTHS = {
  date: 90, account: 150, payee: 180, description: 280, category: 190, amount: 110,
}

function ReconcileModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const qc = useQueryClient()
  const [actualBalance, setActualBalance] = useState('')
  const today = new Date().toISOString().slice(0, 10)
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
})

const createAccountSchema = baseAccountSchema.extend({
  startingBalance: z.string(),
  startingBalanceDate: z.string(),
})

type CreateAccountFormData = z.infer<typeof createAccountSchema>

function AccountForm({ account, onClose }: { account?: Account | null; onClose: () => void }) {
  const qc = useQueryClient()
  const isEdit = !!account
  const today = new Date().toISOString().slice(0, 10)

  const { register, watch, handleSubmit, formState: { errors } } = useForm<CreateAccountFormData>({
    resolver: zodResolver(isEdit ? baseAccountSchema : createAccountSchema),
    defaultValues: {
      name: account?.name ?? '',
      type: account?.type ?? 'transactional',
      notes: account?.notes ?? '',
      goalAmount: account?.goalAmount ? (account.goalAmount / 100).toFixed(2) : '',
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

  const onSubmit = (data: CreateAccountFormData) => {
    const goalCents = data.type === 'savings' && data.goalAmount
      ? Math.round(parseFloat(data.goalAmount) * 100) || null
      : null
    if (isEdit) {
      mutation.mutate({ name: data.name, type: data.type, notes: data.notes || null, goalAmount: goalCents })
    } else {
      const balanceCents = Math.round(parseFloat(data.startingBalance || '0') * 100)
      mutation.mutate({
        name: data.name,
        type: data.type,
        notes: data.notes || null,
        goalAmount: goalCents,
        startingBalance: balanceCents || undefined,
        startingBalanceDate: balanceCents ? data.startingBalanceDate : undefined,
      })
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit as (data: CreateAccountFormData) => void)} className="space-y-4">
      <Input label="Account Name" {...register('name')} error={errors.name?.message} autoFocus />
      <Select label="Type" {...register('type')}>
        <option value="transactional">Transactional</option>
        <option value="savings">Savings</option>
        <option value="debt">Debt</option>
      </Select>
      {watchedType === 'savings' && (
        <Input
          label="Goal Amount ($)"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          {...register('goalAmount')}
          hint="Target balance for this savings account"
        />
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
      <Textarea label="Notes (optional)" {...register('notes')} rows={2} />
      {mutation.isError && (
        <p className="text-sm text-danger">{(mutation.error as Error).message}</p>
      )}
      <div className="flex items-center gap-3 pt-2">
        {isEdit && (
          <Button type="button" variant="danger" onClick={() => deleteMutation.mutate()} loading={deleteMutation.isPending}>
            Delete
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>{isEdit ? 'Save' : 'Add Account'}</Button>
      </div>
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
}: {
  account: Account
  onEdit: () => void
  onReconcile: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: account.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : undefined }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 pl-7 md:pl-2 pr-4 py-1.5 hover:bg-surface-2/50 cursor-pointer group"
      onClick={onEdit}
    >
      <div className="hidden md:flex">
        <GripHandle listeners={listeners as SyntheticListenerMap | undefined} attributes={attributes} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-primary">{account.name}</span>
        {account.notes && (
          <span className="text-xs text-muted ml-2 truncate hidden sm:inline">{account.notes}</span>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
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
          title="Reconcile"
          className="hidden sm:block p-1.5 rounded text-muted hover:text-primary transition-colors"
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

const ACCOUNT_GROUP_ORDER = ['transactional', 'savings', 'debt'] as const
const ACCOUNT_GROUP_LABELS: Record<string, string> = {
  transactional: 'Transactional',
  savings: 'Savings',
  debt: 'Debt',
}

export function AccountsPage() {
  const qc = useQueryClient()

  // Collapse state
  const [accountsCollapsed, setAccountsCollapsed] = useLocalStorageBool('dosh:collapsed:accounts', false)
  const [transactionsCollapsed, setTransactionsCollapsed] = useLocalStorageBool('dosh:collapsed:transactions', false)

  // Account state
  const [accountModal, setAccountModal] = useState<{ open: boolean; account?: Account | null }>({ open: false })
  const [reconcileAccount, setReconcileAccount] = useState<Account | null>(null)
  const [orderedAccounts, setOrderedAccounts] = useState<Account[]>([])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  // Transaction state
  const [filters, setFilters] = useState({ startDate: '', endDate: '', accountId: '', categoryId: '', search: '' })
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

  const { data: accounts, isLoading: accountsLoading } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list })

  useEffect(() => { if (accounts) setOrderedAccounts(accounts) }, [accounts])

  const handleAccountDragEnd = (type: string) => (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrderedAccounts((all) => {
      const typed = all.filter((a) => a.type === type)
      const rest = all.filter((a) => a.type !== type)
      const oldIdx = typed.findIndex((a) => a.id === active.id)
      const newIdx = typed.findIndex((a) => a.id === over.id)
      const reordered = arrayMove(typed, oldIdx, newIdx)
      accountsApi.reorder(reordered.map((a, i) => ({ id: a.id, sortOrder: i })))
      return [...rest, ...reordered]
    })
  }

  const { data: categories } = useQuery({ queryKey: ['budget', 'categories-flat'], queryFn: budgetApi.getCategories })
  const { data: groups } = useQuery({ queryKey: ['budget', 'groups'], queryFn: budgetApi.getGroups })
  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['transactions', filters, uncategorisedOnly, page],
    queryFn: () =>
      transactionsApi.list({
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
        accountId: filters.accountId ? parseInt(filters.accountId, 10) : undefined,
        categoryId: filters.categoryId ? parseInt(filters.categoryId, 10) : undefined,
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

  const { widths, onResizeStart } = useResizableCols(DEFAULT_COL_WIDTHS, 'dosh:tx-col-widths')

  const setFilter = (key: string, value: string) => { setFilters((prev) => ({ ...prev, [key]: value })); setPage(0) }
  const clearFilters = () => {
    setFilters({ startDate: '', endDate: '', accountId: '', categoryId: '', search: '' })
    setUncategorisedOnly(false)
    setPage(0)
  }
  const hasFilters = Object.values(filters).some(Boolean) || uncategorisedOnly

  const totalBalance = accounts?.reduce((sum, a) => sum + a.currentBalance, 0) ?? 0
  const transactionalTotal = accounts?.filter((a) => a.type === 'transactional').reduce((sum, a) => sum + a.currentBalance, 0) ?? 0
  const savingsTotal = accounts?.filter((a) => a.type === 'savings').reduce((sum, a) => sum + a.currentBalance, 0) ?? 0
  const debtTotal = accounts?.filter((a) => a.type === 'debt').reduce((sum, a) => sum + a.currentBalance, 0) ?? 0
  const hasDebt = accounts?.some((a) => a.type === 'debt') ?? false

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-3 md:px-6">
      {/* Accounts header */}
      <div className="flex items-center justify-between">
        <button
          className="flex items-center gap-2 text-xl font-bold text-primary hover:text-accent transition-colors"
          onClick={() => setAccountsCollapsed((c) => !c)}
        >
          <svg className={`w-4 h-4 transition-transform duration-150 ${accountsCollapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          Accounts
        </button>
        <Button size="sm" onClick={() => setAccountModal({ open: true, account: null })}>
          + Add Account
        </Button>
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
          <div key={label} className="border-y border-border p-4">
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
      ) : orderedAccounts.length === 0 ? (
        <div className="border-y border-border px-5 py-12 text-center text-secondary -mx-4 md:mx-0">No accounts yet.</div>
      ) : (
        <div className="divide-y divide-border -mx-4 md:mx-0 overflow-hidden">
          {ACCOUNT_GROUP_ORDER.map((type) => {
            const groupAccounts = orderedAccounts.filter((a) => a.type === type)
            if (groupAccounts.length === 0) return null
            const groupTotal = groupAccounts.reduce((sum, a) => sum + a.currentBalance, 0)
            return (
              <div key={type} className="divide-y divide-border">
                <div className="pl-2 pr-4 py-0.5">
                  <span className="text-xs font-medium text-muted uppercase tracking-wide">{ACCOUNT_GROUP_LABELS[type]}</span>
                </div>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleAccountDragEnd(type)}>
                  <SortableContext items={groupAccounts.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                    {groupAccounts.map((account) => (
                      <SortableAccountRow
                        key={account.id}
                        account={account}
                        onEdit={() => setAccountModal({ open: true, account })}
                        onReconcile={() => setReconcileAccount(account)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
            )
          })}
          {/* Mobile: Net Worth footer */}
          <div className="flex items-center justify-between px-4 py-2 sm:hidden !border-t-0">
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted uppercase tracking-wide">From</label>
              <input type="date" value={filters.startDate} onChange={(e) => setFilter('startDate', e.target.value)} className="input-base text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted uppercase tracking-wide">To</label>
              <input type="date" value={filters.endDate} onChange={(e) => setFilter('endDate', e.target.value)} className="input-base text-sm" />
            </div>
            <Select label="Account" value={filters.accountId} onChange={(e) => setFilter('accountId', e.target.value)}>
              <option value="">All accounts</option>
              {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            <Select label="Category" value={filters.categoryId} onChange={(e) => setFilter('categoryId', e.target.value)}>
              <option value="">All categories</option>
              {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-muted hover:text-primary">Clear filters</button>
          )}
        </div>
      )}

      {/* Bulk action bar */}
      {!transactionsCollapsed && someSelected && (
        <div className="card px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <span className="text-sm text-secondary shrink-0">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2 ml-auto">
            <Button size="sm" variant="outline" onClick={() => setBulkEditOpen(true)}>
              Edit
            </Button>
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
            <button className="text-xs text-muted hover:text-primary" onClick={() => setSelectedIds(new Set())}>
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Transaction list */}
      {!transactionsCollapsed && <div className="card overflow-hidden -mx-4 rounded-none border-x-0 bg-transparent md:mx-0 md:rounded-xl">
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
          <table className="w-full text-sm md:table-fixed">
              <thead>
                <tr className="border-b border-border text-xs text-muted uppercase tracking-wide">
                  <th className="pl-3 pr-1 py-3 w-8 hidden sm:table-cell">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
                      onChange={toggleAll}
                      className="w-3.5 h-3.5 accent-accent cursor-pointer"
                    />
                  </th>
                  <th className="pl-1 pr-1 py-3 text-left font-medium relative sm:px-3" style={{ width: widths.date }}>
                    Date
                    <ResizeHandle onMouseDown={(e) => onResizeStart('date', e)} />
                  </th>
                  <th className="px-3 py-3 text-left font-medium relative" style={{ width: widths.account }}>
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
                      if (tx.type !== 'cover') setEditTx(tx)
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
                    <td className="pl-3 pr-1 py-2.5 font-mono text-xs text-primary whitespace-nowrap w-px sm:w-auto sm:px-4">
                      {format(parseISO(tx.date), 'dd/MM/yy')}
                    </td>
                    <td className="px-2 py-2.5 sm:px-3 overflow-hidden">
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
                          />
                        )
                      ) : (
                        <span className="text-sm text-primary">{tx.type === 'cover' ? 'Cover transfer' : 'Transfer'}</span>
                      )}
                    </td>
                    <td className="pl-2 pr-3 py-2.5 text-right whitespace-nowrap sm:w-auto sm:px-3">
                      <Amount cents={tx.amount} type={tx.type} />
                    </td>
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

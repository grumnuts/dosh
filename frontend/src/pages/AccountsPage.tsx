import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { format, parseISO } from 'date-fns'
import { accountsApi, Account, AccountInput } from '../api/accounts'
import { transactionsApi, Transaction } from '../api/transactions'
import { budgetApi } from '../api/budget'
import { formatMoney, Amount } from '../components/ui/AmountDisplay'
import { Modal } from '../components/ui/Modal'
import { Button } from '../components/ui/Button'
import { Input, Select, Textarea } from '../components/ui/Input'
import { TransactionForm } from '../components/transactions/TransactionForm'
import { ImportWizard } from '../components/transactions/ImportWizard'

const accountSchema = z.object({
  name: z.string().min(1, 'Required'),
  type: z.enum(['transactional', 'savings']),
  startingBalance: z.string(),
  notes: z.string().optional(),
})

type AccountFormData = z.infer<typeof accountSchema>

function AccountForm({ account, onClose }: { account?: Account | null; onClose: () => void }) {
  const qc = useQueryClient()
  const isEdit = !!account

  const { register, handleSubmit, formState: { errors } } = useForm<AccountFormData>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: account?.name ?? '',
      type: account?.type ?? 'transactional',
      startingBalance: account ? (account.startingBalance / 100).toFixed(2) : '0.00',
      notes: account?.notes ?? '',
    },
  })

  const mutation = useMutation({
    mutationFn: async (data: AccountInput): Promise<{ id: number }> => {
      if (isEdit) {
        await accountsApi.update(account!.id, data)
        return { id: account!.id }
      }
      return accountsApi.create(data)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
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

  const onSubmit = (data: AccountFormData) => {
    mutation.mutate({
      name: data.name,
      type: data.type,
      startingBalance: Math.round(parseFloat(data.startingBalance || '0') * 100),
      notes: data.notes || null,
    })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Input label="Account Name" {...register('name')} error={errors.name?.message} autoFocus />
      <Select label="Type" {...register('type')}>
        <option value="transactional">Transactional</option>
        <option value="savings">Savings</option>
      </Select>
      <Input
        label="Starting Balance ($)"
        type="number"
        step="0.01"
        {...register('startingBalance')}
        hint="The opening balance before any transactions"
      />
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

export function AccountsPage() {
  const qc = useQueryClient()

  // Collapse state
  const [accountsCollapsed, setAccountsCollapsed] = useState(false)
  const [transactionsCollapsed, setTransactionsCollapsed] = useState(false)

  // Account state
  const [accountModal, setAccountModal] = useState<{ open: boolean; account?: Account | null }>({ open: false })

  // Transaction state
  const [filters, setFilters] = useState({ startDate: '', endDate: '', accountId: '', categoryId: '', search: '' })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [uncategorisedOnly, setUncategorisedOnly] = useState(false)
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [addTxOpen, setAddTxOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [inlineCategoryTx, setInlineCategoryTx] = useState<number | null>(null)
  const [inlineCategoryValue, setInlineCategoryValue] = useState<string>('')

  const { data: accounts, isLoading: accountsLoading } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list })
  const { data: categories } = useQuery({ queryKey: ['budget', 'categories-flat'], queryFn: budgetApi.getCategories })
  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ['transactions', filters, uncategorisedOnly],
    queryFn: () =>
      transactionsApi.list({
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
        accountId: filters.accountId ? parseInt(filters.accountId, 10) : undefined,
        categoryId: filters.categoryId ? parseInt(filters.categoryId, 10) : undefined,
        uncategorised: uncategorisedOnly || undefined,
        search: filters.search || undefined,
        limit: 200,
      }),
  })

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
      setInlineCategoryTx(null)
    },
  })

  const setFilter = (key: string, value: string) => setFilters((prev) => ({ ...prev, [key]: value }))
  const clearFilters = () => {
    setFilters({ startDate: '', endDate: '', accountId: '', categoryId: '', search: '' })
    setUncategorisedOnly(false)
  }
  const hasFilters = Object.values(filters).some(Boolean) || uncategorisedOnly

  const totalBalance = accounts?.reduce((sum, a) => sum + a.currentBalance, 0) ?? 0
  const transactionalTotal = accounts?.filter((a) => a.type === 'transactional').reduce((sum, a) => sum + a.currentBalance, 0) ?? 0
  const savingsTotal = accounts?.filter((a) => a.type === 'savings').reduce((sum, a) => sum + a.currentBalance, 0) ?? 0

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
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
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Net Worth', value: totalBalance },
          { label: 'Transactional', value: transactionalTotal },
          { label: 'Savings', value: savingsTotal },
        ].map(({ label, value }) => (
          <div key={label} className="card p-3 sm:p-4">
            <div className="text-xs text-muted mb-1 truncate">{label}</div>
            <div className={`text-sm sm:text-lg font-bold font-mono truncate ${value < 0 ? 'text-danger' : 'text-accent'}`}>
              {formatMoney(value)}
            </div>
          </div>
        ))}
      </div>

      {/* Account list */}
      {accountsLoading ? (
        <div className="text-center py-12 text-secondary">Loading...</div>
      ) : (
        <div className="card divide-y divide-border">
          {accounts?.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between px-5 py-4 hover:bg-surface-2/50 cursor-pointer"
              onClick={() => setAccountModal({ open: true, account })}
            >
              <div>
                <div className="font-medium text-primary">{account.name}</div>
                <div className="text-xs text-muted mt-0.5 capitalize">{account.type}</div>
                {account.notes && (
                  <div className="text-xs text-muted mt-0.5 truncate max-w-[250px]">{account.notes}</div>
                )}
              </div>
              <div className="text-right">
                <div className={`font-bold font-mono ${account.currentBalance < 0 ? 'text-danger' : 'text-primary'}`}>
                  {formatMoney(account.currentBalance)}
                </div>
                {account.startingBalance !== 0 && (
                  <div className="text-xs text-muted font-mono">Start: {formatMoney(account.startingBalance)}</div>
                )}
              </div>
            </div>
          ))}
          {accounts?.length === 0 && (
            <div className="px-5 py-12 text-center text-secondary">No accounts yet.</div>
          )}
        </div>
      )}

      </>
      )}

      {/* Transactions header */}
      <div className="flex items-center justify-between gap-2 pt-2">
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
            <button
              className={`text-xs px-2 py-1 rounded transition-colors ${uncategorisedOnly ? 'bg-amber-500/20 text-amber-400' : 'bg-surface-2 text-muted hover:text-primary'}`}
              onClick={() => setUncategorisedOnly((v) => !v)}
            >
              {uncategorisedData.count} Uncategorised
            </button>
          )}
          <button
            className={`p-1.5 rounded transition-colors ${filtersOpen ? 'text-accent bg-accent/10' : 'text-muted hover:text-primary'}`}
            onClick={() => setFiltersOpen((o) => !o)}
            aria-label="Toggle filters"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </button>
          <input
            type="text"
            placeholder="Search..."
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            className="input-base text-sm w-32 sm:w-48"
          />
          <button
            className="p-1.5 rounded text-muted hover:text-primary transition-colors"
            onClick={() => setImportOpen(true)}
            aria-label="Import CSV"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </button>
          <Button size="sm" onClick={() => setAddTxOpen(true)}>+ Add</Button>
        </div>
      </div>

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

      {/* Transaction list */}
      {!transactionsCollapsed && <div className="card overflow-hidden">
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
          <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted uppercase tracking-wide">
                  <th className="pl-2 pr-1 py-3 text-left font-medium w-px sm:w-auto sm:px-4">Date</th>
                  <th className="px-2 py-3 text-left font-medium sm:px-3">Account</th>
                  <th className="px-3 py-3 text-left font-medium hidden sm:table-cell">Payee</th>
                  <th className="px-3 py-3 text-left font-medium hidden lg:table-cell lg:w-full">Description</th>
                  <th className="px-3 py-3 text-left font-medium hidden md:table-cell lg:w-px lg:whitespace-nowrap">Category</th>
                  <th className="pl-2 pr-3 py-3 text-right font-medium w-px sm:w-auto sm:px-3">Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactions?.map((tx) => (
                  <tr
                    key={tx.id}
                    className="border-b border-border/50 hover:bg-surface-2/50 cursor-pointer"
                    onClick={() => { if (tx.type !== 'cover') setEditTx(tx) }}
                  >
                    <td className="pl-2 pr-1 py-2.5 font-mono text-xs text-primary whitespace-nowrap w-px sm:w-auto sm:px-4">
                      {format(parseISO(tx.date), 'dd/MM/yy')}
                    </td>
                    <td className="px-2 py-2.5 max-w-0 sm:px-3 sm:max-w-none">
                      <div className="text-sm text-primary truncate">{tx.account_name}</div>
                      <div className="text-xs mt-0.5 truncate sm:hidden">
                        {tx.category_name
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
                    <td className="px-3 py-2.5 max-w-0 hidden sm:table-cell text-sm text-primary">
                      <span className="truncate block">{tx.payee || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 hidden lg:table-cell text-sm text-primary lg:w-full lg:max-w-none max-w-0">
                      <span className="truncate block">{tx.description || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell lg:w-px lg:whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {tx.type === 'transaction' ? (
                        inlineCategoryTx === tx.id ? (
                          <div className="flex items-center gap-2">
                            <select
                              autoFocus
                              value={inlineCategoryValue}
                              onChange={(e) => setInlineCategoryValue(e.target.value)}
                              onBlur={() => {
                                if (inlineCategoryValue !== String(tx.category_id ?? '')) {
                                  assignCategory.mutate({ id: tx.id, tx, categoryId: inlineCategoryValue ? parseInt(inlineCategoryValue, 10) : null })
                                } else {
                                  setInlineCategoryTx(null)
                                }
                              }}
                              className="input-base text-xs py-1 px-2"
                            >
                              <option value="">Uncategorised</option>
                              {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </div>
                        ) : (
                          <button
                            className={`text-sm text-left ${tx.category_name ? 'text-primary hover:text-accent' : 'text-muted hover:text-accent italic'} transition-colors`}
                            onClick={() => { setInlineCategoryTx(tx.id); setInlineCategoryValue(tx.category_id ? String(tx.category_id) : '') }}
                          >
                            {tx.category_name ?? 'Assign category'}
                          </button>
                        )
                      ) : (
                        <span className="text-sm text-primary">{tx.type === 'cover' ? 'Cover transfer' : 'Transfer'}</span>
                      )}
                    </td>
                    <td className="pl-2 pr-3 py-2.5 text-right whitespace-nowrap w-px sm:w-auto sm:px-3">
                      <Amount cents={tx.amount} type={tx.type} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        )}
      </div>}

      {/* Modals */}
      <Modal open={accountModal.open} onClose={() => setAccountModal({ open: false })} title={accountModal.account ? 'Edit Account' : 'Add Account'}>
        <AccountForm account={accountModal.account} onClose={() => setAccountModal({ open: false })} />
      </Modal>

      <TransactionForm open={addTxOpen} onClose={() => setAddTxOpen(false)} />
      {editTx && <TransactionForm open={true} onClose={() => setEditTx(null)} transaction={editTx} />}
      <ImportWizard open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  )
}

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { transactionsApi, Transaction } from '../api/transactions'
import { accountsApi } from '../api/accounts'
import { budgetApi } from '../api/budget'
import { Amount } from '../components/ui/AmountDisplay'
import { Button } from '../components/ui/Button'
import { Select } from '../components/ui/Input'
import { TransactionForm } from '../components/transactions/TransactionForm'
import { ImportWizard } from '../components/transactions/ImportWizard'

export function TransactionsPage() {
  const qc = useQueryClient()
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    accountId: '',
    categoryId: '',
    search: '',
  })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [uncategorisedOnly, setUncategorisedOnly] = useState(false)
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [inlineCategoryTx, setInlineCategoryTx] = useState<number | null>(null)
  const [inlineCategoryValue, setInlineCategoryValue] = useState<string>('')
  const [searchOpen, setSearchOpen] = useState(false)

  const { data: transactions, isLoading } = useQuery({
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

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list })
  const { data: categories } = useQuery({ queryKey: ['budget', 'categories-flat'], queryFn: budgetApi.getCategories })

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

  const setFilter = (key: string, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }))

  const clearFilters = () => {
    setFilters({ startDate: '', endDate: '', accountId: '', categoryId: '', search: '' })
    setUncategorisedOnly(false)
  }

  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-primary">Transactions</h1>
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
            className={`p-1.5 rounded transition-colors ${searchOpen ? 'text-accent bg-accent/10' : 'text-muted hover:text-primary'}`}
            onClick={() => setSearchOpen((o) => !o)}
            aria-label="Toggle search"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
          </button>
          <button
            className={`p-1.5 rounded transition-colors ${filtersOpen ? 'text-accent bg-accent/10' : 'text-muted hover:text-primary'}`}
            onClick={() => setFiltersOpen((o) => !o)}
            aria-label="Toggle filters"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} className="hidden sm:inline-flex">
            Import CSV
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            + Add
          </Button>
        </div>
      </div>

      {/* Search bar (expandable) */}
      {searchOpen && (
        <div>
          <input
            type="text"
            placeholder="Search transactions..."
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            autoFocus
            className="input-base text-sm w-full"
          />
        </div>
      )}

      {/* Filters (collapsible) */}
      {filtersOpen && (
        <div className="card p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted uppercase tracking-wide">From</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilter('startDate', e.target.value)}
                className="input-base text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted uppercase tracking-wide">To</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilter('endDate', e.target.value)}
                className="input-base text-sm"
              />
            </div>
            <Select
              label="Account"
              value={filters.accountId}
              onChange={(e) => setFilter('accountId', e.target.value)}
            >
              <option value="">All accounts</option>
              {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            <Select
              label="Category"
              value={filters.categoryId}
              onChange={(e) => setFilter('categoryId', e.target.value)}
            >
              <option value="">All categories</option>
              {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-muted hover:text-primary">
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Transaction list */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="text-center py-12 text-secondary">Loading...</div>
        ) : transactions?.length === 0 ? (
          <div className="text-center py-12 text-secondary">
            No transactions found.
            {!hasFilters && (
              <div className="mt-2">
                <button className="text-accent text-sm" onClick={() => setImportOpen(true)}>
                  Import your first CSV
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="border-b border-border text-xs text-muted uppercase tracking-wide">
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-3 py-3 text-left font-medium hidden sm:table-cell">Account</th>
                  <th className="px-3 py-3 text-left font-medium">Payee / Description</th>
                  <th className="px-3 py-3 text-left font-medium hidden md:table-cell">Category</th>
                  <th className="px-3 py-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactions?.map((tx) => (
                  <tr
                    key={tx.id}
                    className="border-b border-border/50 hover:bg-surface-2/50 cursor-pointer"
                    onClick={() => {
                      if (tx.type === 'transaction') setEditTx(tx)
                    }}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-secondary whitespace-nowrap">
                      {format(parseISO(tx.date), 'dd/MM/yy')}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted hidden sm:table-cell">
                      {tx.account_name}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="truncate max-w-[200px]">
                        <span className="text-primary">{tx.payee || tx.description || '—'}</span>
                        {tx.payee && tx.description && (
                          <span className="text-muted text-xs ml-2 hidden lg:inline">{tx.description}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
                      {tx.type === 'transaction' ? (
                        inlineCategoryTx === tx.id ? (
                          <div className="flex items-center gap-2">
                            <select
                              autoFocus
                              value={inlineCategoryValue}
                              onChange={(e) => setInlineCategoryValue(e.target.value)}
                              onBlur={() => {
                                if (inlineCategoryValue !== String(tx.category_id ?? '')) {
                                  assignCategory.mutate({
                                    id: tx.id,
                                    tx,
                                    categoryId: inlineCategoryValue ? parseInt(inlineCategoryValue, 10) : null,
                                  })
                                } else {
                                  setInlineCategoryTx(null)
                                }
                              }}
                              className="input-base text-xs py-1 px-2"
                            >
                              <option value="">Uncategorised</option>
                              {categories?.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <button
                            className={`text-xs ${tx.category_name ? 'text-secondary hover:text-primary' : 'text-muted hover:text-accent italic'} transition-colors`}
                            onClick={() => {
                              setInlineCategoryTx(tx.id)
                              setInlineCategoryValue(tx.category_id ? String(tx.category_id) : '')
                            }}
                          >
                            {tx.category_name ?? 'Assign category'}
                          </button>
                        )
                      ) : (
                        <span className="text-xs text-muted">
                          {tx.type === 'cover' ? 'Cover transfer' : 'Transfer'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Amount cents={tx.amount} type={tx.type} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      <TransactionForm
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />
      {editTx && (
        <TransactionForm
          open={true}
          onClose={() => setEditTx(null)}
          transaction={editTx}
        />
      )}
      <ImportWizard open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  )
}

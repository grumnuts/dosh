import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { auditApi } from '../api/audit'
import { usersApi } from '../api/users'
import { Select } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'

const EVENT_TYPE_LABELS: Record<string, string> = {
  'user.login': 'Login',
  'user.logout': 'Logout',
  'user.created': 'User Created',
  'user.deleted': 'User Deleted',
  'user.password_changed': 'Password Changed',
  'account.created': 'Account Created',
  'account.updated': 'Account Updated',
  'account.deleted': 'Account Deleted',
  'transaction.created': 'Transaction Added',
  'transaction.updated': 'Transaction Updated',
  'transaction.deleted': 'Transaction Deleted',
  'transactions.imported': 'Transactions Imported',
  'budget_group.created': 'Group Created',
  'budget_group.updated': 'Group Updated',
  'budget_group.deleted': 'Group Deleted',
  'budget_category.created': 'Category Created',
  'budget_category.updated': 'Category Updated',
  'budget_category.deleted': 'Category Deleted',
  'budget.amount_changed': 'Budget Changed',
  'budget.overspend_covered': 'Overspend Covered',
}

const EVENT_BADGES: Record<string, 'default' | 'danger' | 'warn' | 'success' | 'muted'> = {
  'user.login': 'success',
  'user.logout': 'muted',
  'user.created': 'success',
  'user.deleted': 'danger',
  'user.password_changed': 'warn',
  'account.deleted': 'danger',
  'transaction.deleted': 'danger',
  'budget.overspend_covered': 'warn',
  'budget.amount_changed': 'warn',
  'transactions.imported': 'success',
}

function formatDetails(eventType: string, details: Record<string, unknown> | null): string {
  if (!details) return ''
  switch (eventType) {
    case 'budget.amount_changed':
      return `${details.name}: $${((details.oldAmount as number) / 100).toFixed(2)} → $${((details.newAmount as number) / 100).toFixed(2)}`
    case 'budget.overspend_covered':
      return `${details.categoryName}: $${((details.amount as number) / 100).toFixed(2)} from ${details.sourceAccount}`
    case 'transactions.imported':
      return `${details.count} imported, ${details.skipped} skipped into ${details.accountName}`
    default:
      return Object.entries(details)
        .filter(([k]) => !['isFirstUser'].includes(k))
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
  }
}

export function AuditPage() {
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    userId: '',
    eventType: '',
    search: '',
  })
  const [filtersOpen, setFiltersOpen] = useState(false)

  const { data: entries, isLoading } = useQuery({
    queryKey: ['audit', filters],
    queryFn: () =>
      auditApi.list({
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
        userId: filters.userId ? parseInt(filters.userId, 10) : undefined,
        eventType: filters.eventType || undefined,
        search: filters.search || undefined,
        limit: 200,
      }),
  })

  const { data: users } = useQuery({ queryKey: ['users'], queryFn: usersApi.list })

  const setFilter = (key: string, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }))

  const hasFilters = Object.values(filters).some(Boolean)
  const clearFilters = () => setFilters({ startDate: '', endDate: '', userId: '', eventType: '', search: '' })

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-primary">Audit Log</h1>
        <div className="flex items-center gap-2">
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
            className="input-base text-sm w-40 sm:w-56"
          />
        </div>
      </div>

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
            <Select label="User" value={filters.userId} onChange={(e) => setFilter('userId', e.target.value)}>
              <option value="">All users</option>
              {users?.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
            </Select>
            <Select label="Event Type" value={filters.eventType} onChange={(e) => setFilter('eventType', e.target.value)}>
              <option value="">All events</option>
              {Object.entries(EVENT_TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </div>
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-muted hover:text-primary">
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Log entries */}
      <div className="card overflow-hidden -mx-4 rounded-none border-x-0 bg-transparent md:mx-0">
        {isLoading ? (
          <div className="text-center py-12 text-secondary">Loading...</div>
        ) : entries?.length === 0 ? (
          <div className="text-center py-12 text-secondary">No audit entries found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="border-b border-border text-xs text-muted uppercase tracking-wide">
                  <th className="px-4 py-3 text-left font-medium">Time</th>
                  <th className="px-3 py-3 text-left font-medium hidden sm:table-cell">User</th>
                  <th className="px-3 py-3 text-left font-medium">Event</th>
                  <th className="px-3 py-3 text-left font-medium hidden md:table-cell">Details</th>
                </tr>
              </thead>
              <tbody>
                {entries?.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/50">
                    <td className="px-4 py-2.5 font-mono text-xs text-muted whitespace-nowrap">
                      {format(parseISO(entry.occurred_at), 'dd MMM HH:mm')}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-secondary hidden sm:table-cell">
                      {entry.username}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={EVENT_BADGES[entry.event_type] ?? 'default'}>
                        {EVENT_TYPE_LABELS[entry.event_type] ?? entry.event_type}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted max-w-xs truncate hidden md:table-cell">
                      {formatDetails(entry.event_type, entry.details)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

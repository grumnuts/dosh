import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { reportsApi } from '../../api/reports'
import { formatMoney } from '../ui/AmountDisplay'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface Props {
  year: string
}

export function PayeeReport({ year }: Props) {
  const [search, setSearch] = useState('')
  const [selectedPayee, setSelectedPayee] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'payees', year],
    queryFn: () => reportsApi.payees(year),
  })

  const payees = useMemo(() => {
    if (!data) return []
    return Array.from(new Set(data.map((r) => r.payee))).sort()
  }, [data])

  const filtered = useMemo(
    () => payees.filter((p) => p.toLowerCase().includes(search.toLowerCase())),
    [payees, search],
  )

  const activePayee = selectedPayee ?? filtered[0] ?? null

  const chartData = useMemo(() => {
    if (!data || !activePayee) return []
    const rows = data.filter((r) => r.payee === activePayee)
    const byMonth: Record<string, { income: number; expense: number }> = {}
    for (const r of rows) {
      byMonth[r.month] = {
        income: (byMonth[r.month]?.income ?? 0) + r.income_cents / 100,
        expense: (byMonth[r.month]?.expense ?? 0) + r.expense_cents / 100,
      }
    }
    return MONTH_LABELS.map((label, i) => {
      const month = String(i + 1).padStart(2, '0')
      return { month: label, income: byMonth[month]?.income ?? 0, expense: byMonth[month]?.expense ?? 0 }
    })
  }, [data, activePayee])

  // Summary table rows for active payee
  const tableRows = useMemo(() => {
    if (!data || !activePayee) return []
    return data
      .filter((r) => r.payee === activePayee)
      .sort((a, b) => a.month.localeCompare(b.month))
  }, [data, activePayee])

  if (isLoading) return <div className="py-12 text-center text-secondary">Loading...</div>
  if (!data || data.length === 0) return <div className="py-12 text-center text-secondary">No payee data for {year}.</div>

  return (
    <div className="space-y-4">
      {/* Search + list */}
      <div className="flex gap-4 flex-col sm:flex-row">
        <div className="sm:w-56 shrink-0 space-y-2">
          <input
            type="text"
            placeholder="Search payees..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSelectedPayee(null) }}
            className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-lg text-primary placeholder-muted focus:outline-none focus:border-accent"
          />
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {filtered.map((p) => (
              <button
                key={p}
                onClick={() => setSelectedPayee(p)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  p === activePayee
                    ? 'bg-accent-muted text-accent'
                    : 'text-secondary hover:bg-surface-2 hover:text-primary'
                }`}
              >
                {p}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-sm text-muted">No payees found.</div>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-4">
          {activePayee ? (
            <>
              <p className="text-sm font-semibold text-primary">{activePayee}</p>
              <div className="card p-4">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `$${v}`}
                      width={55}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid #374151', borderRadius: 6 }}
                      labelStyle={{ color: '#e5e7eb' }}
                      formatter={(value: number) => [formatMoney(Math.round(value * 100)), '']}
                    />
                    <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
                    <Bar dataKey="income" name="Income" fill="#4ade80" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="expense" name="Expense" fill="#f87171" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-border">
                    <th className="pb-2 pr-4 text-secondary font-medium">Month</th>
                    <th className="pb-2 pr-4 text-right text-secondary font-medium">Income</th>
                    <th className="pb-2 pr-4 text-right text-secondary font-medium">Expense</th>
                    <th className="pb-2 text-right text-secondary font-medium">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tableRows.map((r, i) => {
                    const net = r.income_cents - r.expense_cents
                    return (
                      <tr key={i} className="hover:bg-surface-2">
                        <td className="py-1.5 pr-4 text-secondary">{MONTH_LABELS[parseInt(r.month, 10) - 1]}</td>
                        <td className="py-1.5 pr-4 text-right text-accent tabular-nums">
                          {r.income_cents > 0 ? formatMoney(r.income_cents) : <span className="text-muted">–</span>}
                        </td>
                        <td className="py-1.5 pr-4 text-right text-danger tabular-nums">
                          {r.expense_cents > 0 ? formatMoney(r.expense_cents) : <span className="text-muted">–</span>}
                        </td>
                        <td className={`py-1.5 text-right tabular-nums font-medium ${net >= 0 ? 'text-accent' : 'text-danger'}`}>
                          {formatMoney(Math.abs(net))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-semibold">
                    <td className="py-2 pr-4 text-primary">Total</td>
                    <td className="py-2 pr-4 text-right text-accent tabular-nums">
                      {formatMoney(tableRows.reduce((s, r) => s + r.income_cents, 0))}
                    </td>
                    <td className="py-2 pr-4 text-right text-danger tabular-nums">
                      {formatMoney(tableRows.reduce((s, r) => s + r.expense_cents, 0))}
                    </td>
                    <td className={`py-2 text-right tabular-nums font-semibold ${
                      tableRows.reduce((s, r) => s + r.income_cents - r.expense_cents, 0) >= 0 ? 'text-accent' : 'text-danger'
                    }`}>
                      {formatMoney(Math.abs(tableRows.reduce((s, r) => s + r.income_cents - r.expense_cents, 0)))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </>
          ) : (
            <div className="py-8 text-center text-secondary text-sm">Select a payee to view details.</div>
          )}
        </div>
      </div>
    </div>
  )
}

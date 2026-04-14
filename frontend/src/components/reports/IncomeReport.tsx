import { useState } from 'react'
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
import { Select } from '../ui/Input'
import { useResizableCols, ResizeHandle } from '../../hooks/useResizableCols'

const DEFAULT_COL_WIDTHS = { category: 176, m01: 64, m02: 64, m03: 64, m04: 64, m05: 64, m06: 64, m07: 64, m08: 64, m09: 64, m10: 64, m11: 64, m12: 64, total: 80 }

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const GROUP_COLOURS = [
  '#4ade80', '#60a5fa', '#f472b6', '#fb923c', '#a78bfa',
  '#34d399', '#38bdf8', '#facc15', '#f87171', '#818cf8',
]

interface Props {
  year: string
}

export function IncomeReport({ year }: Props) {
  const { widths, onResizeStart } = useResizableCols(DEFAULT_COL_WIDTHS, 'dosh:income-col-widths')
  const defaultMonth = String(new Date().getMonth() + 1).padStart(2, '0')
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth)

  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'income', year],
    queryFn: () => reportsApi.income(year),
  })

  if (isLoading) return <div className="py-12 text-center text-secondary">Loading...</div>
  if (!data || data.length === 0) return <div className="py-12 text-center text-secondary">No income data for {year}.</div>

  // Collect unique groups
  const groups = Array.from(new Map(
    data.map((r) => [r.group_name, { name: r.group_name, sort: r.group_sort }])
  ).values()).sort((a, b) => a.sort - b.sort)

  // Build chart data: one entry per month
  const monthlyTotals: Record<string, Record<string, number>> = {}
  for (const row of data) {
    const label = MONTH_LABELS[parseInt(row.month, 10) - 1]
    if (!monthlyTotals[label]) monthlyTotals[label] = {}
    monthlyTotals[label][row.group_name] = (monthlyTotals[label]?.[row.group_name] ?? 0) + row.total_cents
  }
  const chartData = MONTH_LABELS.map((label) => ({
    month: label,
    ...Object.fromEntries(groups.map((g) => [g.name, (monthlyTotals[label]?.[g.name] ?? 0) / 100])),
  }))

  // Build per-category, per-month totals
  type CatRow = { category: string; group: string; months: number[] }
  const catMap = new Map<string, CatRow>()
  for (const row of data) {
    const key = `${row.group_name}::${row.category}`
    if (!catMap.has(key)) catMap.set(key, { category: row.category, group: row.group_name, months: Array(12).fill(0) })
    catMap.get(key)!.months[parseInt(row.month, 10) - 1] += row.total_cents
  }

  const monthIdx = parseInt(selectedMonth, 10) - 1
  const filteredRows = Array.from(catMap.values())
    .map((r) => ({ category: r.category, group: r.group, amount: r.months[monthIdx] }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount)
  const monthTotal = filteredRows.reduce((s, r) => s + r.amount, 0)

  const hasDataForSelectedMonth = filteredRows.length > 0

  return (
    <div className="space-y-6">
      <div className="card p-4">
        <ResponsiveContainer width="100%" height={240}>
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
              formatter={(value) => [formatMoney(Math.round((value as number) * 100)), '']}
            />
            <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
            {groups.map((g, i) => (
              <Bar key={g.name} dataKey={g.name} stackId="a" fill={GROUP_COLOURS[i % GROUP_COLOURS.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Mobile: month selector + single-month breakdown */}
      <div className="sm:hidden space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-secondary">Breakdown</p>
          <div className="w-28">
            <Select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
              {MONTH_LABELS.map((label, i) => (
                <option key={i} value={String(i + 1).padStart(2, '0')}>{label}</option>
              ))}
            </Select>
          </div>
        </div>

        {hasDataForSelectedMonth ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="pb-2 pr-4 text-secondary font-medium">Category</th>
                <th className="pb-2 text-right text-secondary font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredRows.map((r) => (
                <tr key={`${r.group}::${r.category}`} className="hover:bg-surface-2">
                  <td className="py-1.5 pr-4 text-primary">{r.category}</td>
                  <td className="py-1.5 text-right text-accent tabular-nums">{formatMoney(r.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="py-2 text-primary">Total</td>
                <td className="py-2 text-right text-accent tabular-nums">{formatMoney(monthTotal)}</td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <p className="py-6 text-center text-secondary text-sm">No income in {MONTH_LABELS[monthIdx]}.</p>
        )}
      </div>

      {/* Desktop: full 12-month table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="min-w-[900px] w-full text-sm md:table-fixed">
          <thead>
            <tr className="text-left border-b border-border">
              <th className="pb-2 pr-4 text-secondary font-medium relative" style={{ width: widths.category }}>Category<ResizeHandle onMouseDown={(e) => onResizeStart('category', e)} /></th>
              {MONTH_LABELS.map((m, i) => {
                const key = `m${String(i + 1).padStart(2, '0')}` as keyof typeof widths
                return (
                  <th key={m} className="pb-2 px-1 text-right text-secondary font-medium relative" style={{ width: widths[key] }}>
                    {m}<ResizeHandle onMouseDown={(e) => onResizeStart(key, e)} />
                  </th>
                )
              })}
              <th className="pb-2 pl-2 text-right text-secondary font-medium relative" style={{ width: widths.total }}>Total<ResizeHandle onMouseDown={(e) => onResizeStart('total', e)} /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Array.from(catMap.values())
              .sort((a, b) => a.group !== b.group ? a.group.localeCompare(b.group) : a.category.localeCompare(b.category))
              .map((r) => {
                const total = r.months.reduce((s, v) => s + v, 0)
                return (
                  <tr key={`${r.group}::${r.category}`} className="hover:bg-surface-2">
                    <td className="py-1.5 pr-4 text-primary truncate max-w-[176px]">{r.category}</td>
                    {r.months.map((v, i) => (
                      <td key={i} className="py-1.5 px-1 text-right tabular-nums">
                        {v > 0 ? <span className="text-accent">{formatMoney(v)}</span> : <span className="text-muted">–</span>}
                      </td>
                    ))}
                    <td className="py-1.5 pl-2 text-right font-medium text-accent tabular-nums">{formatMoney(total)}</td>
                  </tr>
                )
              })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td className="py-2 pr-4 text-primary">Total</td>
              {Array(12).fill(0).map((_, i) => {
                const total = Array.from(catMap.values()).reduce((s, r) => s + r.months[i], 0)
                return (
                  <td key={i} className="py-2 px-1 text-right tabular-nums">
                    {total > 0 ? <span className="text-accent">{formatMoney(total)}</span> : <span className="text-muted">–</span>}
                  </td>
                )
              })}
              <td className="py-2 pl-2 text-right text-accent tabular-nums">
                {formatMoney(Array.from(catMap.values()).reduce((s, r) => s + r.months.reduce((a, v) => a + v, 0), 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

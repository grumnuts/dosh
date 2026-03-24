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
import { reportsApi, type SpendingRow } from '../../api/reports'
import { formatMoney } from '../ui/AmountDisplay'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Distinct colours for group bars
const GROUP_COLOURS = [
  '#4ade80', '#60a5fa', '#f472b6', '#fb923c', '#a78bfa',
  '#34d399', '#38bdf8', '#facc15', '#f87171', '#818cf8',
]

interface Props {
  year: string
}

export function SpendingReport({ year }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'spending', year],
    queryFn: () => reportsApi.spending(year),
  })

  if (isLoading) return <div className="py-12 text-center text-secondary">Loading...</div>
  if (!data || data.length === 0) return <div className="py-12 text-center text-secondary">No spending data for {year}.</div>

  // Collect unique groups
  const groups = Array.from(new Map(
    data.map((r) => [r.group_name, { name: r.group_name, sort: r.group_sort }])
  ).values()).sort((a, b) => a.sort - b.sort)

  // Build chart data: one entry per month
  const monthlyTotals: Record<string, Record<string, number>> = {}
  for (const row of data) {
    const label = MONTH_LABELS[parseInt(row.month, 10) - 1]
    if (!monthlyTotals[label]) monthlyTotals[label] = {}
    monthlyTotals[label][row.group_name] = (monthlyTotals[label][row.group_name] ?? 0) + row.total_cents
  }
  const chartData = MONTH_LABELS.map((label) => ({
    month: label,
    ...Object.fromEntries(groups.map((g) => [g.name, (monthlyTotals[label]?.[g.name] ?? 0) / 100])),
  }))

  // Build table: category rows × month columns
  type CatRow = { category: string; group: string; months: number[]; total: number }
  const catMap = new Map<string, CatRow>()
  for (const row of data) {
    const key = `${row.group_name}::${row.category}`
    if (!catMap.has(key)) catMap.set(key, { category: row.category, group: row.group_name, months: Array(12).fill(0), total: 0 })
    const entry = catMap.get(key)!
    entry.months[parseInt(row.month, 10) - 1] += row.total_cents
    entry.total += row.total_cents
  }
  const tableRows = Array.from(catMap.values()).sort((a, b) =>
    a.group !== b.group ? a.group.localeCompare(b.group) : a.category.localeCompare(b.category),
  )
  const monthTotals = Array(12).fill(0) as number[]
  for (const r of tableRows) r.months.forEach((v, i) => { monthTotals[i] += v })
  const grandTotal = monthTotals.reduce((s, v) => s + v, 0)

  return (
    <div className="space-y-6">
      <div className="card p-4">
        <ResponsiveContainer width="100%" height={280}>
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
            {groups.map((g, i) => (
              <Bar key={g.name} dataKey={g.name} stackId="a" fill={GROUP_COLOURS[i % GROUP_COLOURS.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[900px] w-full text-sm">
          <thead>
            <tr className="text-left border-b border-border">
              <th className="pb-2 pr-4 text-secondary font-medium w-44">Category</th>
              {MONTH_LABELS.map((m) => (
                <th key={m} className="pb-2 px-1 text-right text-secondary font-medium w-16">{m}</th>
              ))}
              <th className="pb-2 pl-2 text-right text-secondary font-medium w-20">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tableRows.map((r) => (
              <tr key={`${r.group}::${r.category}`} className="hover:bg-surface-2">
                <td className="py-1.5 pr-4 text-primary truncate max-w-[176px]">{r.category}</td>
                {r.months.map((v, i) => (
                  <td key={i} className="py-1.5 px-1 text-right text-secondary tabular-nums">
                    {v > 0 ? formatMoney(v) : <span className="text-muted">–</span>}
                  </td>
                ))}
                <td className="py-1.5 pl-2 text-right font-medium text-primary tabular-nums">{formatMoney(r.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td className="py-2 pr-4 text-primary">Total</td>
              {monthTotals.map((v, i) => (
                <td key={i} className="py-2 px-1 text-right text-primary tabular-nums">
                  {v > 0 ? formatMoney(v) : <span className="text-muted">–</span>}
                </td>
              ))}
              <td className="py-2 pl-2 text-right text-accent tabular-nums">{formatMoney(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

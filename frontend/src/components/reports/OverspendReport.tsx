import { useQuery } from '@tanstack/react-query'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { reportsApi } from '../../api/reports'
import { formatMoney } from '../ui/AmountDisplay'

interface Props {
  year: string
}

export function OverspendReport({ year }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'overspend', year],
    queryFn: () => reportsApi.overspend(year),
  })

  if (isLoading) return <div className="py-12 text-center text-secondary">Loading...</div>
  if (!data || data.length === 0) return <div className="py-12 text-center text-secondary">No overspend recorded for {year}.</div>

  // Chart: total overspend grouped by period_label
  const byLabel = new Map<string, number>()
  for (const row of data) {
    byLabel.set(row.period_label, (byLabel.get(row.period_label) ?? 0) + row.overspend_cents)
  }
  const chartData = Array.from(byLabel.entries()).map(([label, cents]) => ({
    period: label,
    overspend: cents / 100,
  }))

  return (
    <div className="space-y-6">
      {chartData.length > 0 && (
        <div className="card p-4">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="period" tick={{ fill: '#6b7280', fontSize: 12 }} axisLine={false} tickLine={false} />
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
                formatter={(value) => [formatMoney(Math.round((value as number) * 100)), 'Overspend']}
              />
              <Bar dataKey="overspend" fill="#f87171" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="pb-2 pr-2 text-secondary font-medium">Category</th>
            <th className="pb-2 pr-2 text-secondary font-medium hidden sm:table-cell">Group</th>
            <th className="pb-2 pr-2 text-secondary font-medium">Period</th>
            <th className="pb-2 pr-2 text-right text-secondary font-medium">Budgeted</th>
            <th className="pb-2 pr-2 text-right text-secondary font-medium">Spent</th>
            <th className="pb-2 text-right text-secondary font-medium">Over</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.map((row, i) => (
            <tr key={i} className="hover:bg-surface-2">
              <td className="py-1.5 pr-2 text-primary">{row.category}</td>
              <td className="py-1.5 pr-2 text-secondary hidden sm:table-cell">{row.group_name}</td>
              <td className="py-1.5 pr-2 text-secondary">{row.period_label}</td>
              <td className="py-1.5 pr-2 text-right text-secondary tabular-nums">{formatMoney(row.budgeted_cents)}</td>
              <td className="py-1.5 pr-2 text-right text-secondary tabular-nums">{formatMoney(row.spent_cents)}</td>
              <td className="py-1.5 text-right text-danger font-medium tabular-nums">{formatMoney(row.overspend_cents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border font-semibold">
            <td colSpan={4} className="py-2 pr-2 text-right text-secondary sm:hidden">Total</td>
            <td colSpan={5} className="py-2 pr-2 text-right text-secondary hidden sm:table-cell">Total overspend</td>
            <td className="py-2 text-right text-danger tabular-nums">
              {formatMoney(data.reduce((s, r) => s + r.overspend_cents, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

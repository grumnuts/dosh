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
import { useResizableCols, ResizeHandle } from '../../hooks/useResizableCols'

const DEFAULT_COL_WIDTHS = { category: 180, group: 150, budgeted: 95, spent: 95, over: 95 }

interface Props {
  year: string
}

export function OverspendReport({ year }: Props) {
  const { widths, onResizeStart } = useResizableCols(DEFAULT_COL_WIDTHS, 'dosh:overspend-col-widths-v2')
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'overspend', year],
    queryFn: () => reportsApi.overspend(year),
  })

  if (isLoading) return <div className="py-12 text-center text-secondary">Loading...</div>
  if (!data || data.length === 0) return <div className="py-12 text-center text-secondary">No overspend recorded for {year}.</div>

  // Chart: overspend per category
  const chartData = data.map((row) => ({
    period: row.category,
    overspend: row.overspend_cents / 100,
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

      <table className="w-full text-sm md:table-fixed">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="pb-2 pr-2 text-secondary font-medium relative" style={{ width: widths.category }}>Category<ResizeHandle onMouseDown={(e) => onResizeStart('category', e)} /></th>
            <th className="pb-2 pr-2 text-secondary font-medium hidden sm:table-cell relative" style={{ width: widths.group }}>Group<ResizeHandle onMouseDown={(e) => onResizeStart('group', e)} /></th>
            <th className="pb-2 pr-2 text-right text-secondary font-medium relative" style={{ width: widths.budgeted }}>Annual Budget<ResizeHandle onMouseDown={(e) => onResizeStart('budgeted', e)} /></th>
            <th className="pb-2 pr-2 text-right text-secondary font-medium relative" style={{ width: widths.spent }}>Spent<ResizeHandle onMouseDown={(e) => onResizeStart('spent', e)} /></th>
            <th className="pb-2 text-right text-secondary font-medium relative" style={{ width: widths.over }}>Over<ResizeHandle onMouseDown={(e) => onResizeStart('over', e)} /></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.map((row, i) => (
            <tr key={i} className="hover:bg-surface-2">
              <td className="py-1.5 pr-2 text-primary">{row.category}</td>
              <td className="py-1.5 pr-2 text-secondary hidden sm:table-cell">{row.group_name}</td>
              <td className="py-1.5 pr-2 text-right text-secondary tabular-nums">{formatMoney(row.budgeted_cents)}</td>
              <td className="py-1.5 pr-2 text-right text-secondary tabular-nums">{formatMoney(row.spent_cents)}</td>
              <td className="py-1.5 text-right text-danger font-medium tabular-nums">{formatMoney(row.overspend_cents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border font-semibold">
            <td colSpan={3} className="py-2 pr-2 text-right text-secondary sm:hidden">Total</td>
            <td colSpan={4} className="py-2 pr-2 text-right text-secondary hidden sm:table-cell">Total overspend</td>
            <td className="py-2 text-right text-danger tabular-nums">
              {formatMoney(data.reduce((s, r) => s + r.overspend_cents, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

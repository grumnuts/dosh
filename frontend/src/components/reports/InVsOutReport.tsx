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

export function InVsOutReport({ year }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'invsout', year],
    queryFn: () => reportsApi.invsout(year),
  })

  if (isLoading) return <div className="py-12 text-center text-secondary">Loading...</div>
  if (!data || data.length === 0) return <div className="py-12 text-center text-secondary">No data for {year}.</div>

  const chartData = MONTH_LABELS.map((label, i) => {
    const month = String(i + 1).padStart(2, '0')
    const row = data.find((r) => r.month === month)
    return {
      month: label,
      income: (row?.income_cents ?? 0) / 100,
      expense: (row?.expense_cents ?? 0) / 100,
    }
  })

  const totalIncome = data.reduce((s, r) => s + r.income_cents, 0)
  const totalExpense = data.reduce((s, r) => s + r.expense_cents, 0)
  const totalNet = totalIncome - totalExpense

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card px-3 py-3">
          <p className="text-xs text-secondary uppercase tracking-wide font-medium">Total In</p>
          <p className="text-sm sm:text-lg font-bold text-accent tabular-nums mt-0.5">{formatMoney(totalIncome)}</p>
        </div>
        <div className="card px-3 py-3">
          <p className="text-xs text-secondary uppercase tracking-wide font-medium">Total Out</p>
          <p className="text-sm sm:text-lg font-bold text-danger tabular-nums mt-0.5">{formatMoney(totalExpense)}</p>
        </div>
        <div className="card px-3 py-3">
          <p className="text-xs text-secondary uppercase tracking-wide font-medium">Net</p>
          <p className={`text-sm sm:text-lg font-bold tabular-nums mt-0.5 ${totalNet >= 0 ? 'text-accent' : 'text-danger'}`}>
            {totalNet < 0 ? '-' : ''}{formatMoney(Math.abs(totalNet))}
          </p>
        </div>
      </div>

      {/* Chart */}
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
              width={60}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid #374151', borderRadius: 6 }}
              labelStyle={{ color: '#e5e7eb' }}
              formatter={(value) => [formatMoney(Math.round((value as number) * 100)), '']}
            />
            <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
            <Bar dataKey="income" name="In" fill="#4ade80" radius={[3, 3, 0, 0]} />
            <Bar dataKey="expense" name="Out" fill="#f87171" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="pb-2 pr-4 text-secondary font-medium">Month</th>
            <th className="pb-2 pr-4 text-right text-secondary font-medium">In</th>
            <th className="pb-2 text-right text-secondary font-medium sm:pr-4">Out</th>
            <th className="pb-2 pr-4 text-right text-secondary font-medium hidden sm:table-cell">Net</th>
            <th className="pb-2 text-right text-secondary font-medium hidden sm:table-cell">Savings Rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.map((row) => {
            const net = row.income_cents - row.expense_cents
            const savingsRate = row.income_cents > 0 ? Math.round((net / row.income_cents) * 100) : 0
            return (
              <tr key={row.month} className="hover:bg-surface-2">
                <td className="py-1.5 pr-4 text-secondary">{MONTH_LABELS[parseInt(row.month, 10) - 1]}</td>
                <td className="py-1.5 pr-4 text-right text-accent tabular-nums">{formatMoney(row.income_cents)}</td>
                <td className="py-1.5 text-right text-danger tabular-nums sm:pr-4">{formatMoney(row.expense_cents)}</td>
                <td className={`py-1.5 pr-4 text-right tabular-nums font-medium hidden sm:table-cell ${net >= 0 ? 'text-accent' : 'text-danger'}`}>
                  {net < 0 ? '-' : ''}{formatMoney(Math.abs(net))}
                </td>
                <td className={`py-1.5 text-right tabular-nums hidden sm:table-cell ${savingsRate >= 0 ? 'text-accent' : 'text-danger'}`}>
                  {savingsRate}%
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border font-semibold">
            <td className="py-2 pr-4 text-primary">Total</td>
            <td className="py-2 pr-4 text-right text-accent tabular-nums">{formatMoney(totalIncome)}</td>
            <td className="py-2 text-right text-danger tabular-nums sm:pr-4">{formatMoney(totalExpense)}</td>
            <td className={`py-2 pr-4 text-right tabular-nums hidden sm:table-cell ${totalNet >= 0 ? 'text-accent' : 'text-danger'}`}>
              {totalNet < 0 ? '-' : ''}{formatMoney(Math.abs(totalNet))}
            </td>
            <td className={`py-2 text-right tabular-nums hidden sm:table-cell ${totalNet >= 0 ? 'text-accent' : 'text-danger'}`}>
              {totalIncome > 0 ? Math.round((totalNet / totalIncome) * 100) : 0}%
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { reportsApi } from '../../api/reports'
import { formatMoney } from '../ui/AmountDisplay'

const ACCOUNT_COLOURS = [
  '#60a5fa', '#a78bfa', '#fb923c', '#34d399', '#f472b6',
  '#38bdf8', '#facc15', '#4ade80', '#f87171', '#818cf8',
]

export function NetWorthReport() {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'networth'],
    queryFn: reportsApi.networth,
  })

  if (isLoading) return <div className="py-12 text-center text-secondary">Loading...</div>
  if (!data || data.netWorth.length === 0) return <div className="py-12 text-center text-secondary">No account data available.</div>

  const latestNetWorth = data.netWorth[data.netWorth.length - 1]?.balance ?? 0

  // Assets (positive balance accounts) and liabilities (negative balance)
  const accountCurrentBalances = data.accounts.map((a) => ({
    ...a,
    currentBalance: a.history.length > 0 ? a.history[a.history.length - 1].balance : 0,
  }))
  const assets = accountCurrentBalances.filter((a) => a.currentBalance > 0)
  const liabilities = accountCurrentBalances.filter((a) => a.currentBalance < 0)

  // Net worth chart data
  const netWorthChartData = data.netWorth.map((p) => ({
    month: p.month,
    'Net Worth': p.balance / 100,
  }))

  // Account balance chart — only accounts with any history
  const activeAccounts = data.accounts.filter((a) => a.history.length > 0)
  // Build unified month list
  const allMonths = Array.from(new Set(data.netWorth.map((p) => p.month))).sort()
  const balanceChartData = allMonths.map((month) => {
    const entry: Record<string, number | string> = { month }
    for (const account of activeAccounts) {
      const point = [...account.history].reverse().find((h) => h.month <= month)
      entry[account.name] = point ? point.balance / 100 : 0
    }
    return entry
  })

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card px-4 py-3">
          <p className="text-xs text-secondary uppercase tracking-wide font-medium">Net Worth</p>
          <p className={`text-lg font-bold tabular-nums mt-0.5 ${latestNetWorth >= 0 ? 'text-accent' : 'text-danger'}`}>
            {formatMoney(latestNetWorth)}
          </p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-secondary uppercase tracking-wide font-medium">Assets</p>
          <p className="text-lg font-bold text-accent tabular-nums mt-0.5">
            {formatMoney(assets.reduce((s, a) => s + a.currentBalance, 0))}
          </p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-secondary uppercase tracking-wide font-medium">Liabilities</p>
          <p className="text-lg font-bold text-danger tabular-nums mt-0.5">
            {formatMoney(Math.abs(liabilities.reduce((s, a) => s + a.currentBalance, 0)))}
          </p>
        </div>
      </div>

      {/* Net worth trend */}
      <div className="card p-4">
        <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">Net Worth Over Time</p>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={netWorthChartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="month"
              tick={{ fill: '#6b7280', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: '#6b7280', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              width={55}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid #374151', borderRadius: 6 }}
              labelStyle={{ color: '#e5e7eb' }}
              formatter={(value) => [formatMoney(Math.round((value as number) * 100)), '']}
            />
            <Line
              type="monotone"
              dataKey="Net Worth"
              stroke="#4ade80"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Account balances over time */}
      {activeAccounts.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">Account Balances Over Time</p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={balanceChartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="month"
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                width={55}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid #374151', borderRadius: 6 }}
                labelStyle={{ color: '#e5e7eb' }}
                formatter={(value) => [formatMoney(Math.round((value as number) * 100)), '']}
              />
              <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
              {activeAccounts.map((account, i) => (
                <Line
                  key={account.id}
                  type="monotone"
                  dataKey={account.name}
                  stroke={ACCOUNT_COLOURS[i % ACCOUNT_COLOURS.length]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Current balances table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-border">
              <th className="pb-2 pr-4 text-secondary font-medium">Account</th>
              <th className="pb-2 pr-4 text-secondary font-medium">Type</th>
              <th className="pb-2 text-right text-secondary font-medium">Current Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {accountCurrentBalances.map((a) => (
              <tr key={a.id} className="hover:bg-surface-2">
                <td className="py-1.5 pr-4 text-primary">{a.name}</td>
                <td className="py-1.5 pr-4 text-secondary capitalize">{a.type}</td>
                <td className={`py-1.5 text-right tabular-nums font-medium ${a.currentBalance < 0 ? 'text-danger' : 'text-primary'}`}>
                  {formatMoney(a.currentBalance)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td colSpan={2} className="py-2 text-secondary">Net Worth</td>
              <td className={`py-2 text-right tabular-nums ${latestNetWorth >= 0 ? 'text-accent' : 'text-danger'}`}>
                {formatMoney(latestNetWorth)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

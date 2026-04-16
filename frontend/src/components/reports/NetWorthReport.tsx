import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { investmentsApi } from '../../api/investments'
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
import { useResizableCols, ResizeHandle } from '../../hooks/useResizableCols'

const DEFAULT_COL_WIDTHS = { account: 200, type: 100, balance: 150 }

function formatYAxisTick(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `$${Math.round(v / 1_000_000)}M`
  if (abs >= 1_000) return `$${Math.round(v / 1_000)}k`
  return `$${Math.round(v)}`
}

const ACCOUNT_COLOURS = [
  '#60a5fa', '#a78bfa', '#fb923c', '#34d399', '#f472b6',
  '#38bdf8', '#facc15', '#4ade80', '#f87171', '#818cf8',
]

// Distribute percentages across items so they sum to exactly 100.00%
// Uses the largest-remainder method (units of 0.01%).
function distributePercentages(values: number[]): string[] {
  const total = values.reduce((s, v) => s + v, 0)
  if (total === 0) return values.map(() => '0.00')
  const raw = values.map((v) => (v / total) * 10000)
  const floored = raw.map((r) => Math.floor(r))
  const slots = 10000 - floored.reduce((s, v) => s + v, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac)
  const result = [...floored]
  for (let k = 0; k < slots; k++) result[order[k % order.length].i] += 1
  return result.map((v) => (v / 100).toFixed(2))
}

interface Props {
  section?: 'networth' | 'balances' | 'breakdown'
}

export function NetWorthReport({ section }: Props = {}) {
  const { widths, onResizeStart } = useResizableCols(DEFAULT_COL_WIDTHS, 'dosh:networth-col-widths')
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'networth'],
    queryFn: reportsApi.networth,
  })

  if (isLoading) return <div className="py-12 text-center text-secondary">Loading...</div>
  if (!data || data.netWorth.length === 0) return <div className="py-12 text-center text-secondary">No account data available.</div>

  const latestNetWorth = data.netWorth[data.netWorth.length - 1]?.balance ?? 0

  const accountCurrentBalances = data.accounts.map((a) => ({
    ...a,
    currentBalance: a.history.length > 0 ? a.history[a.history.length - 1].balance : 0,
  }))
  const assets = accountCurrentBalances.filter((a) => a.currentBalance > 0)
  const liabilities = accountCurrentBalances.filter((a) => a.currentBalance < 0)

  const netWorthChartData = data.netWorth.map((p) => ({
    month: p.month,
    'Net Worth': p.balance / 100,
  }))

  const activeAccounts = data.accounts.filter((a) => a.history.length > 0)
  const allMonths = Array.from(new Set(data.netWorth.map((p) => p.month))).sort()
  const balanceChartData = allMonths.map((month) => {
    const entry: Record<string, number | string> = { month }
    for (const account of activeAccounts) {
      const point = [...account.history].reverse().find((h) => h.month <= month)
      entry[account.name] = point ? point.balance / 100 : 0
    }
    return entry
  })

  const accountColourMap = new Map(activeAccounts.map((a, i) => [a.id, ACCOUNT_COLOURS[i % ACCOUNT_COLOURS.length]]))

  if (section === 'networth') {
    const lastTwo = netWorthChartData.slice(-2)
    const isTrendingDown = lastTwo.length === 2 && lastTwo[1]['Net Worth'] < lastTwo[0]['Net Worth']
    const netWorthLineColour = latestNetWorth < 0 || isTrendingDown ? '#f87171' : '#4ade80'

    return (
      <div className="space-y-6">
        <div className="card p-4">
          <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">Net Worth Over Time</p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={netWorthChartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={formatYAxisTick} width={55} domain={[(v: number) => Math.min(v, 0), 'auto']} />
              <Tooltip contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid #374151', borderRadius: 6 }} labelStyle={{ color: '#e5e7eb' }} formatter={(value) => [formatMoney(Math.round((value as number) * 100)), '']} />
              <Line type="monotone" dataKey="Net Worth" stroke={netWorthLineColour} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2 md:space-y-0 md:grid md:grid-cols-3 md:gap-3">
          <div className="card px-3 py-3">
            <p className="text-xs text-secondary uppercase tracking-wide font-medium">Net Worth</p>
            <p className={`text-base font-bold tabular-nums mt-0.5 ${latestNetWorth >= 0 ? 'text-accent' : 'text-danger'}`}>
              {formatMoney(latestNetWorth)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 md:contents">
            <div className="card px-3 py-3">
              <p className="text-xs text-secondary uppercase tracking-wide font-medium">Assets</p>
              <p className="text-sm font-bold text-accent tabular-nums mt-0.5">
                {formatMoney(assets.reduce((s, a) => s + a.currentBalance, 0))}
              </p>
            </div>
            <div className="card px-3 py-3">
              <p className="text-xs text-secondary uppercase tracking-wide font-medium">Liabilities</p>
              <p className="text-sm font-bold text-danger tabular-nums mt-0.5">
                {formatMoney(Math.abs(liabilities.reduce((s, a) => s + a.currentBalance, 0)))}
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (section === 'breakdown') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { data: holdingsData } = useQuery({
      queryKey: ['investments', 'holdings'],
      queryFn: investmentsApi.holdings,
    })

    // Build the flat asset list: non-investment accounts + one row per investment ticker
    const rows: Array<{ key: string; name: string; balanceCents: number }> = []

    for (const a of assets) {
      if (a.type === 'investment_portfolio') {
        // Explode into individual tickers
        for (const h of holdingsData?.holdings ?? []) {
          if (h.marketValueCents > 0) {
            rows.push({ key: `ticker:${h.ticker}`, name: h.ticker, balanceCents: h.marketValueCents })
          }
        }
      } else {
        rows.push({ key: `account:${a.id}`, name: a.name, balanceCents: a.currentBalance })
      }
    }

    rows.sort((a, b) => b.balanceCents - a.balanceCents)
    const percentages = distributePercentages(rows.map((r) => r.balanceCents))

    if (rows.length === 0) {
      return <div className="py-6 text-center text-sm text-secondary">No assets to display.</div>
    }

    return (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted uppercase tracking-wide">
            <th className="text-left py-2 font-medium">Asset</th>
            <th className="text-right py-2 font-medium">% of Assets</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map((row, i) => (
            <tr key={row.key}>
              <td className="py-2 text-primary">{row.name}</td>
              <td className="py-2 text-right font-mono tabular-nums text-secondary">{percentages[i]}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  if (section === 'balances') {
    const chartAccounts = selectedAccountId
      ? activeAccounts.filter((a) => a.id === selectedAccountId)
      : activeAccounts

    let yDomain: [number, number] | ['auto', 'auto'] = ['auto', 'auto']
    let yTicks: number[] | undefined
    if (selectedAccountId && chartAccounts.length > 0) {
      const values = balanceChartData.map((d) => (d[chartAccounts[0].name] as number) ?? 0)
      const min = Math.min(...values)
      const max = Math.max(...values)
      const pad = Math.max((max - min) * 0.1, 500)
      const domainMin = min >= 0 ? 0 : Math.floor(min - pad)
      const domainMax = Math.ceil(max + pad)
      yDomain = [domainMin, domainMax]
      // Snap step to formatter resolution so labels are always distinct
      const absMax = Math.max(Math.abs(domainMin), Math.abs(domainMax))
      const fmtResolution = absMax >= 1_000_000 ? 1_000_000 : absMax >= 1_000 ? 1_000 : 1
      const range = domainMax - domainMin
      const rawStep = range / 5
      const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep || 1)))
      const niceStep = Math.ceil(rawStep / magnitude) * magnitude || fmtResolution
      const step = Math.ceil(niceStep / fmtResolution) * fmtResolution
      const tickStart = Math.floor(domainMin / step) * step
      yTicks = []
      for (let t = tickStart; t <= domainMax + step / 2; t += step) {
        yTicks.push(Math.round(t))
      }
    }

    return (
      <div className="space-y-6">
        {activeAccounts.length > 0 && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-secondary uppercase tracking-wide">Account Balances Over Time</p>
              {selectedAccountId && (
                <button
                  onClick={() => setSelectedAccountId(null)}
                  className="text-xs text-accent hover:underline"
                >
                  Show all
                </button>
              )}
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={balanceChartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis
                  tick={{ fill: '#6b7280', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={formatYAxisTick}
                  width={55}
                  domain={yDomain}
                  ticks={yTicks}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid #374151', borderRadius: 6 }}
                  labelStyle={{ color: '#e5e7eb' }}
                  formatter={(value) => [formatMoney(Math.round((value as number) * 100)), '']}
                />
                {chartAccounts.map((account) => (
                  <Line
                    key={account.id}
                    type="monotone"
                    dataKey={account.name}
                    stroke={accountColourMap.get(account.id)!}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <table className="w-full text-sm md:table-fixed">
          <thead>
            <tr className="text-left border-b border-border">
              <th className="pb-2 pr-4 text-secondary font-medium relative" style={{ width: widths.account }}>Account<ResizeHandle onMouseDown={(e) => onResizeStart('account', e)} /></th>
              <th className="pb-2 pr-4 text-secondary font-medium relative" style={{ width: widths.type }}>Type<ResizeHandle onMouseDown={(e) => onResizeStart('type', e)} /></th>
              <th className="pb-2 text-right text-secondary font-medium relative" style={{ width: widths.balance }}>Current Balance<ResizeHandle onMouseDown={(e) => onResizeStart('balance', e)} /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {accountCurrentBalances.map((a) => {
              const colour = accountColourMap.get(a.id)
              const isSelected = selectedAccountId === a.id
              return (
                <tr
                  key={a.id}
                  className={`${colour ? 'cursor-pointer' : ''} ${isSelected ? 'bg-surface-2' : colour ? 'hover:bg-surface-2' : ''}`}
                  onClick={() => colour && setSelectedAccountId(isSelected ? null : a.id)}
                >
                  <td className="py-1.5 pr-4 text-primary">
                    <span className="flex items-center gap-2">
                      {colour
                        ? <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colour }} />
                        : <span className="w-2 h-2 shrink-0" />
                      }
                      {a.name}
                    </span>
                  </td>
                  <td className="py-1.5 pr-4 text-secondary capitalize">{a.type === 'investment_portfolio' ? 'Investments' : a.type}</td>
                  <td className={`py-1.5 text-right tabular-nums font-medium ${a.currentBalance < 0 ? 'text-danger' : 'text-primary'}`}>
                    {formatMoney(a.currentBalance)}
                  </td>
                </tr>
              )
            })}
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
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="space-y-2">
        <div className="card px-3 py-3">
          <p className="text-xs text-secondary uppercase tracking-wide font-medium">Net Worth</p>
          <p className={`text-base font-bold tabular-nums mt-0.5 ${latestNetWorth >= 0 ? 'text-accent' : 'text-danger'}`}>
            {formatMoney(latestNetWorth)}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="card px-3 py-3">
            <p className="text-xs text-secondary uppercase tracking-wide font-medium">Assets</p>
            <p className="text-sm font-bold text-accent tabular-nums mt-0.5">
              {formatMoney(assets.reduce((s, a) => s + a.currentBalance, 0))}
            </p>
          </div>
          <div className="card px-3 py-3">
            <p className="text-xs text-secondary uppercase tracking-wide font-medium">Liabilities</p>
            <p className="text-sm font-bold text-danger tabular-nums mt-0.5">
              {formatMoney(Math.abs(liabilities.reduce((s, a) => s + a.currentBalance, 0)))}
            </p>
          </div>
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
              tickFormatter={formatYAxisTick}
              width={55}
              domain={[(v: number) => Math.min(v, 0), 'auto']}
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
                tickFormatter={formatYAxisTick}
                width={55}
                domain={[(v: number) => Math.min(v, 0), 'auto']}
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
      <table className="w-full text-sm md:table-fixed">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="pb-2 pr-4 text-secondary font-medium relative" style={{ width: widths.account }}>Account<ResizeHandle onMouseDown={(e) => onResizeStart('account', e)} /></th>
            <th className="pb-2 pr-4 text-secondary font-medium relative" style={{ width: widths.type }}>Type<ResizeHandle onMouseDown={(e) => onResizeStart('type', e)} /></th>
            <th className="pb-2 text-right text-secondary font-medium relative" style={{ width: widths.balance }}>Current Balance<ResizeHandle onMouseDown={(e) => onResizeStart('balance', e)} /></th>
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
  )
}

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { investmentsApi, HoldingRow } from '../../api/investments'
import { formatMoney } from '../ui/AmountDisplay'
import { Button } from '../ui/Button'

const TICKER_COLOURS = [
  '#60a5fa', '#a78bfa', '#fb923c', '#34d399', '#f472b6',
  '#38bdf8', '#facc15', '#4ade80', '#f87171', '#818cf8',
]

function formatQuantity(qty: number): string {
  if (qty === Math.floor(qty)) return qty.toLocaleString()
  return qty.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function GainLoss({ cents }: { cents: number }) {
  if (cents === 0) return <span className="text-secondary">—</span>
  const cls = cents > 0 ? 'text-accent' : 'text-danger'
  const sign = cents > 0 ? '+' : ''
  return <span className={cls}>{sign}{formatMoney(cents)}</span>
}

function GainLossPct({ holding }: { holding: HoldingRow }) {
  if (holding.costBasisCents === 0) return <span className="text-secondary">—</span>
  const pct = (holding.gainLossCents / holding.costBasisCents) * 100
  const cls = pct >= 0 ? 'text-accent' : 'text-danger'
  const sign = pct >= 0 ? '+' : ''
  return <span className={cls}>{sign}{pct.toFixed(2)}%</span>
}

export function InvestmentsReport() {
  const qc = useQueryClient()
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['investments', 'holdings'],
    queryFn: investmentsApi.holdings,
  })

  const { data: historyData } = useQuery({
    queryKey: ['investments', 'history'],
    queryFn: investmentsApi.history,
  })

  const refreshMutation = useMutation({
    mutationFn: investmentsApi.refreshPrices,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['investments'] }),
  })

  // Refresh prices on mount
  useEffect(() => {
    refreshMutation.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (isLoading) {
    return <div className="py-8 text-center text-sm text-muted">Loading...</div>
  }

  if (!data || data.holdings.length === 0) {
    return (
      <div className="py-8 text-center space-y-2">
        <p className="text-sm text-secondary">No investment holdings.</p>
        <p className="text-xs text-muted">
          Add an investment category under Savings &amp; Investments, then add transactions with a Quantity to track your portfolio.
        </p>
      </div>
    )
  }

  const totalGainLoss = data.holdings.reduce((sum, h) => sum + h.gainLossCents, 0)
  const totalCostBasis = data.holdings.reduce((sum, h) => sum + h.costBasisCents, 0)

  const tickerColourMap = new Map(
    (historyData?.tickers ?? data.holdings.map((h) => h.ticker)).map((t, i) => [t, TICKER_COLOURS[i % TICKER_COLOURS.length]])
  )

  // Derive chart display data based on selection
  const displayChartData = historyData?.chartData.map((row) => {
    if (selectedTicker) {
      return { month: row.month, [selectedTicker]: row[selectedTicker] ?? 0 }
    }
    const total = historyData.tickers.reduce((sum, t) => sum + ((row[t] as number) ?? 0), 0)
    return { month: row.month, total }
  }) ?? []
  const displayKey = selectedTicker ?? 'total'
  const displayColour = selectedTicker ? (tickerColourMap.get(selectedTicker) ?? '#60a5fa') : '#4ade80'
  const displayLabel = selectedTicker ?? 'Portfolio'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-xs text-muted">Portfolio Value</div>
            <div className="text-lg font-semibold font-mono text-primary tabular-nums">
              {formatMoney(data.totalMarketValueCents)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Total Gain / Loss</div>
            <div className="text-lg font-semibold font-mono tabular-nums">
              <GainLoss cents={totalGainLoss} />
              {totalCostBasis > 0 && (
                <span className="text-xs ml-1 font-normal">
                  ({((totalGainLoss / totalCostBasis) * 100).toFixed(2)}%)
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data.lastUpdated && (
            <span className="text-xs text-muted hidden sm:block">
              Updated {formatDate(data.lastUpdated)}
            </span>
          )}
          <Button
            variant="outline"
            onClick={() => refreshMutation.mutate()}
            loading={refreshMutation.isPending}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Portfolio value chart */}
      {historyData && displayChartData.length > 1 && (
        <div className="card p-4">
          <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">
            {selectedTicker ? `${selectedTicker} Value Over Time` : 'Portfolio Value Over Time'}
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={displayChartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
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
                formatter={(value) => [formatMoney(Math.round((value as number) * 100)), displayLabel]}
              />
              <Line
                type="monotone"
                dataKey={displayKey}
                stroke={displayColour}
                strokeWidth={2}
                dot={false}
                name={displayLabel}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Holdings table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted uppercase tracking-wide">
              <th className="text-left py-2 pr-3 font-medium">Ticker</th>
              <th className="text-right py-2 pr-3 font-medium hidden sm:table-cell">Units</th>
              <th className="text-right py-2 pr-3 font-medium hidden md:table-cell">Avg Cost</th>
              <th className="text-right py-2 pr-3 font-medium">Price</th>
              <th className="text-right py-2 pr-3 font-medium">Value</th>
              <th className="text-right py-2 font-medium hidden sm:table-cell">Gain / Loss</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {data.holdings.map((h) => {
              const avgCostCents = h.quantity > 0 ? Math.round(h.costBasisCents / h.quantity) : 0
              const colour = tickerColourMap.get(h.ticker)
              const isSelected = selectedTicker === h.ticker
              return (
                <tr
                  key={h.ticker}
                  className={`cursor-pointer transition-colors ${isSelected ? 'bg-surface-2' : 'hover:bg-surface-2/50'}`}
                  onClick={() => setSelectedTicker(isSelected ? null : h.ticker)}
                >
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      {colour && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colour }} />}
                      <div>
                        <div className="font-semibold text-primary">{h.ticker}</div>
                        {h.name && <div className="text-xs text-muted truncate max-w-[120px]">{h.name}</div>}
                        <div className="text-xs sm:hidden">
                          <GainLoss cents={h.gainLossCents} />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-primary hidden sm:table-cell">
                    {formatQuantity(h.quantity)}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-secondary hidden md:table-cell">
                    {formatMoney(avgCostCents)}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-primary">
                    {h.priceCents > 0 ? formatMoney(h.priceCents) : <span className="text-muted">—</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-primary">
                    {formatMoney(h.marketValueCents)}
                  </td>
                  <td className="py-2.5 text-right font-mono tabular-nums hidden sm:table-cell">
                    <GainLoss cents={h.gainLossCents} />
                    <div className="text-xs">
                      <GainLossPct holding={h} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td className="py-2.5 pr-3 text-xs text-muted uppercase tracking-wide">Total</td>
              <td className="py-2.5 pr-3 hidden sm:table-cell" />
              <td className="py-2.5 pr-3 hidden md:table-cell" />
              <td className="py-2.5 pr-3" />
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-primary">
                {formatMoney(data.totalMarketValueCents)}
              </td>
              <td className="py-2.5 text-right font-mono tabular-nums hidden sm:table-cell">
                <GainLoss cents={totalGainLoss} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

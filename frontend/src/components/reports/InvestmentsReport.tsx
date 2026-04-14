import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { investmentsApi, HoldingRow } from '../../api/investments'
import { formatMoney } from '../ui/AmountDisplay'
import { Button } from '../ui/Button'

function formatQuantity(qty: number): string {
  if (qty === Math.floor(qty)) return qty.toLocaleString()
  return qty.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
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

  const { data, isLoading } = useQuery({
    queryKey: ['investments', 'holdings'],
    queryFn: investmentsApi.holdings,
  })

  const refreshMutation = useMutation({
    mutationFn: investmentsApi.refreshPrices,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['investments', 'holdings'] }),
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
          Create a budget category with &quot;Investment Category&quot; enabled, then add transactions with a Ticker &amp; Quantity to track your portfolio.
        </p>
      </div>
    )
  }

  const totalGainLoss = data.holdings.reduce((sum, h) => sum + h.gainLossCents, 0)
  const totalCostBasis = data.holdings.reduce((sum, h) => sum + h.costBasisCents, 0)

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
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
            Refresh Prices
          </Button>
        </div>
      </div>

      {/* Holdings table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted uppercase tracking-wide">
              <th className="text-left py-2 pr-3 font-medium">Ticker</th>
              <th className="text-left py-2 pr-3 font-medium hidden sm:table-cell">Account</th>
              <th className="text-right py-2 pr-3 font-medium">Shares</th>
              <th className="text-right py-2 pr-3 font-medium hidden md:table-cell">Avg Cost</th>
              <th className="text-right py-2 pr-3 font-medium">Price</th>
              <th className="text-right py-2 pr-3 font-medium">Value</th>
              <th className="text-right py-2 font-medium">Gain / Loss</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {data.holdings.map((h) => {
              const avgCostCents = h.quantity > 0 ? Math.round(h.costBasisCents / h.quantity) : 0
              return (
                <tr key={`${h.accountId}-${h.ticker}`} className="hover:bg-surface-2/50 transition-colors">
                  <td className="py-2.5 pr-3">
                    <div className="font-semibold text-primary">{h.ticker}</div>
                    {h.name && <div className="text-xs text-muted truncate max-w-[120px]">{h.name}</div>}
                  </td>
                  <td className="py-2.5 pr-3 text-secondary hidden sm:table-cell">{h.accountName}</td>
                  <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-primary">
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
                  <td className="py-2.5 text-right font-mono tabular-nums">
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
              <td className="py-2.5 pr-3" />
              <td className="py-2.5 pr-3 hidden md:table-cell" />
              <td className="py-2.5 pr-3" />
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-primary">
                {formatMoney(data.totalMarketValueCents)}
              </td>
              <td className="py-2.5 text-right font-mono tabular-nums">
                <GainLoss cents={totalGainLoss} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

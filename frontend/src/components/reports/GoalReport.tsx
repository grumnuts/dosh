import { useQuery } from '@tanstack/react-query'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { reportsApi, type GoalSeries } from '../../api/reports'
import { formatMoney } from '../ui/AmountDisplay'

function GoalCard({ series }: { series: GoalSeries }) {
  const allPoints = [
    ...series.history.map((p) => ({ ...p, type: 'history' as const })),
    ...series.projection.map((p) => ({ ...p, type: 'projection' as const })),
  ]

  // Build unified chart data with separate keys for history/projection lines
  const chartData = allPoints.map((p, i) => {
    const isProj = p.type === 'projection'
    const isHandoff = isProj && i > 0 && allPoints[i - 1].type === 'history'
    return {
      month: p.month,
      balance: isProj ? null : p.balance / 100,
      // Overlap by one point so lines connect
      projection: isProj || isHandoff ? p.balance / 100 : null,
    }
  })

  // Fix handoff: the last history point should also appear in projection series
  if (series.history.length > 0 && series.projection.length > 0) {
    const lastHistIdx = series.history.length - 1
    if (chartData[lastHistIdx]) {
      chartData[lastHistIdx].projection = series.history[lastHistIdx].balance / 100
    }
  }

  const projectedEnd = series.projection.length > 0
    ? series.projection[series.projection.length - 1]
    : null
  const reachedGoal = projectedEnd && projectedEnd.balance >= series.goalAmount
  const progress = series.goalAmount > 0
    ? Math.min(100, Math.round(Math.max(0, series.currentBalance) / series.goalAmount * 100))
    : 0

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-primary">{series.name}</h3>
          <p className="text-sm text-secondary mt-0.5">
            {formatMoney(series.currentBalance)} of {formatMoney(series.goalAmount)} goal &nbsp;·&nbsp; {progress}%
          </p>
        </div>
        {series.projection.length > 0 && (
          <div className="text-right shrink-0">
            {reachedGoal ? (
              <p className="text-sm text-accent">Goal reached {projectedEnd!.month}</p>
            ) : (
              <p className="text-sm text-muted">Projected: {projectedEnd!.month}</p>
            )}
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      {chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
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
              tickFormatter={(v) => `$${v}`}
              width={60}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid #374151', borderRadius: 6 }}
              labelStyle={{ color: '#e5e7eb' }}
              formatter={(value: number) => [formatMoney(Math.round(value * 100)), '']}
            />
            <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
            <ReferenceLine
              y={series.goalAmount / 100}
              stroke="#4ade80"
              strokeDasharray="4 4"
              label={{ value: 'Goal', fill: '#4ade80', fontSize: 11, position: 'insideTopRight' }}
            />
            <Line
              type="monotone"
              dataKey="balance"
              name="Balance"
              stroke="#4ade80"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="projection"
              name="Projected"
              stroke="#4ade80"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      {chartData.length === 0 && (
        <p className="text-sm text-muted text-center py-4">No transaction history yet.</p>
      )}
    </div>
  )
}

export function GoalReport() {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'goals'],
    queryFn: reportsApi.goals,
  })

  if (isLoading) return <div className="py-12 text-center text-secondary">Loading...</div>
  if (!data || data.length === 0) {
    return (
      <div className="py-12 text-center text-secondary">
        No savings accounts with goals found. Add a goal amount to a savings account to see projections here.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {data.map((series) => (
        <GoalCard key={series.accountId} series={series} />
      ))}
    </div>
  )
}

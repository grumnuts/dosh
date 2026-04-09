import React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { reportsApi, type GoalSeries } from '../../api/reports'
import { formatMoney } from '../ui/AmountDisplay'

function buildChartData(series: GoalSeries) {
  const allPoints = [
    ...series.history.map((p) => ({ ...p, type: 'history' as const })),
    ...series.projection.map((p) => ({ ...p, type: 'projection' as const })),
  ]

  const chartData = allPoints.map((p, i) => {
    const isProj = p.type === 'projection'
    const isHandoff = isProj && i > 0 && allPoints[i - 1].type === 'history'
    return {
      month: p.month,
      balance: isProj ? null : p.balance / 100,
      projection: isProj || isHandoff ? p.balance / 100 : null,
    }
  })

  // Overlap last history point into projection series so lines connect
  if (series.history.length > 0 && series.projection.length > 0) {
    const lastHistIdx = series.history.length - 1
    if (chartData[lastHistIdx]) {
      chartData[lastHistIdx].projection = series.history[lastHistIdx].balance / 100
    }
  }

  return chartData
}

function weeksUntilEndOfMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number)
  const endOfMonth = new Date(year, month, 0) // last day of that month
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  return Math.max(1, (endOfMonth.getTime() - today.getTime()) / msPerWeek)
}

function GoalCard({ series }: { series: GoalSeries }) {
  const chartData = buildChartData(series)

  const projectedEnd = series.projection.length > 0
    ? series.projection[series.projection.length - 1]
    : null
  const goalAlreadyMet = series.currentBalance >= series.goalAmount
  const projectionHitsGoal = projectedEnd && projectedEnd.balance >= series.goalAmount
  const progress = series.goalAmount > 0
    ? Math.min(100, Math.round(Math.max(0, series.currentBalance) / series.goalAmount * 100))
    : 0

  const weeklyNeeded = (!goalAlreadyMet && series.goalTargetDate)
    ? Math.ceil((series.goalAmount - series.currentBalance) / weeksUntilEndOfMonth(series.goalTargetDate))
    : null

  let statusLabel: React.ReactNode = null
  if (!goalAlreadyMet) {
    if (series.goalTargetDate) {
      const onTrack = projectionHitsGoal && projectedEnd!.month <= series.goalTargetDate
      statusLabel = (
        <>
          <p className={`text-sm ${onTrack ? 'text-accent' : 'text-danger'}`}>{onTrack ? 'On track' : 'Off track'}</p>
          {weeklyNeeded !== null && (
            <p className="text-xs text-muted">{formatMoney(weeklyNeeded)} / week needed</p>
          )}
        </>
      )
    } else if (projectionHitsGoal) {
      statusLabel = <p className="text-sm text-muted">Projected: {projectedEnd!.month}</p>
    } else if (projectedEnd) {
      statusLabel = <p className="text-sm text-muted">Projected: 20+ years</p>
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-primary">{series.name}</h3>
          <p className="text-sm text-secondary mt-0.5">
            {formatMoney(series.currentBalance)} of {formatMoney(series.goalAmount)} goal &nbsp;·&nbsp; {progress}%
          </p>
        </div>
        <div className="text-right shrink-0">
          {goalAlreadyMet ? (
            <p className="text-sm text-accent">Goal reached!</p>
          ) : statusLabel}
        </div>
      </div>

      <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
        <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${progress}%` }} />
      </div>

      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} width={60} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid #374151', borderRadius: 6 }}
              labelStyle={{ color: '#e5e7eb' }}
              formatter={(value) => [formatMoney(Math.round((value as number) * 100)), '']}
            />
            <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
            <Line type="monotone" dataKey="balance" name="Balance" stroke="#4ade80" strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="projection" name="Projected" stroke="#4ade80" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-sm text-muted text-center py-4">No transaction history yet.</p>
      )}
    </div>
  )
}

function DebtCard({ series }: { series: GoalSeries }) {
  const chartData = buildChartData(series)

  const projectedEnd = series.projection.length > 0
    ? series.projection[series.projection.length - 1]
    : null
  const paidOff = series.currentBalance >= 0
  const projectionPayedOff = projectedEnd && projectedEnd.balance >= 0

  // Progress: how much has been paid off relative to peak debt
  const peakDebt = Math.min(series.startingBalance, ...series.history.map((h) => h.balance), series.currentBalance)
  const progress = peakDebt < 0
    ? Math.min(100, Math.round((1 - series.currentBalance / peakDebt) * 100))
    : 100

  let statusLabel: React.ReactNode = null
  if (!paidOff) {
    if (projectionPayedOff) {
      statusLabel = <p className="text-sm text-muted">Projected: {projectedEnd!.month}</p>
    } else if (projectedEnd) {
      statusLabel = <p className="text-sm text-muted">Projected: 20+ years</p>
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-primary">{series.name}</h3>
          <p className="text-sm text-secondary mt-0.5">
            {formatMoney(Math.abs(series.currentBalance))} remaining &nbsp;·&nbsp; {progress}% paid off
          </p>
        </div>
        <div className="text-right shrink-0">
          {paidOff ? (
            <p className="text-sm text-accent">Paid off!</p>
          ) : statusLabel}
        </div>
      </div>

      <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
        <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${progress}%` }} />
      </div>

      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${Math.abs(v)}`} width={60} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid #374151', borderRadius: 6 }}
              labelStyle={{ color: '#e5e7eb' }}
              formatter={(value) => [formatMoney(Math.abs(Math.round((value as number) * 100))), '']}
            />
            <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
            <Line type="monotone" dataKey="balance" name="Balance" stroke="#f87171" strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="projection" name="Projected" stroke="#f87171" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
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

  const savings = data?.filter((s) => s.type === 'savings') ?? []
  const debts = data?.filter((s) => s.type === 'debt') ?? []

  if (savings.length === 0 && debts.length === 0) {
    return (
      <div className="py-12 text-center text-secondary">
        No savings goals or debt accounts found.
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {savings.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">Savings</h2>
          {savings.map((series) => <GoalCard key={series.accountId} series={series} />)}
        </section>
      )}
      {debts.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">Debts</h2>
          {debts.map((series) => <DebtCard key={series.accountId} series={series} />)}
        </section>
      )}
    </div>
  )
}

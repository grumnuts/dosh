import { useQuery } from '@tanstack/react-query'
import { format, parseISO, addDays } from 'date-fns'
import { useWeek } from '../hooks/useWeek'
import { budgetApi } from '../api/budget'
import { accountsApi } from '../api/accounts'
import { BudgetTable } from '../components/budget/BudgetTable'
import { Button } from '../components/ui/Button'

export function BudgetPage() {
  const { weekStart, goNext, goPrev, goToday, isCurrentWeek } = useWeek()

  const { data: budgetData, isLoading, error } = useQuery({
    queryKey: ['budget', weekStart],
    queryFn: () => budgetApi.getWeek(weekStart),
  })

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
  })

  const weekEnd = weekStart
    ? format(addDays(parseISO(weekStart), 6), 'dd MMM')
    : ''
  const weekStartFmt = weekStart
    ? format(parseISO(weekStart), 'dd MMM yyyy')
    : ''

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-primary">Budget</h1>
          <p className="text-sm text-secondary">
            {weekStartFmt} — {weekEnd}
          </p>
        </div>

        {/* Week navigation */}
        <div className="flex items-center gap-2">
          {!isCurrentWeek && (
            <Button variant="outline" size="sm" onClick={goToday}>
              Today
            </Button>
          )}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={goPrev} aria-label="Previous week">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Button>
            <span className="text-xs text-secondary px-2 min-w-[90px] text-center font-mono">
              {weekStart}
            </span>
            <Button variant="ghost" size="sm" onClick={goNext} aria-label="Next week">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="text-center py-16 text-secondary">Loading budget...</div>
      )}

      {error && (
        <div className="card p-6 text-center text-danger">
          Failed to load budget data.
        </div>
      )}

      {budgetData && accounts && (
        <BudgetTable data={budgetData} accounts={accounts} />
      )}
    </div>
  )
}

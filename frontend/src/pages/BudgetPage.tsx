import { useQuery } from '@tanstack/react-query'
import { format, parseISO, addDays, getWeek } from 'date-fns'
import { useWeek } from '../hooks/useWeek'
import { budgetApi } from '../api/budget'
import { accountsApi } from '../api/accounts'
import { settingsApi } from '../api/settings'
import { BudgetTable } from '../components/budget/BudgetTable'
import { Button } from '../components/ui/Button'

export function BudgetPage() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get })
  const weekStartsOn: 0 | 1 = settings?.week_start_day === '1' ? 1 : 0
  const { weekStart, goNext, goPrev, goToday, isCurrentWeek } = useWeek(weekStartsOn)

  const { data: budgetData, isLoading, error } = useQuery({
    queryKey: ['budget', weekStart],
    queryFn: () => budgetApi.getWeek(weekStart),
  })

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
  })

  const parsedStart = weekStart ? parseISO(weekStart) : null
  const parsedEnd = parsedStart ? addDays(parsedStart, 6) : null
  const weekNumber = parsedStart ? getWeek(parsedStart, { weekStartsOn }) : null
  const weekYear = parsedStart ? format(parsedStart, 'yyyy') : ''
  const weekRange = parsedStart && parsedEnd
    ? `${format(parsedStart, 'dd/MM')} - ${format(parsedEnd, 'dd/MM')}`
    : ''

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex flex-row items-center gap-3">
        <h1 className="text-xl font-bold text-primary flex-1">Budget</h1>

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
            <div className="text-center px-2 min-w-[90px]">
              <p className="text-xs font-semibold text-primary leading-tight">Week {weekNumber}</p>
              <p className="text-xs text-muted leading-tight">{weekYear}</p>
              <p className="text-xs text-secondary leading-tight">{weekRange}</p>
            </div>
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

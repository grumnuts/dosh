import { useState, useCallback, useEffect } from 'react'
import { format, startOfWeek, addWeeks, subWeeks, parseISO } from 'date-fns'

function getWeekStartStr(date: Date, weekStartsOn: 0 | 1): string {
  return format(startOfWeek(date, { weekStartsOn }), 'yyyy-MM-dd')
}

export function useWeek(weekStartsOn: 0 | 1 = 0) {
  const [weekStart, setWeekStart] = useState<string>(() =>
    getWeekStartStr(new Date(), weekStartsOn),
  )

  // Reset to current week when weekStartsOn changes
  useEffect(() => {
    setWeekStart(getWeekStartStr(new Date(), weekStartsOn))
  }, [weekStartsOn])

  const goNext = useCallback(() => {
    setWeekStart((prev) => getWeekStartStr(addWeeks(parseISO(prev), 1), weekStartsOn))
  }, [weekStartsOn])

  const goPrev = useCallback(() => {
    setWeekStart((prev) => getWeekStartStr(subWeeks(parseISO(prev), 1), weekStartsOn))
  }, [weekStartsOn])

  const goToday = useCallback(() => {
    setWeekStart(getWeekStartStr(new Date(), weekStartsOn))
  }, [weekStartsOn])

  const isCurrentWeek = weekStart === getWeekStartStr(new Date(), weekStartsOn)

  return { weekStart, goNext, goPrev, goToday, isCurrentWeek }
}

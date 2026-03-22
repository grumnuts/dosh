import { useState, useCallback } from 'react'
import { format, startOfWeek, addWeeks, subWeeks, parseISO } from 'date-fns'

function getSundayStr(date: Date): string {
  const sunday = startOfWeek(date, { weekStartsOn: 0 })
  return format(sunday, 'yyyy-MM-dd')
}

export function useWeek() {
  const [weekStart, setWeekStart] = useState<string>(() => getSundayStr(new Date()))

  const goNext = useCallback(() => {
    setWeekStart((prev) => getSundayStr(addWeeks(parseISO(prev), 1)))
  }, [])

  const goPrev = useCallback(() => {
    setWeekStart((prev) => getSundayStr(subWeeks(parseISO(prev), 1)))
  }, [])

  const goToday = useCallback(() => {
    setWeekStart(getSundayStr(new Date()))
  }, [])

  const isCurrentWeek = weekStart === getSundayStr(new Date())

  return { weekStart, goNext, goPrev, goToday, isCurrentWeek }
}

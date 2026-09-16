import { useEffect, useMemo, useState } from 'react'
import { addDays, addMonths, endOfMonth, format, parseISO, startOfMonth } from 'date-fns'

export type TimelineRange = 'month' | 'year' | '3year' | '5year' | 'all'

const RANGE_LABELS: Array<{ value: TimelineRange; label: string }> = [
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: '3year', label: '3 Year' },
  { value: '5year', label: '5 Year' },
  { value: 'all', label: 'All' },
]

export function useTimelineWindow(months: string[]) {
  const [range, setRange] = useState<TimelineRange>('all')
  const [anchor, setAnchor] = useState(months[months.length - 1] ?? format(new Date(), 'yyyy-MM-dd'))

  useEffect(() => {
    if (months.length > 0) setAnchor(months[months.length - 1])
  }, [months.length, months[months.length - 1]])

  const windowedMonths = useMemo(() => {
    const end = parseISO(anchor)
    if (range === 'all') return months
    if (range === 'month') {
      const start = startOfMonth(end)
      return Array.from({ length: endOfMonth(end).getDate() }, (_, i) => format(addDays(start, i), 'yyyy-MM-dd'))
    }
    if (range === 'year') return Array.from({ length: 12 }, (_, i) => format(new Date(end.getFullYear(), i, 1), 'yyyy-MM-dd'))
    const yearStart = range === '3year' ? end.getFullYear() - 2 : end.getFullYear() - 4
    const step = range === '3year' ? 3 : 6
    return Array.from({ length: range === '3year' ? 12 : 10 }, (_, i) => format(new Date(yearStart, i * step, 1), 'yyyy-MM-dd'))
  }, [anchor, months, range])

  const move = (direction: -1 | 1) => {
    if (range === 'all') return
    const date = parseISO(anchor)
    setAnchor(format(range === 'month' ? addMonths(date, direction) : new Date(date.getFullYear() + direction * (range === 'year' ? 1 : range === '3year' ? 3 : 5), date.getMonth(), 1), 'yyyy-MM-dd'))
  }

  return {
    range,
    setRange: (next: TimelineRange) => {
      setRange(next)
      setAnchor(months[months.length - 1] ?? format(new Date(), 'yyyy-MM-dd'))
    },
    windowedMonths,
    canPrevious: range !== 'all',
    canNext: range !== 'all',
    previous: () => move(-1),
    next: () => move(1),
  }
}

export function resampleTimeline<T extends Record<string, number | string | null>>(data: T[], buckets: string[]): T[] {
  return buckets.map((bucket) => {
    const source = [...data].reverse().find((point) => String(point.month) <= bucket) ?? data[0]
    return source ? { ...source, month: bucket } : ({ month: bucket } as unknown as T)
  })
}

export function formatTimelineLabel(value: string, dateFormat: string): string {
  void dateFormat
  return value.length === 10 ? format(parseISO(value), 'dd MMM') : value
}

export function TimelineControl({
  range,
  setRange,
  canPrevious,
  canNext,
  previous,
  next,
}: {
  range: TimelineRange
  setRange: (range: TimelineRange) => void
  canPrevious: boolean
  canNext: boolean
  previous: () => void
  next: () => void
}) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={previous} disabled={!canPrevious} className="p-1 text-secondary hover:text-primary disabled:opacity-30" aria-label="Previous period">‹</button>
      <div className="flex rounded-md border border-border overflow-hidden">
        {RANGE_LABELS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setRange(item.value)}
            className={`px-2 py-1 text-[11px] transition-colors ${range === item.value ? 'bg-accent text-black font-medium' : 'text-secondary hover:bg-surface-2'}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <button type="button" onClick={next} disabled={!canNext} className="p-1 text-secondary hover:text-primary disabled:opacity-30" aria-label="Next period">›</button>
    </div>
  )
}
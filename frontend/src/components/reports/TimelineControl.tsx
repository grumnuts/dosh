import { useEffect, useMemo, useState } from 'react'

export type TimelineRange = 'month' | 'year' | '3year' | '5year' | 'all'

const RANGE_MONTHS: Record<TimelineRange, number | null> = {
  month: 1,
  year: 12,
  '3year': 36,
  '5year': 60,
  all: null,
}

const RANGE_LABELS: Array<{ value: TimelineRange; label: string }> = [
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: '3year', label: '3 Year' },
  { value: '5year', label: '5 Year' },
  { value: 'all', label: 'All' },
]

export function useTimelineWindow(months: string[]) {
  const [range, setRange] = useState<TimelineRange>('all')
  const [endIndex, setEndIndex] = useState(Math.max(0, months.length - 1))

  useEffect(() => {
    setEndIndex(Math.max(0, months.length - 1))
  }, [months.length])

  const windowedMonths = useMemo(() => {
    if (months.length === 0) return []
    const maxIndex = months.length - 1
    const end = Math.min(endIndex, maxIndex)
    const count = RANGE_MONTHS[range]
    if (count === null) return months
    return months.slice(Math.max(0, end - count + 1), end + 1)
  }, [endIndex, months, range])

  const move = (direction: -1 | 1) => {
    const count = RANGE_MONTHS[range]
    if (count === null) return
    setEndIndex((current) => Math.max(0, Math.min(months.length - 1, current + direction * count)))
  }

  return {
    range,
    setRange: (next: TimelineRange) => {
      setRange(next)
      setEndIndex(Math.max(0, months.length - 1))
    },
    windowedMonths,
    canPrevious: range !== 'all' && endIndex >= (RANGE_MONTHS[range] ?? 0),
    canNext: range !== 'all' && endIndex < months.length - 1,
    previous: () => move(-1),
    next: () => move(1),
  }
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
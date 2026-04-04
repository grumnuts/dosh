/**
 * Date utilities for Dosh budget calculations.
 * All dates are stored as ISO strings (YYYY-MM-DD).
 * Week boundaries depend on the weekStartsOn setting (0 = Sunday, 1 = Monday).
 */

/** Returns YYYY-MM-DD string for a Date (UTC-based — use for dates created via parseDate) */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Returns today's date as YYYY-MM-DD in local (server) time */
export function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Parse a YYYY-MM-DD string into a UTC midnight Date */
export function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00Z')
}

/** Returns the week start (Sunday or Monday) for a given date */
export function getWeekStart(date: Date, weekStartsOn: 0 | 1 = 0): Date {
  const d = new Date(date)
  const utcDay = d.getUTCDay() // 0 = Sunday, 1 = Monday, ...
  // How many days to subtract to reach the week start
  const offset = weekStartsOn === 1
    ? (utcDay === 0 ? 6 : utcDay - 1) // Monday start: Sun wraps to -6
    : utcDay                           // Sunday start: subtract day index
  d.setUTCDate(d.getUTCDate() - offset)
  return d
}

/** Returns the week end (6 days after week start) for a given date */
export function getWeekEnd(date: Date, weekStartsOn: 0 | 1 = 0): Date {
  const start = getWeekStart(date, weekStartsOn)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  return end
}

/** Returns the current week's start date as YYYY-MM-DD in local (server) time */
export function currentWeekStart(weekStartsOn: 0 | 1 = 0): string {
  const now = new Date()
  // Build a UTC-midnight date from local components so getWeekStart's UTC operations
  // reflect the correct local day rather than the UTC day (which can be yesterday in UTC+N).
  const todayUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  return toDateString(getWeekStart(todayUtc, weekStartsOn))
}

/** Returns period boundaries (inclusive) for a category's period, given a week start date string */
export function getPeriodBoundaries(
  weekStartStr: string,
  period: string,
  weekStartsOn: 0 | 1 = 0,
): { start: string; end: string } {
  const weekStart = parseDate(weekStartStr)

  switch (period) {
    case 'weekly': {
      return {
        start: weekStartStr,
        end: toDateString(getWeekEnd(weekStart, weekStartsOn)),
      }
    }

    case 'fortnightly': {
      // Reference date anchored to the correct week start day
      const REF = parseDate(weekStartsOn === 1 ? '2025-01-06' : '2025-01-05')
      const msPerDay = 86400000
      const daysSinceRef = Math.round((weekStart.getTime() - REF.getTime()) / msPerDay)
      const weeksSinceRef = Math.floor(daysSinceRef / 7)
      const fortnightIndex = Math.floor(weeksSinceRef / 2)
      const start = new Date(REF.getTime() + fortnightIndex * 14 * msPerDay)
      const end = new Date(start.getTime() + 13 * msPerDay)
      return { start: toDateString(start), end: toDateString(end) }
    }

    case 'monthly': {
      const year = weekStart.getUTCFullYear()
      const month = weekStart.getUTCMonth()
      const start = new Date(Date.UTC(year, month, 1))
      const end = new Date(Date.UTC(year, month + 1, 0))
      return { start: toDateString(start), end: toDateString(end) }
    }

    case 'quarterly': {
      const year = weekStart.getUTCFullYear()
      const month = weekStart.getUTCMonth()
      const quarterStartMonth = Math.floor(month / 3) * 3
      const start = new Date(Date.UTC(year, quarterStartMonth, 1))
      const end = new Date(Date.UTC(year, quarterStartMonth + 3, 0))
      return { start: toDateString(start), end: toDateString(end) }
    }

    case 'annually': {
      const year = weekStart.getUTCFullYear()
      return {
        start: `${year}-01-01`,
        end: `${year}-12-31`,
      }
    }

    default:
      throw new Error(`Unknown period: ${period}`)
  }
}

/**
 * Calculate the weekly equivalent amount (in cents) for a given period.
 * Fractional cents are always rounded up (ceiling) so the weekly figure
 * never underestimates what needs to be covered.
 * weekly:      as-is
 * fortnightly: ⌈÷ 2⌉
 * monthly:     ⌈× 12 ÷ 52⌉
 * quarterly:   ⌈× 4 ÷ 52⌉
 * annually:    ⌈÷ 52⌉
 */
export function weeklyEquivalent(amountCents: number, period: string): number {
  switch (period) {
    case 'weekly':
      return amountCents
    case 'fortnightly':
      return Math.ceil(amountCents / 2)
    case 'monthly':
      return Math.ceil((amountCents * 12) / 52)
    case 'quarterly':
      return Math.ceil((amountCents * 4) / 52)
    case 'annually':
      return Math.ceil(amountCents / 52)
    default:
      return amountCents
  }
}

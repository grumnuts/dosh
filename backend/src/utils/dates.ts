/**
 * Date utilities for Dosh budget calculations.
 * All dates are stored as ISO strings (YYYY-MM-DD).
 * Budget periods are Sunday–Saturday.
 */

/** Returns YYYY-MM-DD string for a Date */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Parse a YYYY-MM-DD string into a UTC midnight Date */
export function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00Z')
}

/** Returns the Sunday (week start) for a given date */
export function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getUTCDay() // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - day)
  return d
}

/** Returns the Saturday (week end) for a given date */
export function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  return end
}

/** Returns the current week's Sunday as YYYY-MM-DD */
export function currentWeekStart(): string {
  return toDateString(getWeekStart(new Date()))
}

/** Returns period boundaries (inclusive) for a category's period, given a week start date string */
export function getPeriodBoundaries(
  weekStartStr: string,
  period: string,
): { start: string; end: string } {
  const weekStart = parseDate(weekStartStr)

  switch (period) {
    case 'weekly': {
      return {
        start: weekStartStr,
        end: toDateString(getWeekEnd(weekStart)),
      }
    }

    case 'fortnightly': {
      // Use 2025-01-05 (a Sunday) as fixed reference to align fortnights consistently
      const REF = parseDate('2025-01-05')
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
 * weekly:      as-is
 * fortnightly: ÷ 2
 * monthly:     × 12 ÷ 52
 * quarterly:   × 4 ÷ 52
 * annually:    ÷ 52
 */
export function weeklyEquivalent(amountCents: number, period: string): number {
  switch (period) {
    case 'weekly':
      return amountCents
    case 'fortnightly':
      return Math.round(amountCents / 2)
    case 'monthly':
      return Math.round((amountCents * 12) / 52)
    case 'quarterly':
      return Math.round((amountCents * 4) / 52)
    case 'annually':
      return Math.round(amountCents / 52)
    default:
      return amountCents
  }
}

/** Whether a period carries forward (quarterly/annually) or resets each short period */
export function isRollingPeriod(period: string): boolean {
  return period === 'quarterly' || period === 'annually'
}

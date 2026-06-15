import { format, parseISO } from 'date-fns'

export const DATE_FORMAT_OPTIONS = [
  'DD/MM/YY',
  'DD/MM/YYYY',
  'MM/DD/YY',
  'MM/DD/YYYY',
  'YY/MM/DD',
  'YYYY/MM/DD',
  'YY/DD/MM',
  'YYYY/DD/MM',
] as const

export type DateFormatOption = typeof DATE_FORMAT_OPTIONS[number]

export const DEFAULT_DATE_FORMAT: DateFormatOption = 'DD/MM/YYYY'

const DATE_FNS_FORMATS: Record<DateFormatOption, string> = {
  'DD/MM/YY': 'dd/MM/yy',
  'DD/MM/YYYY': 'dd/MM/yyyy',
  'MM/DD/YY': 'MM/dd/yy',
  'MM/DD/YYYY': 'MM/dd/yyyy',
  'YY/MM/DD': 'yy/MM/dd',
  'YYYY/MM/DD': 'yyyy/MM/dd',
  'YY/DD/MM': 'yy/dd/MM',
  'YYYY/DD/MM': 'yyyy/dd/MM',
}

const MONTH_FORMATS: Record<DateFormatOption, string> = {
  'DD/MM/YY': 'MM/yy',
  'DD/MM/YYYY': 'MM/yyyy',
  'MM/DD/YY': 'MM/yy',
  'MM/DD/YYYY': 'MM/yyyy',
  'YY/MM/DD': 'yy/MM',
  'YYYY/MM/DD': 'yyyy/MM',
  'YY/DD/MM': 'yy/MM',
  'YYYY/DD/MM': 'yyyy/MM',
}

export function normalizeDateFormat(value: string | undefined | null): DateFormatOption {
  return DATE_FORMAT_OPTIONS.includes(value as DateFormatOption)
    ? value as DateFormatOption
    : DEFAULT_DATE_FORMAT
}

export function parseAppDate(value: string | Date): Date {
  if (value instanceof Date) return value
  return parseISO(value)
}

export function formatAppDate(value: string | Date, dateFormat?: string | null): string {
  const normalized = normalizeDateFormat(dateFormat)
  return format(parseAppDate(value), DATE_FNS_FORMATS[normalized])
}

export function formatAppDateTime(value: string | Date, dateFormat?: string | null): string {
  return `${formatAppDate(value, dateFormat)} ${format(parseAppDate(value), 'HH:mm')}`
}

export function formatAppMonth(value: string | Date, dateFormat?: string | null): string {
  const normalized = normalizeDateFormat(dateFormat)
  const date = typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)
    ? parseISO(`${value}-01`)
    : parseAppDate(value)
  return format(date, MONTH_FORMATS[normalized])
}

export function formatAppDateRange(start: string | Date, end: string | Date, dateFormat?: string | null): string {
  return `${formatAppDate(start, dateFormat)} - ${formatAppDate(end, dateFormat)}`
}

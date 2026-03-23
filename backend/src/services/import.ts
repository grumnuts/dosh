import Papa from 'papaparse'
import { parseCents } from '../utils/money'

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'

export interface ColumnMapping {
  date: number
  payee?: number
  description?: number
  // Either a single amount column or separate debit/credit columns
  amount?: number
  debit?: number
  credit?: number
}

export interface ParsedRow {
  date: string // YYYY-MM-DD
  payee: string
  description: string
  amount: number // cents, negative=debit, positive=credit
  raw: string[] // original row data
}

export interface ImportPreviewRow extends ParsedRow {
  isDuplicate: boolean
  existingId?: number
  skip: boolean
}

function parseDate(raw: string, format: DateFormat): string | null {
  const s = raw.trim()
  if (!s) return null

  let day: number, month: number, year: number

  if (format === 'DD/MM/YYYY') {
    const parts = s.split('/')
    if (parts.length !== 3) return null
    day = parseInt(parts[0], 10)
    month = parseInt(parts[1], 10)
    year = parseInt(parts[2], 10)
  } else if (format === 'MM/DD/YYYY') {
    const parts = s.split('/')
    if (parts.length !== 3) return null
    month = parseInt(parts[0], 10)
    day = parseInt(parts[1], 10)
    year = parseInt(parts[2], 10)
  } else {
    // YYYY-MM-DD
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
  }

  if (year < 100) year += 2000
  const padded = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const d = new Date(padded + 'T00:00:00Z')
  if (isNaN(d.getTime())) return null
  return padded
}

export function parseCSV(
  csvText: string,
  hasHeader: boolean,
): string[][] {
  const result = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
    header: false,
  })
  const rows = result.data as string[][]
  return hasHeader ? rows.slice(1) : rows
}

export function mapRows(
  rows: string[][],
  mapping: ColumnMapping,
  dateFormat: DateFormat,
): ParsedRow[] {
  const parsed: ParsedRow[] = []

  for (const row of rows) {
    const rawDate = row[mapping.date]?.trim() ?? ''
    const date = parseDate(rawDate, dateFormat)
    if (!date) continue

    let amountCents = 0
    if (mapping.amount !== undefined && mapping.amount >= 0) {
      amountCents = parseCents(row[mapping.amount] ?? '0')
    } else if (mapping.debit !== undefined || mapping.credit !== undefined) {
      const debit = mapping.debit !== undefined ? parseCents(row[mapping.debit] ?? '0') : 0
      const credit = mapping.credit !== undefined ? parseCents(row[mapping.credit] ?? '0') : 0
      // Debits are outflows (negative), credits are inflows (positive)
      amountCents = credit - debit
    }

    parsed.push({
      date,
      payee: mapping.payee !== undefined ? (row[mapping.payee]?.trim() ?? '') : '',
      description: mapping.description !== undefined ? (row[mapping.description]?.trim() ?? '') : '',
      amount: amountCents,
      raw: row,
    })
  }

  return parsed
}

/**
 * Check each row against existing transactions for duplicates.
 * Matches on date + amount. Fetches all candidates in one query.
 */
export function checkDuplicates(
  rows: ParsedRow[],
  db: import('node:sqlite').DatabaseSync,
  accountId: number,
): ImportPreviewRow[] {
  if (rows.length === 0) return []

  const minDate = rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date)
  const maxDate = rows.reduce((max, r) => (r.date > max ? r.date : max), rows[0].date)

  const existing = db
    .prepare(
      `SELECT id, date, amount FROM transactions
       WHERE account_id = ? AND date >= ? AND date <= ?`,
    )
    .all(accountId, minDate, maxDate) as { id: number; date: string; amount: number }[]

  // "date:amount" -> first matching id
  const lookup = new Map<string, number>()
  for (const tx of existing) {
    const key = `${tx.date}:${tx.amount}`
    if (!lookup.has(key)) lookup.set(key, tx.id)
  }

  return rows.map((row) => {
    const existingId = lookup.get(`${row.date}:${row.amount}`)
    return {
      ...row,
      isDuplicate: existingId !== undefined,
      existingId,
      skip: existingId !== undefined,
    }
  })
}

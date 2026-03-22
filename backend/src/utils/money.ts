/** Parse a dollar string (e.g. "1,234.56" or "-45.00") to integer cents */
export function parseCents(value: string | number): number {
  if (typeof value === 'number') return Math.round(value * 100)
  const cleaned = value.replace(/[$,\s]/g, '')
  const num = parseFloat(cleaned)
  if (isNaN(num)) return 0
  return Math.round(num * 100)
}

/** Format integer cents to display string (e.g. 150025 → "1,500.25") */
export function formatCents(cents: number): string {
  const abs = Math.abs(cents)
  const dollars = (abs / 100).toFixed(2)
  const parts = dollars.split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const formatted = parts.join('.')
  return cents < 0 ? `-${formatted}` : formatted
}

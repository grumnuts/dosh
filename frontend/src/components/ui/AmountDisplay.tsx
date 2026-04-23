import type React from 'react'

/** Format cents to a dollar string with commas */
export function formatMoney(cents: number): string {
  const abs = Math.abs(cents)
  const dollars = (abs / 100).toFixed(2)
  const [int, dec] = dollars.split('.')
  const formatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${cents < 0 ? '-' : ''}$${formatted}.${dec}`
}

interface AmountProps {
  cents: number
  type?: 'transaction' | 'transfer' | 'cover' | 'sweep' | 'auto'
  className?: string
  colored?: boolean
}

/**
 * Displays a monetary amount with appropriate colour:
 * - positive transaction → accent green
 * - negative transaction → danger red
 * - transfer/cover → muted grey
 */
export function Amount({ cents, type = 'auto', className = '', colored = true }: AmountProps) {
  let colorClass = ''
  let glowStyle: React.CSSProperties | undefined
  if (colored) {
    if (type === 'transfer' || type === 'cover' || type === 'sweep') {
      colorClass = 'text-transfer'
    } else if (cents >= 0) {
      colorClass = 'text-accent'
      glowStyle = { textShadow: '0 0 10px rgba(74,222,128,0.4)' }
    } else {
      colorClass = 'text-danger'
      glowStyle = { textShadow: '0 0 10px rgba(248,113,113,0.35)' }
    }
  }
  return (
    <span className={`font-mono tabular-nums ${colorClass} ${className}`} style={glowStyle}>
      {formatMoney(cents)}
    </span>
  )
}

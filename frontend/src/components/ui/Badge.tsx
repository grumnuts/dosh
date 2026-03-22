interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'danger' | 'warn' | 'success' | 'muted'
  className?: string
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  const variants = {
    default: 'bg-surface-3 text-secondary',
    danger: 'bg-danger-muted text-danger',
    warn: 'bg-amber-900/50 text-warn',
    success: 'bg-accent-muted text-accent',
    muted: 'bg-surface-2 text-muted',
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  )
}

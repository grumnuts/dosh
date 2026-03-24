import { SpendingReport } from './SpendingReport'
import { InVsOutReport } from './InVsOutReport'
import { NetWorthReport } from './NetWorthReport'

interface Props {
  year: string
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="pt-4">
      <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide border-b border-border pb-2">
        {title}
      </h2>
    </div>
  )
}

export function CashflowReport({ year }: Props) {
  return (
    <div className="space-y-4">
      <SectionHeader title="Spending by Category" />
      <SpendingReport year={year} />

      <SectionHeader title="In vs Out" />
      <InVsOutReport year={year} />

      <SectionHeader title="Net Worth" />
      <NetWorthReport section="networth" />

      <SectionHeader title="Account Balances" />
      <NetWorthReport section="balances" />
    </div>
  )
}

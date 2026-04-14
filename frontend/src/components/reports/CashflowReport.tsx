import { useLocalStorageBool } from '../../hooks/useLocalStorageBool'
import { SpendingReport } from './SpendingReport'
import { IncomeReport } from './IncomeReport'
import { InVsOutReport } from './InVsOutReport'
import { OverspendReport } from './OverspendReport'
import { PayeeReport } from './PayeeReport'

interface Props {
  year: string
}

function CollapsibleSection({ title, storageKey, children }: { title: string; storageKey: string; children: React.ReactNode }) {
  const [open, setOpen] = useLocalStorageBool(storageKey, true)
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between pt-4 pb-2 border-b border-border group"
      >
        <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">{title}</h2>
        <svg className={`w-4 h-4 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  )
}

export function CashflowReport({ year }: Props) {
  return (
    <div className="space-y-2">
      <CollapsibleSection title="Spending by Category" storageKey="dosh:report-open:cashflow-spending">
        <SpendingReport year={year} />
      </CollapsibleSection>

      <CollapsibleSection title="Overspend" storageKey="dosh:report-open:cashflow-overspend">
        <OverspendReport year={year} />
      </CollapsibleSection>

      <CollapsibleSection title="Income by Category" storageKey="dosh:report-open:cashflow-income">
        <IncomeReport year={year} />
      </CollapsibleSection>

      <CollapsibleSection title="In vs Out" storageKey="dosh:report-open:cashflow-invsout">
        <InVsOutReport year={year} />
      </CollapsibleSection>

      <CollapsibleSection title="Payees" storageKey="dosh:report-open:cashflow-payees">
        <PayeeReport year={year} />
      </CollapsibleSection>
    </div>
  )
}

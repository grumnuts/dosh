import { useLocalStorageBool } from '../../hooks/useLocalStorageBool'
import { NetWorthReport } from './NetWorthReport'
import { GoalReport } from './GoalReport'

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

export function PortfolioReport() {
  return (
    <div className="space-y-2">
      <CollapsibleSection title="Net Worth" storageKey="dosh:report-open:portfolio-networth">
        <NetWorthReport section="networth" />
      </CollapsibleSection>

      <CollapsibleSection title="Account Balances" storageKey="dosh:report-open:portfolio-balances">
        <NetWorthReport section="balances" />
      </CollapsibleSection>

      <CollapsibleSection title="Goals" storageKey="dosh:report-open:portfolio-goals">
        <GoalReport />
      </CollapsibleSection>
    </div>
  )
}

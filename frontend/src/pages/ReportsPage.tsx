import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsApi } from '../api/reports'
import { CashflowReport } from '../components/reports/CashflowReport'
import { OverspendReport } from '../components/reports/OverspendReport'
import { PayeeReport } from '../components/reports/PayeeReport'
import { GoalReport } from '../components/reports/GoalReport'
import { NetWorthReport } from '../components/reports/NetWorthReport'
import { InvestmentsReport } from '../components/reports/InvestmentsReport'
import { Select } from '../components/ui/Input'
import { useLocalStorageBool } from '../hooks/useLocalStorageBool'

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

type Tab = 'cashflow' | 'overspend' | 'payees' | 'goals' | 'portfolio'

const TABS: { id: Tab; label: string }[] = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'cashflow', label: 'Cashflow' },
  { id: 'overspend', label: 'Overspend' },
  { id: 'payees', label: 'Payees' },
  { id: 'goals', label: 'Goals' },
]

const YEAR_TABS: Tab[] = ['cashflow', 'overspend', 'payees']

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('portfolio')
  const currentYear = new Date().getFullYear().toString()
  const [year, setYear] = useState(currentYear)

  const { data: years } = useQuery({
    queryKey: ['reports', 'years'],
    queryFn: reportsApi.years,
  })

  const yearOptions = years && years.length > 0 ? years : [currentYear]
  const showYearSelector = YEAR_TABS.includes(tab)

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5 md:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-primary">Reports</h1>
        {showYearSelector && (
          <div className="w-32">
            <Select value={year} onChange={(e) => setYear(e.target.value)}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 py-2 text-sm font-medium transition-colors border-b-2 -mb-px text-center ${
              tab === id
                ? 'border-accent text-accent'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'portfolio' && (
        <div className="space-y-2">
          <CollapsibleSection title="Investments" storageKey="dosh:report-open:portfolio-investments">
            <InvestmentsReport />
          </CollapsibleSection>
          <CollapsibleSection title="Net Worth" storageKey="dosh:report-open:portfolio-networth">
            <NetWorthReport section="networth" />
          </CollapsibleSection>
          <CollapsibleSection title="Account Balances" storageKey="dosh:report-open:portfolio-balances">
            <NetWorthReport section="balances" />
          </CollapsibleSection>
        </div>
      )}
      {tab === 'cashflow' && <CashflowReport year={year} />}
      {tab === 'overspend' && <OverspendReport year={year} />}
      {tab === 'payees' && <PayeeReport year={year} />}
      {tab === 'goals' && <GoalReport />}
    </div>
  )
}

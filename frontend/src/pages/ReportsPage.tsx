import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsApi } from '../api/reports'
import { SpendingReport } from '../components/reports/SpendingReport'
import { OverspendReport } from '../components/reports/OverspendReport'
import { PayeeReport } from '../components/reports/PayeeReport'
import { GoalReport } from '../components/reports/GoalReport'
import { InVsOutReport } from '../components/reports/InVsOutReport'
import { NetWorthReport } from '../components/reports/NetWorthReport'
import { Select } from '../components/ui/Input'

type Tab = 'cashflow' | 'invsout' | 'overspend' | 'payees' | 'goals' | 'networth'

const TABS: { id: Tab; label: string }[] = [
  { id: 'cashflow', label: 'Cashflow' },
  { id: 'invsout', label: 'In vs Out' },
  { id: 'overspend', label: 'Overspend' },
  { id: 'payees', label: 'Payees' },
  { id: 'goals', label: 'Goals' },
  { id: 'networth', label: 'Net Worth' },
]

const YEAR_TABS: Tab[] = ['cashflow', 'invsout', 'overspend', 'payees']

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('cashflow')
  const currentYear = new Date().getFullYear().toString()
  const [year, setYear] = useState(currentYear)

  const { data: years } = useQuery({
    queryKey: ['reports', 'years'],
    queryFn: reportsApi.years,
  })

  const yearOptions = years && years.length > 0 ? years : [currentYear]
  const showYearSelector = YEAR_TABS.includes(tab)

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
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
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
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
      {tab === 'cashflow' && <SpendingReport year={year} />}
      {tab === 'invsout' && <InVsOutReport year={year} />}
      {tab === 'overspend' && <OverspendReport year={year} />}
      {tab === 'payees' && <PayeeReport year={year} />}
      {tab === 'goals' && <GoalReport />}
      {tab === 'networth' && <NetWorthReport />}
    </div>
  )
}

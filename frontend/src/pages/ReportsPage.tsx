import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsApi } from '../api/reports'
import { CashflowReport } from '../components/reports/CashflowReport'
import { PortfolioReport } from '../components/reports/PortfolioReport'
import { Select } from '../components/ui/Input'

type Tab = 'portfolio' | 'cashflow'

const TABS: { id: Tab; label: string }[] = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'cashflow', label: 'Cashflow' },
]

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('portfolio')
  const currentYear = new Date().getFullYear().toString()
  const [year, setYear] = useState(currentYear)

  const { data: years } = useQuery({
    queryKey: ['reports', 'years'],
    queryFn: reportsApi.years,
  })

  const yearOptions = years && years.length > 0 ? years : [currentYear]

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5 md:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-primary">Reports</h1>
        {tab === 'cashflow' && (
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
      {tab === 'cashflow' && <CashflowReport year={year} />}
      {tab === 'portfolio' && <PortfolioReport />}
    </div>
  )
}

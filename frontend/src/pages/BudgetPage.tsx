import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO, addDays, getWeek } from 'date-fns'
import { useWeek } from '../hooks/useWeek'
import { budgetApi } from '../api/budget'
import { accountsApi } from '../api/accounts'
import { settingsApi } from '../api/settings'
import { BudgetTable } from '../components/budget/BudgetTable'
import { Button } from '../components/ui/Button'
import { GroupModal } from '../components/budget/GroupModal'
import { CategoryModal } from '../components/budget/CategoryModal'
import { Modal } from '../components/ui/Modal'
import { useSwipe } from '../hooks/useSwipe'

export function BudgetPage() {
  const [fabOpen, setFabOpen] = useState(false)
  const [addGroupOpen, setAddGroupOpen] = useState(false)
  const [groupPickerOpen, setGroupPickerOpen] = useState(false)
  const [addCatState, setAddCatState] = useState<{ groupId: number; groupName: string } | null>(null)

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get })
  const weekStartsOn: 0 | 1 = settings?.week_start_day === '1' ? 1 : 0
  const { weekStart, goNext, goPrev, goToday, isCurrentWeek } = useWeek(weekStartsOn)

  const { data: budgetData, isLoading, error } = useQuery({
    queryKey: ['budget', weekStart],
    queryFn: () => budgetApi.getWeek(weekStart),
  })

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  })

  const parsedStart = weekStart ? parseISO(weekStart) : null
  const parsedEnd = parsedStart ? addDays(parsedStart, 6) : null
  const weekNumber = parsedStart ? getWeek(parsedStart, { weekStartsOn }) : null
  const weekYear = parsedStart ? format(parsedStart, 'yyyy') : ''
  const weekRange = parsedStart && parsedEnd
    ? `${format(parsedStart, 'dd/MM')} - ${format(parsedEnd, 'dd/MM')}`
    : ''

  const weekNav = (
    <div className="flex items-center gap-2">
      {/* Desktop: keep Today button */}
      {!isCurrentWeek && (
        <Button variant="outline" size="sm" onClick={goToday} className="hidden md:inline-flex">
          Today
        </Button>
      )}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={goPrev} aria-label="Previous week">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Button>
        <button
          className={`text-center px-2 min-w-[90px] rounded-lg py-1 transition-colors ${!isCurrentWeek ? 'cursor-pointer hover:bg-surface-2' : 'cursor-default'}`}
          onClick={!isCurrentWeek ? goToday : undefined}
          aria-label={!isCurrentWeek ? 'Go to current week' : undefined}
        >
          <p className={`text-sm font-semibold leading-tight ${isCurrentWeek ? 'text-accent' : 'text-primary'}`}>Week {weekNumber}</p>
          <p className="text-xs text-muted leading-tight hidden md:block">{weekYear}</p>
          <p className="text-xs text-secondary leading-tight">{weekRange}</p>
        </button>
        <Button variant="ghost" size="sm" onClick={goNext} aria-label="Next week">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Button>
      </div>
    </div>
  )

  const expenseGroups = budgetData?.groups ?? []
  const swipe = useSwipe(goNext, goPrev)

  return (
    <>
      {/* Mobile FAB */}
      <div className="md:hidden">
        {/* Backdrop */}
        {fabOpen && (
          <div className="fixed inset-0 z-30 bg-black/50" onClick={() => setFabOpen(false)} />
        )}

        {/* Speed dial options */}
        <div className={`fixed bottom-40 right-4 z-40 flex flex-col items-end gap-3 ${fabOpen ? '' : 'pointer-events-none'}`}>
          {[
            { label: 'Add Group', action: () => { setFabOpen(false); setAddGroupOpen(true) }, path: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
            { label: 'Add Category', action: () => { setFabOpen(false); setGroupPickerOpen(true) }, path: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2z' },
          ].map(({ label, action, path }, i, arr) => (
            <button
              key={label}
              className={`flex items-center gap-2 transition-all duration-150 ${fabOpen ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-20 scale-75'}`}
              style={{ transitionDelay: `${(fabOpen ? (arr.length - 1 - i) : i) * 35}ms` }}
              onClick={action}
            >
              <span className="bg-surface-2 text-primary text-sm px-3 py-1.5 rounded-lg shadow">{label}</span>
              <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center shadow mx-1">
                <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} />
                </svg>
              </div>
            </button>
          ))}
        </div>

        {/* FAB */}
        <button
          className="fixed bottom-24 right-4 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-accent to-accent-dim text-white flex items-center justify-center transition-transform shadow-[0_4px_14px_rgba(74,222,128,0.4)]"
          style={{ transform: fabOpen ? 'rotate(45deg)' : 'rotate(0deg)' }}
          onClick={() => setFabOpen((o) => !o)}
          aria-label="Add"
        >
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Group picker */}
      <Modal open={groupPickerOpen} onClose={() => setGroupPickerOpen(false)} title="Select Group">
        <div className="space-y-1 py-1">
          {expenseGroups.map((g) => (
            <button
              key={g.id}
              className="w-full text-left px-3 py-3 rounded-lg text-sm text-primary hover:bg-surface-2 transition-colors"
              onClick={() => { setGroupPickerOpen(false); setAddCatState({ groupId: g.id, groupName: g.name }) }}
            >
              {g.name}
            </button>
          ))}
        </div>
      </Modal>

      {/* Modals */}
      <GroupModal open={addGroupOpen} onClose={() => setAddGroupOpen(false)} />
      {addCatState && (
        <CategoryModal
          open={!!addCatState}
          onClose={() => setAddCatState(null)}
          groupId={addCatState.groupId}
          groupName={addCatState.groupName}
          weekStart={weekStart}
        />
      )}

      {/* Mobile bottom week nav bar */}
      <div className="md:hidden fixed bottom-20 left-0 right-0 z-30 bg-surface border-t border-border flex items-center justify-center px-4 py-2" style={{ transform: 'translateZ(0)' }}>
        {weekNav}
      </div>

      <div className="max-w-7xl mx-auto px-4 pt-4 pb-28 md:py-6 md:pb-6 md:space-y-5 md:px-6" {...swipe}>
        {/* Mobile title */}
        <h1 className="md:hidden text-xl font-bold text-primary mb-3">Budget</h1>

        {/* Desktop header */}
        <div className="hidden md:flex flex-row items-center gap-3">
          <h1 className="text-xl font-bold text-primary flex-1">Budget</h1>
          {weekNav}
        </div>

        {/* Content */}
        {isLoading && (
          <div className="text-center py-16 text-secondary">Loading budget...</div>
        )}

        {error && (
          <div className="card p-6 text-center text-danger">
            Failed to load budget data.
          </div>
        )}

        {budgetData && accounts && (
          <BudgetTable data={budgetData} accounts={accounts} />
        )}
      </div>
    </>
  )
}

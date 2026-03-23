import { useState } from 'react'
import { BudgetWeek, BudgetGroup, BudgetCategory, IncomeGroup, IncomeCategory } from '../../api/budget'
import { Account } from '../../api/accounts'
import { formatMoney } from '../ui/AmountDisplay'
import { Button } from '../ui/Button'
import { CoverModal } from './CoverModal'
import { CategoryModal } from './CategoryModal'
import { GroupModal } from './GroupModal'

interface BudgetTableProps {
  data: BudgetWeek
  accounts: Account[]
}

const PERIOD_LABELS: Record<string, string> = {
  weekly: 'wk',
  fortnightly: 'fn',
  monthly: 'mo',
  quarterly: 'qtr',
  annually: 'yr',
}

const PERIOD_COLOURS: Record<string, string> = {
  weekly:      'bg-blue-500/15 text-blue-400',
  fortnightly: 'bg-violet-500/15 text-violet-400',
  monthly:     'bg-amber-500/15 text-amber-400',
  quarterly:   'bg-rose-500/15 text-rose-400',
  annually:    'bg-teal-500/15 text-teal-400',
}

// ─── Expense category row ────────────────────────────────────────────────────

function CategoryRow({
  cat,
  weekStart,
  accounts,
  groupId,
  groupName,
}: {
  cat: BudgetCategory
  weekStart: string
  accounts: Account[]
  groupId: number
  groupName: string
}) {
  const [coverOpen, setCoverOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const transactionalAccounts = accounts.filter((a) => a.type === 'transactional')
  const isCovered = cat.covers > 0 && !cat.isOverspent

  return (
    <>
      <tr
        className="border-b border-border/50 hover:bg-surface-2/50 cursor-pointer group"
        onClick={() => setEditOpen(true)}
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-primary">{cat.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PERIOD_COLOURS[cat.period] ?? 'bg-surface-2 text-muted'}`}>
              {PERIOD_LABELS[cat.period]}
            </span>
            {isCovered && (
              <span className="text-xs text-accent-dim hidden sm:inline">covered</span>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-sm text-secondary tabular-nums hidden md:table-cell">
          {formatMoney(cat.budgetedAmount)}
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-sm text-secondary tabular-nums hidden lg:table-cell">
          {formatMoney(cat.weeklyEquivalent)}
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-sm tabular-nums hidden sm:table-cell">
          <span className={cat.spent > cat.budgetedAmount ? 'text-danger' : 'text-secondary'}>
            {formatMoney(cat.spent)}
          </span>
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-sm tabular-nums">
          <span className={cat.isOverspent ? 'text-danger font-semibold' : 'text-primary'}>
            {formatMoney(cat.balance)}
          </span>
        </td>
        <td className="px-2 py-2.5 text-right sm:px-3">
          {cat.isOverspent && (
            <Button
              size="sm"
              variant="danger"
              onClick={(e) => {
                e.stopPropagation()
                setCoverOpen(true)
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            >
              Cover
            </Button>
          )}
        </td>
      </tr>

      {coverOpen && (
        <CoverModal
          open={coverOpen}
          onClose={() => setCoverOpen(false)}
          category={cat}
          weekStart={weekStart}
          transactionalAccounts={transactionalAccounts}
        />
      )}

      <CategoryModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        groupId={groupId}
        groupName={groupName}
        category={cat}
      />
    </>
  )
}

// ─── Expense group section ───────────────────────────────────────────────────

function GroupSection({
  group,
  weekStart,
  accounts,
  onAddCategory,
}: {
  group: BudgetGroup
  weekStart: string
  accounts: Account[]
  onAddCategory: (groupId: number, groupName: string) => void
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const groupSpent = group.categories.reduce((s, c) => s + c.spent, 0)
  const groupBalance = group.categories.reduce((s, c) => s + c.balance, 0)
  const groupWeekly = group.categories.reduce((s, c) => s + c.weeklyEquivalent, 0)

  return (
    <>
      <tr className="bg-surface-2">
        <td className="px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              className="text-muted hover:text-primary transition-colors"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? 'Expand group' : 'Collapse group'}
            >
              <svg
                className={`w-3.5 h-3.5 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button
              className="text-sm font-semibold text-primary hover:text-accent transition-colors"
              onClick={() => setEditOpen(true)}
            >
              {group.name}
            </button>
          </div>
        </td>
        <td className="hidden md:table-cell" />
        <td className="px-3 py-2 text-right font-mono text-xs text-muted tabular-nums hidden lg:table-cell">
          {formatMoney(groupWeekly)}
        </td>
        <td className="px-3 py-2 text-right font-mono text-xs text-muted tabular-nums hidden sm:table-cell">
          {formatMoney(groupSpent)}
        </td>
        <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
          <span className={groupBalance < 0 ? 'text-danger' : 'text-secondary'}>
            {formatMoney(groupBalance)}
          </span>
        </td>
        <td className="px-2 py-2 text-right sm:px-3">
          <button
            className="text-muted hover:text-accent text-xs flex items-center gap-1 transition-colors ml-auto"
            onClick={() => onAddCategory(group.id, group.name)}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">Add</span>
          </button>
        </td>
      </tr>

      {!collapsed && group.categories.length === 0 ? (
        <tr>
          <td colSpan={6} className="px-6 py-2 text-xs text-muted italic">
            No categories yet — add one above
          </td>
        </tr>
      ) : !collapsed && (
        group.categories.map((cat) => (
          <CategoryRow
            key={cat.id}
            cat={cat}
            weekStart={weekStart}
            accounts={accounts}
            groupId={group.id}
            groupName={group.name}
          />
        ))
      )}

      <GroupModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        group={{ id: group.id, name: group.name }}
      />
    </>
  )
}

// ─── Income category row ─────────────────────────────────────────────────────

function IncomeCategoryRow({
  cat,
  groupId,
  groupName,
}: {
  cat: IncomeCategory
  groupId: number
  groupName: string
}) {
  const [editOpen, setEditOpen] = useState(false)

  return (
    <>
      <tr
        className="border-b border-border/50 hover:bg-surface-2/50 cursor-pointer"
        onClick={() => setEditOpen(true)}
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-primary">{cat.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PERIOD_COLOURS[cat.period] ?? 'bg-surface-2 text-muted'}`}>
              {PERIOD_LABELS[cat.period]}
            </span>
          </div>
        </td>
        <td className="hidden md:table-cell" />
        <td className="hidden lg:table-cell" />
        <td className="px-3 py-2.5 text-right font-mono text-sm tabular-nums">
          <span className="text-accent">{formatMoney(cat.received)}</span>
        </td>
        <td />
        <td />
      </tr>

      <CategoryModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        groupId={groupId}
        groupName={groupName}
        isIncomeGroup
        category={{ id: cat.id, name: cat.name, period: cat.period, budgetedAmount: 0, notes: cat.notes }}
      />
    </>
  )
}

// ─── Income group section ────────────────────────────────────────────────────

function IncomeGroupSection({
  group,
  onAddCategory,
}: {
  group: IncomeGroup
  onAddCategory: (groupId: number, groupName: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const groupReceived = group.categories.reduce((s, c) => s + c.received, 0)

  return (
    <>
      <tr className="bg-surface-2">
        <td className="px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              className="text-muted hover:text-primary transition-colors"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? 'Expand group' : 'Collapse group'}
            >
              <svg
                className={`w-3.5 h-3.5 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button
              className="text-sm font-semibold text-primary hover:text-accent transition-colors"
              onClick={() => setEditOpen(true)}
            >
              {group.name}
            </button>
          </div>
        </td>
        <td className="hidden md:table-cell" />
        <td className="hidden lg:table-cell" />
        <td className="px-3 py-2 text-right font-mono text-xs text-accent tabular-nums">
          {formatMoney(groupReceived)}
        </td>
        <td />
        <td className="px-2 py-2 text-right sm:px-3">
          <button
            className="text-muted hover:text-accent text-xs flex items-center gap-1 transition-colors ml-auto"
            onClick={() => onAddCategory(group.id, group.name)}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">Add</span>
          </button>
        </td>
      </tr>

      {!collapsed && group.categories.length === 0 ? (
        <tr>
          <td colSpan={6} className="px-6 py-2 text-xs text-muted italic">
            No categories yet — add one above
          </td>
        </tr>
      ) : !collapsed && (
        group.categories.map((cat) => (
          <IncomeCategoryRow
            key={cat.id}
            cat={cat}
            groupId={group.id}
            groupName={group.name}
          />
        ))
      )}

      <GroupModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        group={{ id: group.id, name: group.name }}
        isIncome
      />
    </>
  )
}

// ─── Main table ──────────────────────────────────────────────────────────────

export function BudgetTable({ data, accounts }: BudgetTableProps) {
  const [addCatState, setAddCatState] = useState<{ groupId: number; groupName: string; isIncome: boolean } | null>(null)
  const [addGroupOpen, setAddGroupOpen] = useState(false)
  const [addIncomeGroupOpen, setAddIncomeGroupOpen] = useState(false)

  const incomeGroups = data.incomeGroups ?? []

  return (
    <div className="space-y-3">
      {/* Expense table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-medium">Category</th>
                <th className="px-3 py-3 text-right font-medium hidden md:table-cell">Budgeted</th>
                <th className="px-3 py-3 text-right font-medium hidden lg:table-cell">Weekly</th>
                <th className="px-3 py-3 text-right font-medium hidden sm:table-cell">Spent</th>
                <th className="px-3 py-3 text-right font-medium">Balance</th>
                <th className="px-2 py-3 sm:px-3 sm:w-20" />
              </tr>
            </thead>
            <tbody>
              {data.groups.map((group) => (
                <GroupSection
                  key={group.id}
                  group={group}
                  weekStart={data.weekStart}
                  accounts={accounts}
                  onAddCategory={(groupId, groupName) =>
                    setAddCatState({ groupId, groupName, isIncome: false })
                  }
                />
              ))}
              {data.groups.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-secondary">
                    No budget groups yet. Add a group to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-border">
          <button
            className="text-sm text-muted hover:text-accent flex items-center gap-2 transition-colors"
            onClick={() => setAddGroupOpen(true)}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Group
          </button>
        </div>
      </div>

      {/* Income table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-medium">Income</th>
                <th className="hidden md:table-cell" />
                <th className="hidden lg:table-cell" />
                <th className="px-3 py-3 text-right font-medium">Received</th>
                <th />
                <th className="px-2 py-3 sm:px-3 sm:w-20" />
              </tr>
            </thead>
            <tbody>
              {incomeGroups.map((group) => (
                <IncomeGroupSection
                  key={group.id}
                  group={group}
                  onAddCategory={(groupId, groupName) =>
                    setAddCatState({ groupId, groupName, isIncome: true })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-border">
          <button
            className="text-sm text-muted hover:text-accent flex items-center gap-2 transition-colors"
            onClick={() => setAddIncomeGroupOpen(true)}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Income Group
          </button>
        </div>
      </div>

      {/* Totals */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="text-sm font-semibold text-primary">Total weekly allocation</div>
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="text-right">
              <div className="font-mono text-sm font-semibold text-secondary tabular-nums">{formatMoney(data.totalWeeklyBudget)}</div>
              <div className="text-xs text-muted">allocated</div>
            </div>
            <div className="text-right">
              <div className={`font-mono text-sm font-semibold tabular-nums ${data.unallocated !== 0 ? 'text-warn' : 'text-accent'}`}>
                {formatMoney(data.unallocated)}
              </div>
              <div className="text-xs text-muted">unallocated</div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <GroupModal open={addGroupOpen} onClose={() => setAddGroupOpen(false)} />
      <GroupModal open={addIncomeGroupOpen} onClose={() => setAddIncomeGroupOpen(false)} isIncome />

      {addCatState && (
        <CategoryModal
          open={true}
          onClose={() => setAddCatState(null)}
          groupId={addCatState.groupId}
          groupName={addCatState.groupName}
          isIncomeGroup={addCatState.isIncome}
        />
      )}
    </div>
  )
}

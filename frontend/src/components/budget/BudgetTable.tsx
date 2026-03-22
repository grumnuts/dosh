import { useState } from 'react'
import { BudgetWeek, BudgetGroup, BudgetCategory } from '../../api/budget'
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
        {/* Name */}
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-primary">{cat.name}</span>
            <span className="text-xs text-muted hidden sm:inline">
              {PERIOD_LABELS[cat.period]}
            </span>
            {isCovered && (
              <span className="text-xs text-accent-dim hidden sm:inline">covered</span>
            )}
          </div>
        </td>

        {/* Budgeted */}
        <td className="px-3 py-2.5 text-right font-mono text-sm text-secondary tabular-nums hidden md:table-cell">
          {formatMoney(cat.budgetedAmount)}
        </td>

        {/* Weekly equiv */}
        <td className="px-3 py-2.5 text-right font-mono text-sm text-secondary tabular-nums hidden lg:table-cell">
          {formatMoney(cat.weeklyEquivalent)}
        </td>

        {/* Spent */}
        <td className="px-3 py-2.5 text-right font-mono text-sm tabular-nums">
          <span className={cat.spent > cat.budgetedAmount ? 'text-danger' : 'text-secondary'}>
            {formatMoney(cat.spent)}
          </span>
        </td>

        {/* Balance */}
        <td className="px-3 py-2.5 text-right font-mono text-sm tabular-nums">
          <span className={cat.isOverspent ? 'text-danger font-semibold' : 'text-primary'}>
            {formatMoney(cat.balance)}
          </span>
        </td>

        {/* Actions */}
        <td className="px-3 py-2.5 text-right">
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

  const groupSpent = group.categories.reduce((s, c) => s + c.spent, 0)
  const groupBalance = group.categories.reduce((s, c) => s + c.balance, 0)

  return (
    <>
      {/* Group header row */}
      <tr className="bg-surface-2">
        <td colSpan={6} className="px-4 py-2">
          <div className="flex items-center justify-between">
            <button
              className="flex items-center gap-2 text-sm font-semibold text-primary hover:text-accent transition-colors"
              onClick={() => setEditOpen(true)}
            >
              {group.name}
            </button>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted hidden md:inline font-mono tabular-nums">
                {formatMoney(groupSpent)} spent
              </span>
              <span
                className={`text-xs font-mono tabular-nums hidden md:inline ${groupBalance < 0 ? 'text-danger' : 'text-secondary'}`}
              >
                {formatMoney(groupBalance)}
              </span>
              <button
                className="text-muted hover:text-accent text-xs flex items-center gap-1 transition-colors"
                onClick={() => onAddCategory(group.id, group.name)}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="hidden sm:inline">Add</span>
              </button>
            </div>
          </div>
        </td>
      </tr>

      {/* Category rows */}
      {group.categories.length === 0 ? (
        <tr>
          <td colSpan={6} className="px-6 py-2 text-xs text-muted italic">
            No categories yet — add one above
          </td>
        </tr>
      ) : (
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

export function BudgetTable({ data, accounts }: BudgetTableProps) {
  const [addCatState, setAddCatState] = useState<{ groupId: number; groupName: string } | null>(null)
  const [addGroupOpen, setAddGroupOpen] = useState(false)

  const handleAddCategory = (groupId: number, groupName: string) => {
    setAddCatState({ groupId, groupName })
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[420px]">
          <thead>
            <tr className="border-b border-border text-xs text-muted uppercase tracking-wide">
              <th className="px-4 py-3 text-left font-medium">Category</th>
              <th className="px-3 py-3 text-right font-medium hidden md:table-cell">Budgeted</th>
              <th className="px-3 py-3 text-right font-medium hidden lg:table-cell">Weekly</th>
              <th className="px-3 py-3 text-right font-medium">Spent</th>
              <th className="px-3 py-3 text-right font-medium">Balance</th>
              <th className="px-3 py-3 w-20" />
            </tr>
          </thead>

          <tbody>
            {data.groups.map((group) => (
              <GroupSection
                key={group.id}
                group={group}
                weekStart={data.weekStart}
                accounts={accounts}
                onAddCategory={handleAddCategory}
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

          {/* Footer */}
          <tfoot>
            <tr className="border-t-2 border-border bg-surface-2">
              <td className="px-4 py-3 text-sm font-semibold text-primary">Totals</td>
              <td className="px-3 py-3 text-right font-mono text-sm font-semibold tabular-nums hidden md:table-cell">
                {formatMoney(data.totalWeeklyBudget)}
              </td>
              <td className="hidden lg:table-cell" />
              <td className="px-3 py-3 text-right font-mono text-sm tabular-nums">
                <span className="text-accent">{formatMoney(data.totalIncome)}</span>
                <div className="text-xs text-muted font-normal">income</div>
              </td>
              <td className="px-3 py-3 text-right font-mono text-sm font-semibold tabular-nums" colSpan={2}>
                <span className={data.unallocated !== 0 ? 'text-warn' : 'text-accent'}>
                  {formatMoney(data.unallocated)}
                </span>
                <div className="text-xs text-muted font-normal">unallocated</div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Add group button */}
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

      {/* Modals */}
      <GroupModal open={addGroupOpen} onClose={() => setAddGroupOpen(false)} />

      {addCatState && (
        <CategoryModal
          open={true}
          onClose={() => setAddCatState(null)}
          groupId={addCatState.groupId}
          groupName={addCatState.groupName}
        />
      )}
    </div>
  )
}

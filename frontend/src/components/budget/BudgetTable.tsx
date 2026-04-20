import { useState, useEffect } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DraggableAttributes,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocalStorageBool } from '../../hooks/useLocalStorageBool'
import { useResizableCols, ResizeHandle } from '../../hooks/useResizableCols'
import { useLongPress } from '../../hooks/useLongPress'
import { BudgetWeek, BudgetGroup, BudgetCategory, IncomeGroup, IncomeCategory, DebtGroup, DebtCategory, SavingsGroup, SavingsCategory, InvestmentGroup, InvestmentCategory, budgetApi } from '../../api/budget'
import { Account } from '../../api/accounts'
import { formatMoney } from '../ui/AmountDisplay'

import { CoverModal } from './CoverModal'
import { SweepModal } from './SweepModal'
import { RollForwardModal } from './RollForwardModal'
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
  weekly:      'bg-blue-500/15 text-blue-100',
  fortnightly: 'bg-violet-500/15 text-violet-100',
  monthly:     'bg-amber-500/15 text-amber-100',
  quarterly:   'bg-rose-500/15 text-rose-100',
  annually:    'bg-teal-500/15 text-teal-100',
}

// ─── Action icons ────────────────────────────────────────────────────────────

function IconBtn({
  title,
  onClick,
  className,
  children,
}: {
  title: string
  onClick: (e: React.MouseEvent) => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`p-1.5 rounded transition-colors ${className ?? ''}`}
    >
      {children}
    </button>
  )
}

function CoverIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v11" />
      <path d="M12 22l-6-9h12z" fill="currentColor" />
      <path d="M5 22h14" />
    </svg>
  )
}

function SweepIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 2h14" />
      <path d="M12 2l-6 9h12z" fill="currentColor" />
      <path d="M12 11v11" />
    </svg>
  )
}

function RollForwardIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}

function UndoRollIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10H11" />
    </svg>
  )
}

// ─── Grip handle ─────────────────────────────────────────────────────────────

type SyntheticListenerMap = Record<string, (event: Event) => void>

function GripHandle({
  listeners,
  attributes,
}: {
  listeners?: SyntheticListenerMap
  attributes?: DraggableAttributes
}) {
  return (
    <div
      {...attributes}
      {...(listeners as React.HTMLAttributes<HTMLDivElement> | undefined)}
      className="cursor-grab active:cursor-grabbing touch-none text-muted hover:text-secondary opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
      onClick={(e) => e.stopPropagation()}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
        <circle cx="5" cy="2.5" r="1.1" />
        <circle cx="9" cy="2.5" r="1.1" />
        <circle cx="5" cy="7" r="1.1" />
        <circle cx="9" cy="7" r="1.1" />
        <circle cx="5" cy="11.5" r="1.1" />
        <circle cx="9" cy="11.5" r="1.1" />
      </svg>
    </div>
  )
}

// ─── Expense category row ────────────────────────────────────────────────────

type CategoryRowProps = {
  cat: BudgetCategory
  weekStart: string
  accounts: Account[]
  groupId: number
  groupName: string
  rowRef?: React.RefCallback<HTMLTableRowElement>
  rowStyle?: React.CSSProperties
  dragListeners?: SyntheticListenerMap
  dragAttributes?: DraggableAttributes
}

function CategoryRow({
  cat,
  weekStart,
  accounts,
  groupId,
  groupName,
  rowRef,
  rowStyle,
  dragListeners,
  dragAttributes,
}: CategoryRowProps) {
  const qc = useQueryClient()
  const [coverOpen, setCoverOpen] = useState(false)
  const [sweepOpen, setSweepOpen] = useState(false)
  const [rollForwardOpen, setRollForwardOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const transactionalAccounts = accounts.filter((a) => a.type === 'transactional')
  const isCovered = cat.covers > 0 && !cat.isOverspent
  const isSwept = cat.sweeps > 0 && !cat.isOverspent
  const isRolledOut = cat.rolledOut > 0
  const isRolledIn = cat.rolledIn > 0

  const undoRollover = useMutation({
    mutationFn: () => budgetApi.undoRollover(cat.rolloverIdOut!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget'] }),
  })

  return (
    <>
      <tr
        ref={rowRef}
        style={rowStyle}
        className="border-b border-border/50 hover:bg-surface-2/50 cursor-pointer group"
        onClick={() => setEditOpen(true)}
      >
        <td className="px-2 py-2.5 hidden md:table-cell w-6">
          <GripHandle listeners={dragListeners} attributes={dragAttributes} />
        </td>
        <td className="pl-2 pr-2 py-2.5">
          <div className="flex items-center gap-2">
            <span className={`inline-flex justify-center w-8 py-0.5 rounded text-xs font-medium shrink-0 ${PERIOD_COLOURS[cat.period] ?? 'bg-surface-2 text-muted'}`}>
              {PERIOD_LABELS[cat.period]}
            </span>
            <span className="text-sm text-primary">{cat.name}</span>
            {isCovered && (
              <span className="text-xs text-accent-dim hidden sm:inline">covered</span>
            )}
            {isSwept && (
              <span className="text-xs text-transfer hidden sm:inline">swept</span>
            )}
            {isRolledOut && (
              <span className="text-xs text-muted hidden sm:inline">rolled forward</span>
            )}
            {isRolledIn && (
              <span className="text-xs text-accent-dim hidden sm:inline">+rollover</span>
            )}
          </div>
        </td>
        <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs sm:text-sm text-secondary tabular-nums hidden md:table-cell">
          {formatMoney(cat.budgetedAmount)}
        </td>
        <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs sm:text-sm text-secondary tabular-nums">
          {formatMoney(cat.weeklyEquivalent)}
        </td>
        <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs sm:text-sm tabular-nums hidden sm:table-cell">
          <span className={cat.spent > cat.budgetedAmount ? 'text-danger' : 'text-secondary'}>
            {formatMoney(cat.spent)}
          </span>
        </td>
        <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs sm:text-sm tabular-nums">
          <span className={
            cat.isOverspent
              ? 'text-danger font-semibold'
              : cat.budgetedAmount > 0 && cat.balance < cat.budgetedAmount * 0.1
                ? 'text-orange-400'
                : 'text-primary'
          }>
            {formatMoney(cat.balance)}
          </span>
        </td>
        <td className="hidden sm:table-cell w-16 relative">
          <div className="absolute inset-0 flex items-center justify-end pr-2 gap-0.5">
            {cat.isOverspent && (
              <IconBtn
                title="Cover overspend"
                onClick={(e) => { e.stopPropagation(); setCoverOpen(true) }}
                className="text-danger hover:bg-danger/20"
              >
                <CoverIcon />
              </IconBtn>
            )}
            {!cat.isOverspent && cat.balance > 0 && (
              <>
                {isRolledOut ? (
                  <IconBtn
                    title="Undo roll forward"
                    onClick={(e) => { e.stopPropagation(); undoRollover.mutate() }}
                    className="text-blue-400 hover:bg-blue-400/10"
                  >
                    <UndoRollIcon />
                  </IconBtn>
                ) : (
                  <IconBtn
                    title="Roll balance forward to next period"
                    onClick={(e) => { e.stopPropagation(); setRollForwardOpen(true) }}
                    className="text-blue-400 hover:bg-blue-400/10"
                  >
                    <RollForwardIcon />
                  </IconBtn>
                )}
                <IconBtn
                  title="Sweep to savings"
                  onClick={(e) => { e.stopPropagation(); setSweepOpen(true) }}
                  className="text-accent hover:bg-accent/10"
                >
                  <SweepIcon />
                </IconBtn>
              </>
            )}
          </div>
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
      {sweepOpen && (
        <SweepModal
          open={sweepOpen}
          onClose={() => setSweepOpen(false)}
          category={cat}
          weekStart={weekStart}
          transactionalAccounts={transactionalAccounts}
        />
      )}
      {rollForwardOpen && (
        <RollForwardModal
          open={rollForwardOpen}
          onClose={() => setRollForwardOpen(false)}
          category={cat}
          weekStart={weekStart}
        />
      )}

      <CategoryModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        groupId={groupId}
        groupName={groupName}
        weekStart={weekStart}
        category={cat}
        fullCategory={cat}
        transactionalAccounts={transactionalAccounts}
      />
    </>
  )
}

function SortableCategoryRow(props: Omit<CategoryRowProps, 'rowRef' | 'rowStyle' | 'dragListeners' | 'dragAttributes'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.cat.id })
  return (
    <CategoryRow
      {...props}
      rowRef={setNodeRef}
      rowStyle={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        position: isDragging ? 'relative' : undefined,
        zIndex: isDragging ? 1 : undefined,
      }}
      dragListeners={listeners as SyntheticListenerMap}
      dragAttributes={attributes}
    />
  )
}

// ─── Expense group section ───────────────────────────────────────────────────

type GroupSectionProps = {
  group: BudgetGroup
  weekStart: string
  accounts: Account[]
  onAddCategory: (groupId: number, groupName: string) => void
  rowRef?: React.RefCallback<HTMLTableRowElement>
  rowStyle?: React.CSSProperties
  dragListeners?: SyntheticListenerMap
  dragAttributes?: DraggableAttributes
  isBeingDragged?: boolean
}

function GroupSection({
  group,
  weekStart,
  accounts,
  onAddCategory,
  rowRef,
  rowStyle,
  dragListeners,
  dragAttributes,
  isBeingDragged,
}: GroupSectionProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [collapsed, setCollapsed] = useLocalStorageBool(`dosh:collapsed:group:${group.id}`, false)
  const [orderedCats, setOrderedCats] = useState<BudgetCategory[]>(group.categories)

  const queryClient = useQueryClient()

  useEffect(() => {
    setOrderedCats(group.categories)
  }, [group.categories])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleCatDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrderedCats((cats) => {
      const oldIdx = cats.findIndex((c) => c.id === active.id)
      const newIdx = cats.findIndex((c) => c.id === over.id)
      const reordered = arrayMove(cats, oldIdx, newIdx)
      budgetApi.reorderCategories(reordered.map((c, i) => ({ id: c.id, sortOrder: i })))
      return reordered
    })
    queryClient.invalidateQueries({ queryKey: ['budget'] })
  }

  const groupSpent = group.categories.reduce((s, c) => s + c.spent, 0)
  const groupBalance = group.categories.reduce((s, c) => s + c.balance, 0)
  const groupWeekly = group.categories.reduce((s, c) => s + c.weeklyEquivalent, 0)
  const showCategories = !collapsed && !isBeingDragged

  const longPress = useLongPress(() => setEditOpen(true))

  return (
    <>
      <tr ref={rowRef} style={rowStyle} className="bg-white/5 group cursor-pointer select-none" onClick={() => setCollapsed((c) => !c)} {...longPress}>
        <td className="px-2 py-2.5 hidden md:table-cell w-6">
          <GripHandle listeners={dragListeners} attributes={dragAttributes} />
        </td>
        <td className="pl-2 pr-2 py-2.5">
          <span className="text-sm font-semibold text-primary">{group.name}</span>
        </td>
        <td className="hidden md:table-cell" />
        <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs text-muted tabular-nums">
          {formatMoney(groupWeekly)}
        </td>
        <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs text-muted tabular-nums hidden sm:table-cell">
          {formatMoney(groupSpent)}
        </td>
        <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs tabular-nums">
          <span className={groupBalance < 0 ? 'text-danger' : 'text-secondary'}>
            {formatMoney(groupBalance)}
          </span>
        </td>
        <td className="hidden sm:table-cell px-1.5 py-2.5">
          <div className="flex items-center justify-end gap-3">
            <button
              className="text-muted hover:text-secondary transition-colors"
              onClick={(e) => { e.stopPropagation(); setEditOpen(true) }}
              aria-label="Edit group"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              className="text-muted hover:text-accent text-xs flex items-center gap-1 transition-colors"
              onClick={(e) => { e.stopPropagation(); onAddCategory(group.id, group.name) }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </td>
      </tr>

      {showCategories && orderedCats.length === 0 && (
        <tr>
          <td colSpan={7} className="px-6 py-2 text-xs text-muted italic">
            No categories yet — add one above
          </td>
        </tr>
      )}

      {showCategories && orderedCats.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCatDragEnd}>
          <SortableContext items={orderedCats.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {orderedCats.map((cat) => (
              <SortableCategoryRow
                key={cat.id}
                cat={cat}
                weekStart={weekStart}
                accounts={accounts}
                groupId={group.id}
                groupName={group.name}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}

      <GroupModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        group={{ id: group.id, name: group.name }}
      />
    </>
  )
}

function SortableGroupSection(props: Omit<GroupSectionProps, 'rowRef' | 'rowStyle' | 'dragListeners' | 'dragAttributes' | 'isBeingDragged'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.group.id })
  return (
    <GroupSection
      {...props}
      rowRef={setNodeRef}
      rowStyle={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        position: isDragging ? 'relative' : undefined,
        zIndex: isDragging ? 1 : undefined,
      }}
      dragListeners={listeners as SyntheticListenerMap}
      dragAttributes={attributes}
      isBeingDragged={isDragging}
    />
  )
}

// ─── Income category row ─────────────────────────────────────────────────────

type IncomeCategoryRowProps = {
  cat: IncomeCategory
  groupId: number
  groupName: string
  rowRef?: React.RefCallback<HTMLTableRowElement>
  rowStyle?: React.CSSProperties
  dragListeners?: SyntheticListenerMap
  dragAttributes?: DraggableAttributes
}

function IncomeCategoryRow({
  cat,
  groupId,
  groupName,
  rowRef,
  rowStyle,
  dragListeners,
  dragAttributes,
}: IncomeCategoryRowProps) {
  const [editOpen, setEditOpen] = useState(false)

  return (
    <>
      <tr
        ref={rowRef}
        style={rowStyle}
        className="border-b border-border/50 hover:bg-surface-2/50 cursor-pointer group"
        onClick={() => setEditOpen(true)}
      >
        <td className="px-2 py-2.5 hidden md:table-cell w-6">
          <GripHandle listeners={dragListeners} attributes={dragAttributes} />
        </td>
        <td className="pl-2 pr-2 py-2.5">
          <div className="flex items-center gap-2">
            <span className={`inline-flex justify-center w-8 py-0.5 rounded text-xs font-medium shrink-0 ${PERIOD_COLOURS[cat.period] ?? 'bg-surface-2 text-muted'}`}>
              {PERIOD_LABELS[cat.period]}
            </span>
            <span className="text-sm text-primary">{cat.name}</span>
          </div>
        </td>
        <td className="hidden md:table-cell" />
        <td className="hidden lg:table-cell" />
        <td className="hidden md:table-cell" />
        <td className="px-3 py-2.5 text-right font-mono text-sm tabular-nums">
          <span className="text-accent">{formatMoney(cat.received)}</span>
        </td>
        <td className="hidden sm:table-cell" />
      </tr>

      <CategoryModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        groupId={groupId}
        groupName={groupName}
        isIncomeGroup
        category={{ id: cat.id, name: cat.name, period: cat.period, budgetedAmount: 0, notes: cat.notes, catchUp: false, isInvestment: false }}
      />
    </>
  )
}

function SortableIncomeCategoryRow(props: Omit<IncomeCategoryRowProps, 'rowRef' | 'rowStyle' | 'dragListeners' | 'dragAttributes'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.cat.id })
  return (
    <IncomeCategoryRow
      {...props}
      rowRef={setNodeRef}
      rowStyle={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      dragListeners={listeners as SyntheticListenerMap}
      dragAttributes={attributes}
    />
  )
}

// ─── Debt group section ──────────────────────────────────────────────────────

type DebtGroupSectionProps = {
  group: DebtGroup
}

function DebtGroupSection({ group }: DebtGroupSectionProps) {
  const [collapsed, setCollapsed] = useLocalStorageBool(`dosh:collapsed:debt-group:${group.id}`, false)
  const [editCat, setEditCat] = useState<DebtCategory | null>(null)

  const groupPaid = group.categories.reduce((s, c) => s + c.spent, 0)
  const groupOutstanding = group.categories.reduce((s, c) => s + c.linkedAccountBalance, 0)
  const groupWeekly = group.categories.reduce((s, c) => s + c.weeklyEquivalent, 0)
  const showCategories = !collapsed

  return (
    <>
      <tr className="bg-white/5 cursor-pointer" onClick={() => setCollapsed((c) => !c)}>
        <td className="px-2 py-2.5 hidden md:table-cell w-6" />
        <td className="pl-2 pr-2 py-2.5">
          <span className="text-sm font-semibold text-primary">{group.name}</span>
        </td>
        <td className="hidden md:table-cell" />
        <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs text-secondary tabular-nums">
          {formatMoney(groupWeekly)}
        </td>
        <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs text-secondary tabular-nums">
          {formatMoney(groupPaid)}
        </td>
        <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs tabular-nums hidden sm:table-cell">
          <span className={groupOutstanding >= 0 ? 'text-accent' : 'text-danger'}>{formatMoney(groupOutstanding)}</span>
        </td>
        <td className="hidden sm:table-cell" />
      </tr>

      {showCategories && group.categories.map((cat) => (
        <tr
          key={cat.id}
          className="border-b border-border/50 hover:bg-surface-2/50 cursor-pointer group"
          onClick={() => setEditCat(cat)}
        >
          <td className="px-2 py-2.5 hidden md:table-cell w-6" />
          <td className="pl-2 pr-2 py-2.5">
            <div className="flex items-center gap-2">
              <span className={`inline-flex justify-center w-8 py-0.5 rounded text-xs font-medium shrink-0 ${PERIOD_COLOURS[cat.period] ?? 'bg-surface-2 text-muted'}`}>
                {PERIOD_LABELS[cat.period]}
              </span>
              <span className="text-sm text-primary">{cat.name}</span>
            </div>
          </td>
          <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs sm:text-sm tabular-nums hidden md:table-cell">
            <span className="text-secondary">{formatMoney(cat.budgetedAmount)}</span>
          </td>
          <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs text-muted tabular-nums">
            {formatMoney(cat.weeklyEquivalent)}
          </td>
          <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs sm:text-sm tabular-nums">
            <span className="text-secondary">{formatMoney(cat.spent)}</span>
          </td>
          <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs sm:text-sm tabular-nums hidden sm:table-cell">
            <span className={cat.linkedAccountBalance >= 0 ? 'text-accent' : 'text-danger'}>{formatMoney(cat.linkedAccountBalance)}</span>
          </td>
          <td className="hidden sm:table-cell" />
        </tr>
      ))}

      {editCat && (
        <CategoryModal
          open={true}
          onClose={() => setEditCat(null)}
          groupId={group.id}
          groupName={group.name}
          isDebtGroup
          category={{ id: editCat.id, name: editCat.name, period: editCat.period, budgetedAmount: editCat.budgetedAmount, notes: editCat.notes, catchUp: editCat.catchUp, isInvestment: false }}
        />
      )}
    </>
  )
}

// ─── Income group section ────────────────────────────────────────────────────

type IncomeGroupSectionProps = {
  group: IncomeGroup
  onAddCategory: (groupId: number, groupName: string) => void
  rowRef?: React.RefCallback<HTMLTableRowElement>
  rowStyle?: React.CSSProperties
  dragListeners?: SyntheticListenerMap
  dragAttributes?: DraggableAttributes
  isBeingDragged?: boolean
}

function IncomeGroupSection({
  group,
  onAddCategory,
  rowRef,
  rowStyle,
  dragListeners,
  dragAttributes,
  isBeingDragged,
}: IncomeGroupSectionProps) {
  const [collapsed, setCollapsed] = useLocalStorageBool(`dosh:collapsed:income-group:${group.id}`, false)
  const [editOpen, setEditOpen] = useState(false)
  const [orderedCats, setOrderedCats] = useState<IncomeCategory[]>(group.categories)
  const queryClient = useQueryClient()

  useEffect(() => {
    setOrderedCats(group.categories)
  }, [group.categories])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleCatDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrderedCats((cats) => {
      const oldIdx = cats.findIndex((c) => c.id === active.id)
      const newIdx = cats.findIndex((c) => c.id === over.id)
      const reordered = arrayMove(cats, oldIdx, newIdx)
      budgetApi.reorderCategories(reordered.map((c, i) => ({ id: c.id, sortOrder: i })))
      return reordered
    })
    queryClient.invalidateQueries({ queryKey: ['budget'] })
  }

  const groupReceived = group.categories.reduce((s, c) => s + c.received, 0)
  const showCategories = !collapsed && !isBeingDragged

  const longPress = useLongPress(() => setEditOpen(true))

  return (
    <>
      <tr ref={rowRef} style={rowStyle} className="bg-white/5 group cursor-pointer select-none" onClick={() => setCollapsed((c) => !c)} {...longPress}>
        <td className="px-2 py-2.5 hidden md:table-cell w-6">
          <GripHandle listeners={dragListeners} attributes={dragAttributes} />
        </td>
        <td className="pl-2 pr-2 py-2.5">
          <span className="text-sm font-semibold text-primary">{group.name}</span>
        </td>
        <td className="hidden md:table-cell" />
        <td className="hidden lg:table-cell" />
        <td className="hidden md:table-cell" />
        <td className="px-3 py-2.5 text-right font-mono text-xs text-accent tabular-nums">
          {formatMoney(groupReceived)}
        </td>
        <td className="hidden sm:table-cell px-1.5 py-2.5">
          <div className="flex items-center justify-end gap-3">
            <button
              className="text-muted hover:text-secondary transition-colors"
              onClick={(e) => { e.stopPropagation(); setEditOpen(true) }}
              aria-label="Edit group"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              className="text-muted hover:text-accent text-xs flex items-center gap-1 transition-colors"
              onClick={(e) => { e.stopPropagation(); onAddCategory(group.id, group.name) }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </td>
      </tr>

      {showCategories && orderedCats.length === 0 && (
        <tr>
          <td colSpan={7} className="px-6 py-2 text-xs text-muted italic">
            No categories yet — add one above
          </td>
        </tr>
      )}

      {showCategories && orderedCats.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCatDragEnd}>
          <SortableContext items={orderedCats.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {orderedCats.map((cat) => (
              <SortableIncomeCategoryRow
                key={cat.id}
                cat={cat}
                groupId={group.id}
                groupName={group.name}
              />
            ))}
          </SortableContext>
        </DndContext>
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

function SortableIncomeGroupSection(props: Omit<IncomeGroupSectionProps, 'rowRef' | 'rowStyle' | 'dragListeners' | 'dragAttributes' | 'isBeingDragged'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.group.id })
  return (
    <IncomeGroupSection
      {...props}
      rowRef={setNodeRef}
      rowStyle={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        position: isDragging ? 'relative' : undefined,
        zIndex: isDragging ? 1 : undefined,
      }}
      dragListeners={listeners as SyntheticListenerMap}
      dragAttributes={attributes}
      isBeingDragged={isDragging}
    />
  )
}

// ─── Savings group section ───────────────────────────────────────────────────

type SavingsGroupSectionProps = {
  group: SavingsGroup
}

function SavingsGroupSection({ group }: SavingsGroupSectionProps) {
  const [collapsed, setCollapsed] = useLocalStorageBool(`dosh:collapsed:savings-group:${group.id}`, false)
  const [editCat, setEditCat] = useState<SavingsCategory | null>(null)

  const groupContributed = group.categories.reduce((s, c) => s + c.contributed, 0)
  const groupBalance = group.categories.reduce((s, c) => s + c.linkedAccountBalance, 0)
  const groupWeekly = group.categories.reduce((s, c) => s + c.weeklyEquivalent, 0)
  const showCategories = !collapsed

  return (
    <>
      <tr className="bg-white/5 cursor-pointer" onClick={() => setCollapsed((c) => !c)}>
        <td className="px-2 py-2.5 hidden md:table-cell w-6" />
        <td className="pl-2 pr-2 py-2.5">
          <span className="text-sm font-semibold text-primary">{group.name}</span>
        </td>
        <td className="hidden md:table-cell" />
        <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs text-secondary tabular-nums">
          {formatMoney(groupWeekly)}
        </td>
        <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs text-secondary tabular-nums">
          {formatMoney(groupContributed)}
        </td>
        <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs tabular-nums hidden sm:table-cell">
          <span className="text-accent">{formatMoney(groupBalance)}</span>
        </td>
        <td className="hidden sm:table-cell" />
      </tr>

      {showCategories && group.categories.map((cat) => (
        <tr
          key={cat.id}
          className="border-b border-border/50 hover:bg-surface-2/50 cursor-pointer group"
          onClick={() => setEditCat(cat)}
        >
          <td className="px-2 py-2.5 hidden md:table-cell w-6" />
          <td className="pl-2 pr-2 py-2.5">
            <div className="flex items-center gap-2">
              <span className={`inline-flex justify-center w-8 py-0.5 rounded text-xs font-medium shrink-0 ${PERIOD_COLOURS[cat.period] ?? 'bg-surface-2 text-muted'}`}>
                {PERIOD_LABELS[cat.period]}
              </span>
              <span className="text-sm text-primary">{cat.name}</span>
            </div>
          </td>
          <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs sm:text-sm tabular-nums hidden md:table-cell">
            <span className="text-secondary">{formatMoney(cat.budgetedAmount)}</span>
          </td>
          <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs text-muted tabular-nums">
            {formatMoney(cat.weeklyEquivalent)}
          </td>
          <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs sm:text-sm tabular-nums">
            <span className="text-secondary">{formatMoney(cat.contributed)}</span>
          </td>
          <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs sm:text-sm tabular-nums hidden sm:table-cell">
            <span className="text-accent">{formatMoney(cat.linkedAccountBalance)}</span>
          </td>
          <td className="hidden sm:table-cell" />
        </tr>
      ))}

      {editCat && (
        <CategoryModal
          open={true}
          onClose={() => setEditCat(null)}
          groupId={group.id}
          groupName={group.name}
          isDebtGroup
          category={{ id: editCat.id, name: editCat.name, period: editCat.period, budgetedAmount: editCat.budgetedAmount, notes: editCat.notes, catchUp: editCat.catchUp, isInvestment: false }}
        />
      )}
    </>
  )
}

// ─── Investments group section ────────────────────────────────────────────────

type InvestmentGroupSectionProps = {
  group: InvestmentGroup
  onAddInvestment: (groupId: number, groupName: string) => void
}

function InvestmentGroupSection({ group, onAddInvestment }: InvestmentGroupSectionProps) {
  const [collapsed, setCollapsed] = useLocalStorageBool(`dosh:collapsed:investment-group:${group.id}`, false)
  const [editCat, setEditCat] = useState<InvestmentCategory | null>(null)
  const showCategories = !collapsed

  const groupSpent = group.categories.reduce((s, c) => s + c.spent, 0)
  const groupBalance = group.categories.reduce((s, c) => s + c.balance, 0)
  const groupWeekly = group.categories.reduce((s, c) => s + c.weeklyEquivalent, 0)

  return (
    <>
      <tr className="bg-white/5 group cursor-pointer select-none" onClick={() => setCollapsed((c) => !c)}>
        <td className="px-2 py-2.5 hidden md:table-cell w-6" />
        <td className="pl-2 pr-2 py-2.5">
          <span className="text-sm font-semibold text-primary">{group.name}</span>
        </td>
        <td className="hidden md:table-cell" />
        <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs text-muted tabular-nums">
          {formatMoney(groupWeekly)}
        </td>
        <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs text-muted tabular-nums hidden sm:table-cell">
          {formatMoney(groupSpent)}
        </td>
        <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs tabular-nums">
          <span className={groupBalance < 0 ? 'text-danger' : 'text-secondary'}>
            {formatMoney(groupBalance)}
          </span>
        </td>
        <td className="hidden sm:table-cell px-1.5 py-2.5">
          <div className="flex items-center justify-end gap-3">
            <button
              className="text-muted hover:text-accent text-xs flex items-center gap-1 transition-colors"
              onClick={(e) => { e.stopPropagation(); onAddInvestment(group.id, group.name) }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </td>
      </tr>

      {showCategories && group.categories.length === 0 && (
        <tr>
          <td colSpan={7} className="px-6 py-2 text-xs text-muted italic">
            No investments yet — add one above
          </td>
        </tr>
      )}

      {showCategories && group.categories.map((cat) => (
        <tr
          key={cat.id}
          className="border-b border-border/50 hover:bg-surface-2/50 cursor-pointer group"
          onClick={() => setEditCat(cat)}
        >
          <td className="px-2 py-2.5 hidden md:table-cell w-6" />
          <td className="pl-2 pr-2 py-2.5">
            <div className="flex items-center gap-2">
              <span className={`inline-flex justify-center w-8 py-0.5 rounded text-xs font-medium shrink-0 ${PERIOD_COLOURS[cat.period] ?? 'bg-surface-2 text-muted'}`}>
                {PERIOD_LABELS[cat.period]}
              </span>
              <span className="text-sm text-primary">{cat.name}</span>
              <span className="font-mono text-xs text-muted">{cat.ticker}</span>
            </div>
          </td>
          <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs sm:text-sm tabular-nums hidden md:table-cell">
            <span className="text-secondary">{formatMoney(cat.budgetedAmount)}</span>
          </td>
          <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs text-muted tabular-nums">
            {formatMoney(cat.weeklyEquivalent)}
          </td>
          <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs sm:text-sm tabular-nums hidden sm:table-cell">
            <span className="text-secondary">{formatMoney(cat.spent)}</span>
          </td>
          <td className="px-1.5 sm:px-2 py-2.5 text-right font-mono text-xs sm:text-sm tabular-nums">
            <span className={cat.isOverspent ? 'text-danger font-semibold' : 'text-primary'}>{formatMoney(cat.balance)}</span>
          </td>
          <td className="hidden sm:table-cell" />
        </tr>
      ))}

      {editCat && (
        <CategoryModal
          open={true}
          onClose={() => setEditCat(null)}
          groupId={group.id}
          groupName={group.name}
          isInvestmentGroup
          category={{ id: editCat.id, name: editCat.name, ticker: editCat.ticker, period: editCat.period, budgetedAmount: editCat.budgetedAmount, notes: editCat.notes, catchUp: editCat.catchUp, isInvestment: true }}
        />
      )}
    </>
  )
}

// ─── Main table ──────────────────────────────────────────────────────────────

const BUDGET_DEFAULT_COL_WIDTHS = { category: 220, budgeted: 110, weekly: 78, spent: 100, balance: 100 }

export function BudgetTable({ data, accounts }: BudgetTableProps) {
  const { widths, onResizeStart } = useResizableCols(BUDGET_DEFAULT_COL_WIDTHS, 'dosh:budget-col-widths-v2')
  const [addCatState, setAddCatState] = useState<{ groupId: number; groupName: string; isIncome: boolean; isInvestment: boolean } | null>(null)
  const [addGroupOpen, setAddGroupOpen] = useState(false)
  const [addIncomeGroupOpen, setAddIncomeGroupOpen] = useState(false)
  const [orderedGroups, setOrderedGroups] = useState<BudgetGroup[]>(data.groups)
  const [orderedIncomeGroups, setOrderedIncomeGroups] = useState<IncomeGroup[]>(data.incomeGroups ?? [])
  const debtGroups = data.debtGroups ?? []
  const savingsGroups = data.savingsGroups ?? []
  const investmentGroups = data.investmentGroups ?? []
  const hasSavingsOrInvestments = savingsGroups.length > 0 || investmentGroups.length > 0
  const queryClient = useQueryClient()

  useEffect(() => { setOrderedGroups(data.groups) }, [data.groups])
  useEffect(() => { setOrderedIncomeGroups(data.incomeGroups ?? []) }, [data.incomeGroups])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleGroupDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrderedGroups((groups) => {
      const oldIdx = groups.findIndex((g) => g.id === active.id)
      const newIdx = groups.findIndex((g) => g.id === over.id)
      const reordered = arrayMove(groups, oldIdx, newIdx)
      budgetApi.reorderGroups(reordered.map((g, i) => ({ id: g.id, sortOrder: i })))
      return reordered
    })
    queryClient.invalidateQueries({ queryKey: ['budget'] })
  }

  const handleIncomeGroupDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrderedIncomeGroups((groups) => {
      const oldIdx = groups.findIndex((g) => g.id === active.id)
      const newIdx = groups.findIndex((g) => g.id === over.id)
      const reordered = arrayMove(groups, oldIdx, newIdx)
      budgetApi.reorderGroups(reordered.map((g, i) => ({ id: g.id, sortOrder: i })))
      return reordered
    })
    queryClient.invalidateQueries({ queryKey: ['budget'] })
  }

  return (
    <div className="space-y-3">
      {/* Expense table */}
      <div className="card overflow-hidden -mx-4 rounded-none md:rounded-t-lg border-x-0 border-t-0 bg-transparent md:mx-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-auto md:table-fixed">
            <thead>
              <tr className="border-b border-border text-xs text-muted uppercase tracking-wide bg-white/5">
                <th className="px-2 py-3 hidden md:table-cell w-6" />
                <th className="px-2 py-3 text-left font-medium relative" style={{ width: widths.category }}>Category<ResizeHandle onMouseDown={(e) => onResizeStart('category', e)} /></th>
                <th className="px-1.5 sm:px-2 py-3 text-right font-medium hidden md:table-cell relative" style={{ width: widths.budgeted }}>Budgeted<ResizeHandle onMouseDown={(e) => onResizeStart('budgeted', e)} /></th>
                <th className="px-1.5 sm:px-2 py-3 text-right font-medium relative" style={{ width: widths.weekly }}>Weekly<ResizeHandle onMouseDown={(e) => onResizeStart('weekly', e)} /></th>
                <th className="px-1.5 sm:px-2 py-3 text-right font-medium relative hidden sm:table-cell" style={{ width: widths.spent }}>Spent<ResizeHandle onMouseDown={(e) => onResizeStart('spent', e)} /></th>
                <th className="px-1.5 sm:px-2 py-3 text-right font-medium relative" style={{ width: widths.balance }}>Balance<ResizeHandle onMouseDown={(e) => onResizeStart('balance', e)} /></th>
                <th className="hidden sm:table-cell px-1.5 py-3 sm:w-16">
                  <button
                    className="text-muted hover:text-accent text-xs flex items-center gap-1 transition-colors ml-auto"
                    onClick={() => setAddGroupOpen(true)}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleGroupDragEnd}>
                <SortableContext items={orderedGroups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
                  {orderedGroups.map((group) => (
                    <SortableGroupSection
                      key={group.id}
                      group={group}
                      weekStart={data.weekStart}
                      accounts={accounts}
                      onAddCategory={(groupId, groupName) =>
                        setAddCatState({ groupId, groupName, isIncome: false, isInvestment: false })
                      }
                    />
                  ))}
                </SortableContext>
              </DndContext>
              {orderedGroups.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-secondary">
                    No budget groups yet. Add a group to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Debt table */}
      {debtGroups.length > 0 && (
        <div className="card overflow-hidden -mx-4 rounded-none md:rounded-t-lg border-x-0 border-t-0 bg-transparent md:mx-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-auto md:table-fixed">
              <thead>
                <tr className="border-b border-border text-xs text-muted uppercase tracking-wide bg-white/5">
                  <th className="px-2 py-3 hidden md:table-cell w-6" />
                  <th className="px-2 py-3 text-left font-medium relative" style={{ width: widths.category }}>Debt Payments<ResizeHandle onMouseDown={(e) => onResizeStart('category', e)} /></th>
                  <th className="px-1.5 sm:px-2 py-3 text-right font-medium hidden md:table-cell relative" style={{ width: widths.budgeted }}>Budgeted<ResizeHandle onMouseDown={(e) => onResizeStart('budgeted', e)} /></th>
                  <th className="px-1.5 sm:px-2 py-3 text-right font-medium relative" style={{ width: widths.weekly }}>Weekly<ResizeHandle onMouseDown={(e) => onResizeStart('weekly', e)} /></th>
                  <th className="px-1.5 sm:px-2 py-3 text-right font-medium relative" style={{ width: widths.spent }}>Paid<ResizeHandle onMouseDown={(e) => onResizeStart('spent', e)} /></th>
                  <th className="px-1.5 sm:px-2 py-3 text-right font-medium relative hidden sm:table-cell" style={{ width: widths.balance }}>Outstanding<ResizeHandle onMouseDown={(e) => onResizeStart('balance', e)} /></th>
                  <th className="hidden sm:table-cell px-1.5 py-3 sm:w-16" />
                </tr>
              </thead>
              <tbody>
                {debtGroups.map((group) => (
                  <DebtGroupSection key={group.id} group={group} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Savings & Investments table */}
      {hasSavingsOrInvestments && (
        <div className="card overflow-hidden -mx-4 rounded-none md:rounded-t-lg border-x-0 border-t-0 bg-transparent md:mx-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-auto md:table-fixed">
              <thead>
                <tr className="border-b border-border text-xs text-muted uppercase tracking-wide bg-white/5">
                  <th className="px-2 py-3 hidden md:table-cell w-6" />
                  <th className="px-2 py-3 text-left font-medium relative" style={{ width: widths.category }}>Savings &amp; Investments<ResizeHandle onMouseDown={(e) => onResizeStart('category', e)} /></th>
                  <th className="px-1.5 sm:px-2 py-3 text-right font-medium hidden md:table-cell relative" style={{ width: widths.budgeted }}>Budgeted<ResizeHandle onMouseDown={(e) => onResizeStart('budgeted', e)} /></th>
                  <th className="px-1.5 sm:px-2 py-3 text-right font-medium relative" style={{ width: widths.weekly }}>Weekly<ResizeHandle onMouseDown={(e) => onResizeStart('weekly', e)} /></th>
                  <th className="px-1.5 sm:px-2 py-3 text-right font-medium relative" style={{ width: widths.spent }}>Contributed<ResizeHandle onMouseDown={(e) => onResizeStart('spent', e)} /></th>
                  <th className="px-1.5 sm:px-2 py-3 text-right font-medium relative hidden sm:table-cell" style={{ width: widths.balance }}>Balance<ResizeHandle onMouseDown={(e) => onResizeStart('balance', e)} /></th>
                  <th className="hidden sm:table-cell px-1.5 py-3 sm:w-16" />
                </tr>
              </thead>
              <tbody>
                {savingsGroups.map((group) => (
                  <SavingsGroupSection key={group.id} group={group} />
                ))}
                {investmentGroups.map((group) => (
                  <InvestmentGroupSection
                    key={group.id}
                    group={group}
                    onAddInvestment={(groupId, groupName) =>
                      setAddCatState({ groupId, groupName, isIncome: false, isInvestment: true })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Income table */}
      <div className="card overflow-hidden -mx-4 rounded-none md:rounded-t-lg border-x-0 border-t-0 bg-transparent md:mx-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-auto md:table-fixed">
            <thead>
              <tr className="border-b border-border text-xs text-muted uppercase tracking-wide bg-white/5">
                <th className="px-2 py-3 hidden md:table-cell w-6" />
                <th className="px-2 py-3 text-left font-medium relative" style={{ width: widths.category }}>Income<ResizeHandle onMouseDown={(e) => onResizeStart('category', e)} /></th>
                <th className="hidden md:table-cell" style={{ width: widths.budgeted }} />
                <th className="hidden lg:table-cell" style={{ width: widths.weekly }} />
                <th className="hidden md:table-cell" style={{ width: widths.spent }} />
                <th className="px-3 py-3 text-right font-medium relative" style={{ width: widths.balance }}>Received<ResizeHandle onMouseDown={(e) => onResizeStart('balance', e)} /></th>
                <th className="hidden sm:table-cell px-1.5 py-3 sm:w-16">
                  <button
                    className="text-muted hover:text-accent text-xs flex items-center gap-1 transition-colors ml-auto"
                    onClick={() => setAddIncomeGroupOpen(true)}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleIncomeGroupDragEnd}>
                <SortableContext items={orderedIncomeGroups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
                  {orderedIncomeGroups.map((group) => (
                    <SortableIncomeGroupSection
                      key={group.id}
                      group={group}
                      onAddCategory={(groupId, groupName) =>
                        setAddCatState({ groupId, groupName, isIncome: true, isInvestment: false })
                      }
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </tbody>
          </table>
        </div>
      </div>

      {/* Totals */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="text-sm font-semibold text-primary">Total weekly allocation</div>
          <div className="text-right">
            <div className="font-mono text-sm font-semibold text-primary tabular-nums">{formatMoney(data.totalWeeklyBudget)}</div>
            <div className="text-xs text-muted">allocated</div>
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
          weekStart={data.weekStart}
          isIncomeGroup={addCatState.isIncome}
          isInvestmentGroup={addCatState.isInvestment}
        />
      )}
    </div>
  )
}

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
import { useQueryClient } from '@tanstack/react-query'
import { useLocalStorageBool } from '../../hooks/useLocalStorageBool'
import { useResizableCols, ResizeHandle } from '../../hooks/useResizableCols'
import { BudgetWeek, BudgetGroup, BudgetCategory, IncomeGroup, IncomeCategory, DebtGroup, DebtCategory, budgetApi } from '../../api/budget'
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
  weekly:      'bg-blue-500/15 text-blue-100',
  fortnightly: 'bg-violet-500/15 text-violet-100',
  monthly:     'bg-amber-500/15 text-amber-100',
  quarterly:   'bg-rose-500/15 text-rose-100',
  annually:    'bg-teal-500/15 text-teal-100',
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
  const [coverOpen, setCoverOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const transactionalAccounts = accounts.filter((a) => a.type === 'transactional')
  const isCovered = cat.covers > 0 && !cat.isOverspent

  return (
    <>
      <tr
        ref={rowRef}
        style={rowStyle}
        className="border-b border-border/50 hover:bg-surface-2/50 cursor-pointer group"
        onClick={() => setEditOpen(true)}
      >
        <td className="px-2 py-2.5 hidden md:table-cell w-8">
          <GripHandle listeners={dragListeners} attributes={dragAttributes} />
        </td>
        <td className="pl-12 pr-4 py-2.5">
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
        <td className="text-right relative">
          {cat.isOverspent && (
            <div className="absolute inset-0 hidden sm:flex items-center justify-end px-2 sm:px-3">
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
            </div>
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
        weekStart={weekStart}
        category={cat}
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

  return (
    <>
      <tr ref={rowRef} style={rowStyle} className="bg-white/5">
        <td className="px-2 py-2.5 hidden md:table-cell w-8">
          <GripHandle listeners={dragListeners} attributes={dragAttributes} />
        </td>
        <td className="pl-2 pr-4 py-2.5">
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
        <td className="px-3 py-2.5 text-right font-mono text-xs text-muted tabular-nums hidden lg:table-cell">
          {formatMoney(groupWeekly)}
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-xs text-muted tabular-nums hidden sm:table-cell">
          {formatMoney(groupSpent)}
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
          <span className={groupBalance < 0 ? 'text-danger' : 'text-secondary'}>
            {formatMoney(groupBalance)}
          </span>
        </td>
        <td className="px-2 py-2.5 text-right sm:px-3">
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
        <td className="px-2 py-2.5 hidden md:table-cell w-8">
          <GripHandle listeners={dragListeners} attributes={dragAttributes} />
        </td>
        <td className="pl-12 pr-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-primary">{cat.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PERIOD_COLOURS[cat.period] ?? 'bg-surface-2 text-muted'}`}>
              {PERIOD_LABELS[cat.period]}
            </span>
          </div>
        </td>
        <td className="hidden md:table-cell" />
        <td className="hidden lg:table-cell" />
        <td className="hidden md:table-cell" />
        <td className="px-3 py-2.5 text-right font-mono text-sm tabular-nums">
          <span className="text-accent">{formatMoney(cat.received)}</span>
        </td>
        <td />
      </tr>

      <CategoryModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        groupId={groupId}
        groupName={groupName}
        isIncomeGroup
        category={{ id: cat.id, name: cat.name, period: cat.period, budgetedAmount: 0, notes: cat.notes, catchUp: false }}
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
  const groupBalance = group.categories.reduce((s, c) => s + c.balance, 0)
  const groupOutstanding = group.categories.reduce((s, c) => s + c.linkedAccountBalance, 0)
  const groupWeekly = group.categories.reduce((s, c) => s + c.weeklyEquivalent, 0)
  const showCategories = !collapsed

  return (
    <>
      <tr className="bg-white/5">
        <td className="px-2 py-2.5 hidden md:table-cell w-8" />
        <td className="pl-2 pr-4 py-2.5">
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
            <span className="text-sm font-semibold text-primary">{group.name}</span>
          </div>
        </td>
        <td className="hidden md:table-cell" />
        <td className="px-3 py-2.5 text-right font-mono text-xs text-secondary tabular-nums hidden lg:table-cell">
          {formatMoney(groupWeekly)}
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-xs text-secondary tabular-nums hidden sm:table-cell">
          {formatMoney(groupPaid)}
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums hidden sm:table-cell">
          <span className={groupBalance < 0 ? 'text-accent' : 'text-secondary'}>{formatMoney(groupBalance)}</span>
        </td>
        <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums sm:px-3">
          <span className={groupOutstanding >= 0 ? 'text-accent' : 'text-danger'}>{formatMoney(groupOutstanding)}</span>
        </td>
      </tr>

      {showCategories && group.categories.map((cat) => (
        <tr
          key={cat.id}
          className="border-b border-border/50 hover:bg-surface-2/50 cursor-pointer group"
          onClick={() => setEditCat(cat)}
        >
          <td className="px-2 py-2.5 hidden md:table-cell w-8" />
          <td className="pl-12 pr-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-sm text-primary">{cat.name}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PERIOD_COLOURS[cat.period] ?? 'bg-surface-2 text-muted'}`}>
                {PERIOD_LABELS[cat.period]}
              </span>
            </div>
          </td>
          <td className="px-3 py-2.5 text-right font-mono text-sm tabular-nums hidden md:table-cell">
            <span className="text-secondary">{formatMoney(cat.budgetedAmount)}</span>
          </td>
          <td className="px-3 py-2.5 text-right font-mono text-xs text-muted tabular-nums hidden lg:table-cell">
            {formatMoney(cat.weeklyEquivalent)}
          </td>
          <td className="px-3 py-2.5 text-right font-mono text-sm tabular-nums hidden sm:table-cell">
            <span className="text-secondary">{formatMoney(cat.spent)}</span>
          </td>
          <td className="px-3 py-2.5 text-right font-mono text-sm tabular-nums hidden sm:table-cell">
            <span className={cat.balance < 0 ? 'text-accent' : 'text-primary'}>{formatMoney(cat.balance)}</span>
          </td>
          <td className="px-2 py-2.5 text-right font-mono text-sm tabular-nums sm:px-3">
            <span className={cat.linkedAccountBalance >= 0 ? 'text-accent' : 'text-danger'}>{formatMoney(cat.linkedAccountBalance)}</span>
          </td>
        </tr>
      ))}

      {editCat && (
        <CategoryModal
          open={true}
          onClose={() => setEditCat(null)}
          groupId={group.id}
          groupName={group.name}
          isDebtGroup
          category={{ id: editCat.id, name: editCat.name, period: editCat.period, budgetedAmount: editCat.budgetedAmount, notes: editCat.notes, catchUp: editCat.catchUp }}
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

  return (
    <>
      <tr ref={rowRef} style={rowStyle} className="bg-white/5">
        <td className="px-2 py-2.5 hidden md:table-cell w-8">
          <GripHandle listeners={dragListeners} attributes={dragAttributes} />
        </td>
        <td className="pl-2 pr-4 py-2.5">
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
        <td className="hidden md:table-cell" />
        <td className="px-3 py-2.5 text-right font-mono text-xs text-accent tabular-nums">
          {formatMoney(groupReceived)}
        </td>
        <td className="px-2 py-2.5 text-right sm:px-3">
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

// ─── Main table ──────────────────────────────────────────────────────────────

const BUDGET_DEFAULT_COL_WIDTHS = { category: 220, budgeted: 110, weekly: 100, spent: 100, balance: 100 }

export function BudgetTable({ data, accounts }: BudgetTableProps) {
  const { widths, onResizeStart } = useResizableCols(BUDGET_DEFAULT_COL_WIDTHS, 'dosh:budget-col-widths')
  const [addCatState, setAddCatState] = useState<{ groupId: number; groupName: string; isIncome: boolean } | null>(null)
  const [addGroupOpen, setAddGroupOpen] = useState(false)
  const [addIncomeGroupOpen, setAddIncomeGroupOpen] = useState(false)
  const [orderedGroups, setOrderedGroups] = useState<BudgetGroup[]>(data.groups)
  const [orderedIncomeGroups, setOrderedIncomeGroups] = useState<IncomeGroup[]>(data.incomeGroups ?? [])
  const debtGroups = data.debtGroups ?? []
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
          <table className="w-full text-sm table-fixed">
            <thead>
              <tr className="border-b border-border text-xs text-muted uppercase tracking-wide bg-white/5">
                <th className="px-2 py-3 hidden md:table-cell w-8" />
                <th className="px-4 py-3 text-left font-medium relative" style={{ width: widths.category }}>Category<ResizeHandle onMouseDown={(e) => onResizeStart('category', e)} /></th>
                <th className="px-3 py-3 text-right font-medium hidden md:table-cell relative" style={{ width: widths.budgeted }}>Budgeted<ResizeHandle onMouseDown={(e) => onResizeStart('budgeted', e)} /></th>
                <th className="px-3 py-3 text-right font-medium hidden lg:table-cell relative" style={{ width: widths.weekly }}>Weekly<ResizeHandle onMouseDown={(e) => onResizeStart('weekly', e)} /></th>
                <th className="px-3 py-3 text-right font-medium hidden sm:table-cell relative" style={{ width: widths.spent }}>Spent<ResizeHandle onMouseDown={(e) => onResizeStart('spent', e)} /></th>
                <th className="px-3 py-3 text-right font-medium relative" style={{ width: widths.balance }}>Balance<ResizeHandle onMouseDown={(e) => onResizeStart('balance', e)} /></th>
                <th className="px-2 py-3 w-10 sm:px-3 sm:w-20">
                  <button
                    className="text-muted hover:text-accent text-xs flex items-center gap-1 transition-colors ml-auto"
                    onClick={() => setAddGroupOpen(true)}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span className="hidden sm:inline">Add Group</span>
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
                        setAddCatState({ groupId, groupName, isIncome: false })
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
            <table className="w-full text-sm table-fixed">
              <thead>
                <tr className="border-b border-border text-xs text-muted uppercase tracking-wide bg-white/5">
                  <th className="px-2 py-3 hidden md:table-cell w-8" />
                  <th className="px-4 py-3 text-left font-medium relative" style={{ width: widths.category }}>Debt Payments<ResizeHandle onMouseDown={(e) => onResizeStart('category', e)} /></th>
                  <th className="px-3 py-3 text-right font-medium hidden md:table-cell relative" style={{ width: widths.budgeted }}>Budgeted<ResizeHandle onMouseDown={(e) => onResizeStart('budgeted', e)} /></th>
                  <th className="px-3 py-3 text-right font-medium hidden lg:table-cell relative" style={{ width: widths.weekly }}>Weekly<ResizeHandle onMouseDown={(e) => onResizeStart('weekly', e)} /></th>
                  <th className="px-3 py-3 text-right font-medium hidden sm:table-cell relative" style={{ width: widths.spent }}>Paid<ResizeHandle onMouseDown={(e) => onResizeStart('spent', e)} /></th>
                  <th className="px-3 py-3 text-right font-medium hidden sm:table-cell relative" style={{ width: widths.balance }}>Balance<ResizeHandle onMouseDown={(e) => onResizeStart('balance', e)} /></th>
                  <th className="px-2 py-3 text-right font-medium sm:px-3">Outstanding</th>
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

      {/* Income table */}
      <div className="card overflow-hidden -mx-4 rounded-none md:rounded-t-lg border-x-0 border-t-0 bg-transparent md:mx-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-fixed">
            <thead>
              <tr className="border-b border-border text-xs text-muted uppercase tracking-wide bg-white/5">
                <th className="px-2 py-3 hidden md:table-cell w-8" />
                <th className="px-4 py-3 text-left font-medium relative" style={{ width: widths.category }}>Income<ResizeHandle onMouseDown={(e) => onResizeStart('category', e)} /></th>
                <th className="hidden md:table-cell" style={{ width: widths.budgeted }} />
                <th className="hidden lg:table-cell" style={{ width: widths.weekly }} />
                <th className="hidden md:table-cell" style={{ width: widths.spent }} />
                <th className="px-3 py-3 text-right font-medium relative" style={{ width: widths.balance }}>Received<ResizeHandle onMouseDown={(e) => onResizeStart('balance', e)} /></th>
                <th className="px-2 py-3 w-10 sm:px-3 sm:w-20">
                  <button
                    className="text-muted hover:text-accent text-xs flex items-center gap-1 transition-colors ml-auto"
                    onClick={() => setAddIncomeGroupOpen(true)}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span className="hidden sm:inline">Add Group</span>
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
                        setAddCatState({ groupId, groupName, isIncome: true })
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
        />
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { ConfirmModal } from '../ui/ConfirmModal'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input, Select, Textarea } from '../ui/Input'
import { budgetApi, BudgetCategory, CategoryInput } from '../../api/budget'
import { CoverModal } from './CoverModal'
import { SweepModal } from './SweepModal'
import { RollForwardModal } from './RollForwardModal'
import { Account } from '../../api/accounts'

const schema = z.object({
  name: z.string().min(1, 'Required'),
  ticker: z.string().optional(),
  budgetedAmount: z.string().refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, 'Must be a positive number'),
  period: z.enum(['weekly', 'fortnightly', 'monthly', 'quarterly', 'annually']),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface CategoryProp {
  id: number
  name: string
  ticker?: string | null
  period: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually'
  budgetedAmount: number
  notes: string | null
  catchUp: boolean
  isInvestment: boolean
  isOverspent?: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  groupId: number
  groupName: string
  weekStart?: string
  isIncomeGroup?: boolean
  isDebtGroup?: boolean
  isInvestmentGroup?: boolean
  category?: CategoryProp | null
  fullCategory?: BudgetCategory
  transactionalAccounts?: Account[]
}

function getPeriodStart(weekStart: string, period: string): string {
  const d = new Date(weekStart + 'T00:00:00Z')
  switch (period) {
    case 'monthly':
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
    case 'quarterly': {
      const qMonth = Math.floor(d.getUTCMonth() / 3) * 3
      return `${d.getUTCFullYear()}-${String(qMonth + 1).padStart(2, '0')}-01`
    }
    case 'annually':
      return `${d.getUTCFullYear()}-01-01`
    default:
      return weekStart
  }
}

export function CategoryModal({ open, onClose, groupId, groupName, weekStart = '', isIncomeGroup, isDebtGroup, isInvestmentGroup, category, fullCategory, transactionalAccounts }: Props) {
  const qc = useQueryClient()
  const isEdit = !!category
  const [selectedGroupId, setSelectedGroupId] = useState(groupId)

  const { data: allGroups } = useQuery({
    queryKey: ['budget-groups'],
    queryFn: budgetApi.getGroups,
    enabled: isEdit && !isDebtGroup && !isInvestmentGroup,
  })
  const moveableGroups = allGroups?.filter((g) =>
    isIncomeGroup ? g.is_income === 1 : (g.is_income === 0 && g.is_debt === 0 && g.is_savings === 0 && g.is_investments === 0)
  ) ?? []

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      ticker: '',
      budgetedAmount: '0.00',
      period: 'weekly',
      notes: '',
    },
  })

  const selectedPeriod = watch('period')
  const isMidPeriod = getPeriodStart(weekStart, selectedPeriod) < weekStart
  const showCatchupToggle = isMidPeriod && !isIncomeGroup

  const [catchUp, setCatchUp] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmUndoRoll, setConfirmUndoRoll] = useState(false)
  const [coverOpen, setCoverOpen] = useState(false)
  const [sweepOpen, setSweepOpen] = useState(false)
  const [rollForwardOpen, setRollForwardOpen] = useState(false)

  const undoRollover = useMutation({
    mutationFn: () => budgetApi.undoRollover(fullCategory!.rolloverIdOut!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget'] }); onClose() },
  })

  const showCoverButton = isEdit && category?.isOverspent && !!fullCategory && !!transactionalAccounts?.length
  const showSweepButton = isEdit && !category?.isOverspent && !!fullCategory && (fullCategory.balance > 0) && !!transactionalAccounts?.length
  const isRolledOut = !!(fullCategory?.rolledOut && fullCategory.rolledOut > 0)
  const showRollForwardButton = isEdit && !category?.isOverspent && !!fullCategory && fullCategory.balance > 0 && !isRolledOut && !isIncomeGroup && !isDebtGroup && !isInvestmentGroup
  const showUndoRollButton = isEdit && isRolledOut && !isIncomeGroup && !isDebtGroup && !isInvestmentGroup

  useEffect(() => {
    if (open) {
      setSelectedGroupId(groupId)
      if (category) {
        setCatchUp(category.catchUp)
        reset({
          name: category.name,
          ticker: category.ticker ?? '',
          budgetedAmount: (category.budgetedAmount / 100).toFixed(2),
          period: category.period,
          notes: category.notes ?? '',
        })
      } else {
        setCatchUp(false)
        reset({ name: '', ticker: '', budgetedAmount: '0.00', period: 'weekly', notes: '' })
      }
    }
  }, [open, category, groupId, reset])

  const mutation = useMutation({
    mutationFn: async (data: CategoryInput): Promise<{ id: number }> => {
      if (isEdit) {
        await budgetApi.updateCategory(category!.id, data)
        return { id: category!.id }
      }
      return budgetApi.createCategory(data)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget'] })
      onClose()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => budgetApi.deleteCategory(category!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget'] })
      onClose()
    },
  })

  const onSubmit = (data: FormData) => {
    mutation.mutate({
      groupId: selectedGroupId,
      name: data.name,
      budgetedAmount: Math.round(parseFloat(data.budgetedAmount) * 100),
      period: data.period,
      notes: data.notes || null,
      catchUp,
      catchUpWeekStart: catchUp ? weekStart : undefined,
      isInvestment: !!isInvestmentGroup,
      ticker: isInvestmentGroup ? (data.ticker?.toUpperCase().trim() || null) : null,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Category' : (isInvestmentGroup ? 'Add Investment' : 'Add Category')}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-xs text-muted">Group: {groupName}</p>

        {isDebtGroup ? (
          <div>
            <p className="text-xs text-muted mb-1">Name</p>
            <p className="text-sm text-primary">{category?.name}</p>
            <p className="text-xs text-muted mt-1">Name is controlled by the linked debt account.</p>
          </div>
        ) : (
          <Input label="Name" {...register('name')} error={errors.name?.message} />
        )}

        {isEdit && !isDebtGroup && !isInvestmentGroup && moveableGroups.length > 1 && (
          <Select
            label="Group"
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(Number(e.target.value))}
          >
            {moveableGroups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </Select>
        )}

        {isInvestmentGroup && (
          <Input
            label="Ticker"
            placeholder="e.g. VAS.AX"
            {...register('ticker')}
            className="uppercase"
          />
        )}

        <div className={`grid gap-3 ${isIncomeGroup ? '' : 'grid-cols-2'}`}>
          {!isIncomeGroup && (
            <Input
              label="Budget Amount ($)"
              type="number"
              step="0.01"
              min="0"
              {...register('budgetedAmount')}
              error={errors.budgetedAmount?.message}
            />
          )}
          <Select label="Period" {...register('period')}>
            <option value="weekly">Weekly</option>
            <option value="fortnightly">Fortnightly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annually">Annually</option>
          </Select>
        </div>

        {showCatchupToggle && (
          <div className="flex items-start justify-between gap-4 p-3 rounded-lg bg-surface-2 border border-border">
            <div>
              <div className="text-sm font-medium text-primary">Catch Up</div>
              <p className="text-xs text-muted mt-0.5 leading-relaxed">
                Sets a higher weekly amount to cover the full budgeted amount by the end of the {selectedPeriod === 'monthly' ? 'month' : selectedPeriod === 'quarterly' ? 'quarter' : 'year'}.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={catchUp}
              onClick={() => setCatchUp((v) => !v)}
              className={`relative shrink-0 mt-0.5 w-10 h-6 rounded-full transition-colors focus:outline-none ${catchUp ? 'bg-accent' : 'bg-surface-3'}`}
            >
              <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${catchUp ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>
        )}


        <Textarea label="Notes (optional)" {...register('notes')} rows={2} />

        {mutation.isError && (
          <p className="text-sm text-danger">{(mutation.error as Error).message}</p>
        )}

        <div className="flex flex-col gap-3 pt-2">
          {(showCoverButton || showSweepButton || showRollForwardButton || showUndoRollButton) && (
            <div className="flex justify-center gap-2 sm:hidden">
              {showCoverButton && (
                <Button type="button" variant="outline" className="flex-1" onClick={() => setCoverOpen(true)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-danger"><path d="M12 2v11" /><path d="M12 22l-6-9h12z" fill="currentColor" /><path d="M5 22h14" /></svg>
                  Cover
                </Button>
              )}
              {showSweepButton && (
                <Button type="button" variant="outline" className="flex-1" onClick={() => setSweepOpen(true)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent"><path d="M5 2h14" /><path d="M12 2l-6 9h12z" fill="currentColor" /><path d="M12 11v11" /></svg>
                  Sweep
                </Button>
              )}
              {showRollForwardButton && (
                <Button type="button" variant="outline" className="flex-1" onClick={() => setRollForwardOpen(true)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                  Roll Forward
                </Button>
              )}
              {showUndoRollButton && (
                <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirmUndoRoll(true)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-orange-400"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                  Undo Roll
                </Button>
              )}
            </div>
          )}
          <ConfirmModal
            open={confirmUndoRoll}
            onClose={() => setConfirmUndoRoll(false)}
            onConfirm={() => { undoRollover.mutate(); setConfirmUndoRoll(false) }}
            title="Undo Roll Forward"
            message="Are you sure you want to undo the rolled-forward balance?"
            loading={undoRollover.isPending}
          />
          <div className="flex items-center gap-3 pt-2">
            {isEdit && !isDebtGroup && (
              <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            <div className="flex gap-3 ml-auto">
              <Button variant="ghost" type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                {isEdit ? 'Save' : 'Add Category'}
              </Button>
            </div>
          </div>
        </div>
        {showCoverButton && fullCategory && transactionalAccounts && (
          <CoverModal
            open={coverOpen}
            onClose={() => setCoverOpen(false)}
            onSuccess={onClose}
            category={fullCategory}
            weekStart={weekStart}
            transactionalAccounts={transactionalAccounts}
          />
        )}
        {showSweepButton && fullCategory && transactionalAccounts && (
          <SweepModal
            open={sweepOpen}
            onClose={() => setSweepOpen(false)}
            onSuccess={onClose}
            category={fullCategory}
            weekStart={weekStart}
            transactionalAccounts={transactionalAccounts}
          />
        )}
        {showRollForwardButton && fullCategory && (
          <RollForwardModal
            open={rollForwardOpen}
            onClose={() => setRollForwardOpen(false)}
            onSuccess={onClose}
            category={fullCategory}
            weekStart={weekStart}
          />
        )}
        <ConfirmModal
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => { deleteMutation.mutate(); setConfirmDelete(false) }}
          title="Delete Category"
          message={`Are you sure you want to delete "${category?.name}"? This cannot be undone.`}
          loading={deleteMutation.isPending}
        />
      </form>
    </Modal>
  )
}

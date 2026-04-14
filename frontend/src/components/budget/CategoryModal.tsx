import { useEffect, useState } from 'react'
import { ConfirmModal } from '../ui/ConfirmModal'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input, Select, Textarea } from '../ui/Input'
import { budgetApi, BudgetCategory, CategoryInput } from '../../api/budget'
import { CoverModal } from './CoverModal'
import { SweepModal } from './SweepModal'
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
  const [isInvestment, setIsInvestment] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [coverOpen, setCoverOpen] = useState(false)
  const [sweepOpen, setSweepOpen] = useState(false)

  const showCoverButton = isEdit && category?.isOverspent && !!fullCategory && !!transactionalAccounts?.length
  const showSweepButton = isEdit && !category?.isOverspent && !!fullCategory && (fullCategory.balance > 0) && !!transactionalAccounts?.length

  useEffect(() => {
    if (open) {
      if (category) {
        setCatchUp(category.catchUp)
        setIsInvestment(category.isInvestment)
        reset({
          name: category.name,
          ticker: category.ticker ?? '',
          budgetedAmount: (category.budgetedAmount / 100).toFixed(2),
          period: category.period,
          notes: category.notes ?? '',
        })
      } else {
        setCatchUp(false)
        setIsInvestment(false)
        reset({ name: '', ticker: '', budgetedAmount: '0.00', period: 'weekly', notes: '' })
      }
    }
  }, [open, category, reset])

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
      groupId,
      name: data.name,
      budgetedAmount: Math.round(parseFloat(data.budgetedAmount) * 100),
      period: data.period,
      notes: data.notes || null,
      catchUp,
      isInvestment: isInvestmentGroup ? true : isInvestment,
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

        {!isDebtGroup && !isIncomeGroup && !isInvestmentGroup && (
          <div className="flex items-start justify-between gap-4 p-3 rounded-lg bg-surface-2 border border-border">
            <div>
              <div className="text-sm font-medium text-primary">Investment Category</div>
              <p className="text-xs text-muted mt-0.5 leading-relaxed">
                Enables Ticker &amp; Quantity fields on transactions so share purchases are tracked in your portfolio.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isInvestment}
              onClick={() => setIsInvestment((v) => !v)}
              className={`relative shrink-0 mt-0.5 w-10 h-6 rounded-full transition-colors focus:outline-none ${isInvestment ? 'bg-accent' : 'bg-surface-3'}`}
            >
              <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${isInvestment ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>
        )}

        <Textarea label="Notes (optional)" {...register('notes')} rows={2} />

        {mutation.isError && (
          <p className="text-sm text-danger">{(mutation.error as Error).message}</p>
        )}

        <div className="flex items-center gap-3 pt-2">
          {isEdit && !isDebtGroup && (
            <Button
              type="button"
              variant="danger"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          )}
          {showCoverButton && (
            <Button
              type="button"
              variant="outline"
              className="md:hidden"
              onClick={() => setCoverOpen(true)}
            >
              Cover
            </Button>
          )}
          {showSweepButton && (
            <Button
              type="button"
              variant="outline"
              className="md:hidden"
              onClick={() => setSweepOpen(true)}
            >
              Sweep
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {isEdit ? 'Save' : 'Add Category'}
          </Button>
        </div>
        {showCoverButton && fullCategory && transactionalAccounts && (
          <CoverModal
            open={coverOpen}
            onClose={() => setCoverOpen(false)}
            category={fullCategory}
            weekStart={weekStart}
            transactionalAccounts={transactionalAccounts}
          />
        )}
        {showSweepButton && fullCategory && transactionalAccounts && (
          <SweepModal
            open={sweepOpen}
            onClose={() => setSweepOpen(false)}
            category={fullCategory}
            weekStart={weekStart}
            transactionalAccounts={transactionalAccounts}
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

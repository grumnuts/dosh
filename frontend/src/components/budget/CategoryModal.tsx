import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input, Select, Textarea } from '../ui/Input'
import { budgetApi, CategoryInput } from '../../api/budget'
import { settingsApi } from '../../api/settings'

const schema = z.object({
  name: z.string().min(1, 'Required'),
  budgetedAmount: z.string().refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, 'Must be a positive number'),
  period: z.enum(['weekly', 'fortnightly', 'monthly', 'quarterly', 'annually']),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface CategoryProp {
  id: number
  name: string
  period: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually'
  budgetedAmount: number
  notes: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  groupId: number
  groupName: string
  weekStart?: string
  isIncomeGroup?: boolean
  category?: CategoryProp | null
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

export function CategoryModal({ open, onClose, groupId, groupName, weekStart = '', isIncomeGroup, category }: Props) {
  const qc = useQueryClient()
  const isEdit = !!category

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get })
  const dynamicMode = settings?.dynamic_calculations === 'true'

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      budgetedAmount: '0.00',
      period: 'weekly',
      notes: '',
    },
  })

  const selectedPeriod = watch('period')
  const isMidPeriod = !isEdit && getPeriodStart(weekStart, selectedPeriod) < weekStart
  const showCatchupToggle = dynamicMode && isMidPeriod && !isIncomeGroup

  const [catchUp, setCatchUp] = useState(true)

  useEffect(() => {
    if (open) {
      setCatchUp(true)
      if (category) {
        reset({
          name: category.name,
          budgetedAmount: (category.budgetedAmount / 100).toFixed(2),
          period: category.period,
          notes: category.notes ?? '',
        })
      } else {
        reset({ name: '', budgetedAmount: '0.00', period: 'weekly', notes: '' })
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
      treatAsPeriodStart: showCatchupToggle ? !catchUp : undefined,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Category' : 'Add Category'}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-xs text-muted">Group: {groupName}</p>

        <Input label="Name" {...register('name')} error={errors.name?.message} />

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
              <div className="text-sm font-medium text-primary">Catch up this period</div>
              <p className="text-xs text-muted mt-0.5 leading-relaxed">
                Calculate weekly amount from today to cover the full budget by period end.
                Turn off if this is an existing expense that's been running since the period started.
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

        <div className="flex items-center gap-3 pt-2">
          {isEdit && (
            <Button
              type="button"
              variant="danger"
              onClick={() => deleteMutation.mutate()}
              loading={deleteMutation.isPending}
            >
              Delete
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
      </form>
    </Modal>
  )
}

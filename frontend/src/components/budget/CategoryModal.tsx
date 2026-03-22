import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input, Select, Textarea } from '../ui/Input'
import { budgetApi, CategoryInput } from '../../api/budget'

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
  isIncomeGroup?: boolean
  category?: CategoryProp | null
}

export function CategoryModal({ open, onClose, groupId, groupName, isIncomeGroup, category }: Props) {
  const qc = useQueryClient()
  const isEdit = !!category

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      budgetedAmount: '0.00',
      period: 'weekly',
      notes: '',
    },
  })

  useEffect(() => {
    if (open) {
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

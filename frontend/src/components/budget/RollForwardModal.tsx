import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { formatMoney } from '../ui/AmountDisplay'
import { budgetApi, BudgetCategory } from '../../api/budget'

interface RollForwardModalProps {
  open: boolean
  onClose: () => void
  category: BudgetCategory
  weekStart: string
}

const PERIOD_NEXT: Record<string, string> = {
  weekly: 'next week',
  fortnightly: 'next fortnight',
  monthly: 'next month',
  quarterly: 'next quarter',
  annually: 'next year',
}

export function RollForwardModal({ open, onClose, category, weekStart }: RollForwardModalProps) {
  const qc = useQueryClient()

  const roll = useMutation({
    mutationFn: () => budgetApi.rollForward({ categoryId: category.id, weekStart }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget'] })
      onClose()
    },
  })

  const nextLabel = PERIOD_NEXT[category.period] ?? 'next period'

  return (
    <Modal open={open} onClose={onClose} title="Roll Forward Balance">
      <div className="space-y-4">
        <div className="bg-surface-2 rounded-lg p-4">
          <div className="text-sm text-secondary mb-1">Category</div>
          <div className="font-semibold text-primary">{category.name}</div>
          <div className="mt-2 text-sm text-secondary">Balance to roll forward</div>
          <div className="text-xl font-bold text-accent font-mono">
            {formatMoney(category.balance)}
          </div>
        </div>

        <p className="text-sm text-secondary">
          The remaining balance of {formatMoney(category.balance)} will be added on top of{' '}
          {category.name}'s regular budget for {nextLabel}. No money moves between accounts.
        </p>

        {roll.isError && (
          <p className="text-sm text-danger">{(roll.error as Error).message}</p>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => roll.mutate()} loading={roll.isPending}>
            Roll forward {formatMoney(category.balance)}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

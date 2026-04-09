import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Select } from '../ui/Input'
import { formatMoney } from '../ui/AmountDisplay'
import { budgetApi, BudgetCategory } from '../../api/budget'
import { accountsApi, Account } from '../../api/accounts'

interface CoverModalProps {
  open: boolean
  onClose: () => void
  category: BudgetCategory
  weekStart: string
  transactionalAccounts: Account[]
}

export function CoverModal({
  open,
  onClose,
  category,
  weekStart,
  transactionalAccounts,
}: CoverModalProps) {
  const qc = useQueryClient()
  const [sourceAccountId, setSourceAccountId] = useState<number | ''>('')
  const [destAccountId, setDestAccountId] = useState<number | ''>(
    transactionalAccounts[0]?.id ?? '',
  )

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  })

  const savingsAccounts = accounts?.filter((a) => a.type === 'savings') ?? []
  const overspendAmount = Math.abs(category.balance)

  const cover = useMutation({
    mutationFn: () =>
      budgetApi.coverOverspend({
        categoryId: category.id,
        weekStart,
        sourceAccountId: sourceAccountId as number,
        destinationAccountId: destAccountId as number,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      onClose()
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="Cover Overspend">
      <div className="space-y-4">
        <div className="bg-surface-2 rounded-lg p-4">
          <div className="text-sm text-secondary mb-1">Category</div>
          <div className="font-semibold text-primary">{category.name}</div>
          <div className="mt-2 text-sm text-secondary">Overspend amount</div>
          <div className="text-xl font-bold text-danger font-mono">
            {formatMoney(overspendAmount)}
          </div>
        </div>

        <p className="text-sm text-secondary">
          This will create a transfer from your selected savings account to cover the overspend.
          The transfer will appear in your transaction list for matching when you import your next CSV.
        </p>

        <Select
          label="Transfer from (savings)"
          value={sourceAccountId}
          onChange={(e) => setSourceAccountId(Number(e.target.value))}
        >
          <option value="">Select savings account...</option>
          {savingsAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({formatMoney(a.currentBalance)})
            </option>
          ))}
        </Select>

        {transactionalAccounts.length > 1 && (
          <Select
            label="Transfer to (spending)"
            value={destAccountId}
            onChange={(e) => setDestAccountId(Number(e.target.value))}
          >
            {transactionalAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        )}

        {cover.isError && (
          <p className="text-sm text-danger">{(cover.error as Error).message}</p>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => cover.mutate()}
            disabled={!sourceAccountId || !destAccountId}
            loading={cover.isPending}
          >
            Cover {formatMoney(overspendAmount)}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

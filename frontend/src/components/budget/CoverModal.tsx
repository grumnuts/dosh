import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input, Select } from '../ui/Input'
import { formatMoney } from '../ui/AmountDisplay'
import { budgetApi, BudgetCategory } from '../../api/budget'
import { accountsApi, Account } from '../../api/accounts'

interface CoverModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  category: BudgetCategory
  weekStart: string
  transactionalAccounts: Account[]
}

export function CoverModal({
  open,
  onClose,
  onSuccess,
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
  const [amountStr, setAmountStr] = useState((overspendAmount / 100).toFixed(2))

  const parsedAmount = Math.round(parseFloat(amountStr) * 100)
  const amountValid = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount <= overspendAmount

  const cover = useMutation({
    mutationFn: () =>
      budgetApi.coverOverspend({
        categoryId: category.id,
        weekStart,
        sourceAccountId: sourceAccountId as number,
        destinationAccountId: destAccountId as number,
        amount: parsedAmount,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      onClose()
      onSuccess?.()
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="Cover Overspend">
      <div className="space-y-4">
        <div className="bg-surface-2 rounded-lg p-4">
          <div className="text-sm text-secondary mb-1">Category</div>
          <div className="font-semibold text-primary">{category.name}</div>
          <div className="mt-2 text-sm text-secondary">Total overspend</div>
          <div className="text-xl font-bold text-danger font-mono">
            {formatMoney(overspendAmount)}
          </div>
        </div>

        <p className="text-sm text-secondary">
          This will create a transfer from your selected savings account to cover the overspend.
          The transfer will appear in your transaction list for matching when you import your next CSV.
        </p>

        <Input
          label="Amount to cover ($)"
          type="number"
          step="0.01"
          min="0.01"
          max={(overspendAmount / 100).toFixed(2)}
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
        />

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
            disabled={!sourceAccountId || !destAccountId || !amountValid}
            loading={cover.isPending}
          >
            Cover {amountValid ? formatMoney(parsedAmount) : '…'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input, Select } from '../ui/Input'
import { formatMoney } from '../ui/AmountDisplay'
import { budgetApi, BudgetCategory } from '../../api/budget'
import { accountsApi, Account } from '../../api/accounts'

interface SweepModalProps {
  open: boolean
  onClose: () => void
  category: BudgetCategory
  weekStart: string
  transactionalAccounts: Account[]
}

export function SweepModal({
  open,
  onClose,
  category,
  weekStart,
  transactionalAccounts,
}: SweepModalProps) {
  const qc = useQueryClient()
  const availableBalance = category.balance

  const [amountStr, setAmountStr] = useState((availableBalance / 100).toFixed(2))
  const [sourceAccountId, setSourceAccountId] = useState<number | ''>(
    transactionalAccounts[0]?.id ?? '',
  )
  const [destAccountId, setDestAccountId] = useState<number | ''>('')

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  })

  const savingsAccounts = accounts?.filter((a) => a.type === 'savings') ?? []

  const parsedAmount = Math.round(parseFloat(amountStr) * 100)
  const amountValid = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount <= availableBalance

  const sweep = useMutation({
    mutationFn: () =>
      budgetApi.sweepUnspent({
        categoryId: category.id,
        weekStart,
        amount: parsedAmount,
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
    <Modal open={open} onClose={onClose} title="Sweep to Savings">
      <div className="space-y-4">
        <div className="bg-surface-2 rounded-lg p-4">
          <div className="text-sm text-secondary mb-1">Category</div>
          <div className="font-semibold text-primary">{category.name}</div>
          <div className="mt-2 text-sm text-secondary">Available balance</div>
          <div className="text-xl font-bold text-accent font-mono">
            {formatMoney(availableBalance)}
          </div>
        </div>

        <p className="text-sm text-secondary">
          This will transfer unspent money from your spending account to savings.
          The transfer will appear in your transaction list for matching when you import your next CSV.
        </p>

        <Input
          label="Amount to sweep ($)"
          type="number"
          step="0.01"
          min="0.01"
          max={(availableBalance / 100).toFixed(2)}
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
        />

        {transactionalAccounts.length > 1 && (
          <Select
            label="Transfer from (spending)"
            value={sourceAccountId}
            onChange={(e) => setSourceAccountId(Number(e.target.value))}
          >
            {transactionalAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        )}

        <Select
          label="Transfer to (savings)"
          value={destAccountId}
          onChange={(e) => setDestAccountId(Number(e.target.value))}
        >
          <option value="">Select savings account...</option>
          {savingsAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({formatMoney(a.currentBalance)})
            </option>
          ))}
        </Select>

        {sweep.isError && (
          <p className="text-sm text-danger">{(sweep.error as Error).message}</p>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => sweep.mutate()}
            disabled={!amountValid || !sourceAccountId || !destAccountId}
            loading={sweep.isPending}
          >
            Sweep {amountValid ? formatMoney(parsedAmount) : ''}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

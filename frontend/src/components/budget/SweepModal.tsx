import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Select } from '../ui/Input'
import { formatMoney } from '../ui/AmountDisplay'
import { CategoryCombobox } from '../ui/CategoryCombobox'
import { budgetApi, BudgetCategory } from '../../api/budget'
import { accountsApi, Account } from '../../api/accounts'

interface SweepModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  category: BudgetCategory
  weekStart: string
  transactionalAccounts: Account[]
  destinationCategories: BudgetCategory[]
  categoryGroups: Array<{ id: number; name: string }>
}

interface DestinationRow {
  kind: 'account' | 'category'
  id: number | ''
  amount: string
}

export function SweepModal({
  open,
  onClose,
  onSuccess,
  category,
  weekStart,
  transactionalAccounts,
  destinationCategories,
  categoryGroups,
}: SweepModalProps) {
  const qc = useQueryClient()
  const availableBalance = category.balance

  const [sourceAccountId, setSourceAccountId] = useState<number | ''>(
    transactionalAccounts[0]?.id ?? '',
  )
  const [destinations, setDestinations] = useState<DestinationRow[]>([
    { kind: 'account', id: '', amount: (availableBalance / 100).toFixed(2) },
  ])

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  })

  const savingsAccounts = accounts?.filter((a) => a.type === 'savings') ?? []

  const parsedDestinations = destinations.map((destination) => ({
    ...destination,
    parsedAmount: Math.round(parseFloat(destination.amount) * 100),
  }))
  const destinationTotal = parsedDestinations.reduce((total, destination) => total + (isNaN(destination.parsedAmount) ? 0 : destination.parsedAmount), 0)
  const destinationsValid = parsedDestinations.length > 0 && parsedDestinations.every((destination) => destination.id !== '' && destination.parsedAmount > 0)
  const amountValid = destinationTotal > 0 && destinationTotal <= availableBalance
  const sweepValid = amountValid && destinationsValid

  const updateDestination = (index: number, patch: Partial<DestinationRow>) => {
    setDestinations((current) => current.map((destination, i) => i === index ? { ...destination, ...patch } : destination))
  }

  const sweep = useMutation({
    mutationFn: () =>
      budgetApi.sweepUnspent({
        categoryId: category.id,
        weekStart,
        amount: destinationTotal,
        sourceAccountId: sourceAccountId as number,
        destinations: parsedDestinations.map((destination) => ({
          kind: destination.kind,
          id: destination.id as number,
          amount: destination.parsedAmount,
        })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      onClose()
      onSuccess?.()
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="Sweep Unspent">
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
          Split this unspent balance between other categories and savings accounts.
        </p>

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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-secondary uppercase tracking-wide">Destinations</span>
            <button
              type="button"
              className="text-xs text-accent hover:text-accent/80 transition-colors"
              onClick={() => setDestinations((current) => [...current, { kind: 'account', id: '', amount: '' }])}
            >
              + Add destination
            </button>
          </div>
          {destinations.map((destination, index) => (
            <div key={index} className="flex gap-2 items-start">
              <Select
                aria-label="Destination type"
                value={destination.kind}
                onChange={(e) => updateDestination(index, { kind: e.target.value as DestinationRow['kind'], id: '' })}
                className="w-28"
              >
                <option value="account">Account</option>
                <option value="category">Category</option>
              </Select>
              {destination.kind === 'account' ? (
                <select
                  aria-label="Destination"
                  value={destination.id}
                  onChange={(e) => updateDestination(index, { id: Number(e.target.value) || '' })}
                  className="input-base flex-1 min-w-0 h-9"
                >
                  <option value="">Select account...</option>
                  {savingsAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} ({formatMoney(account.currentBalance)})</option>)}
                </select>
              ) : (
                <CategoryCombobox
                  value={destination.id === '' ? '' : String(destination.id)}
                  onChange={(value) => updateDestination(index, { id: Number(value) || '' })}
                  categories={destinationCategories.map((destinationCategory) => ({
                    id: destinationCategory.id,
                    group_id: destinationCategory.groupId,
                    name: destinationCategory.name,
                  }))}
                  groups={categoryGroups}
                  placeholder="Select category..."
                  className="flex-1 min-w-0 h-9"
                  buttonClassName="input-base text-sm w-full h-9 text-left flex items-center"
                  balances={Object.fromEntries(destinationCategories.map((destinationCategory) => [destinationCategory.id, destinationCategory.balance]))}
                />
              )}
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={destination.amount}
                onChange={(e) => updateDestination(index, { amount: e.target.value })}
                className="input-base text-sm text-right w-24"
                aria-label="Destination amount"
              />
              <button
                type="button"
                onClick={() => setDestinations((current) => current.filter((_, i) => i !== index))}
                disabled={destinations.length <= 1}
                className="mt-1 p-1 text-muted hover:text-danger disabled:opacity-30 transition-colors"
                aria-label="Remove destination"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-dashed border-border p-3 text-sm text-secondary">
          <div>Selected total: <span className="font-semibold text-primary">{formatMoney(destinationTotal)}</span></div>
          <div>Remaining to sweep: <span className="text-secondary">{formatMoney(Math.max(0, availableBalance - destinationTotal))}</span></div>
        </div>

        {sweep.isError && (
          <p className="text-sm text-danger">{(sweep.error as Error).message}</p>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => sweep.mutate()}
            disabled={!sweepValid || !sourceAccountId}
            loading={sweep.isPending}
          >
            Sweep {sweepValid ? formatMoney(destinationTotal) : ''}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

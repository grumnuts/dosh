import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input, Select } from '../ui/Input'
import { transactionsApi, Transaction } from '../../api/transactions'
import { Account } from '../../api/accounts'

interface BulkEditModalProps {
  open: boolean
  onClose: () => void
  selectedIds: Set<number>
  transactions: Transaction[]
  accounts: Account[]
  groups: Array<{ id: number; name: string; is_income: number }>
  categories: Array<{ id: number; group_id: number; name: string }>
}

interface FieldState<T> {
  enabled: boolean
  value: T
}

export function BulkEditModal({ open, onClose, selectedIds, transactions, accounts, groups, categories }: BulkEditModalProps) {
  const qc = useQueryClient()

  const [date, setDate] = useState<FieldState<string>>({ enabled: false, value: '' })
  const [accountId, setAccountId] = useState<FieldState<string>>({ enabled: false, value: '' })
  const [payee, setPayee] = useState<FieldState<string>>({ enabled: false, value: '' })
  const [description, setDescription] = useState<FieldState<string>>({ enabled: false, value: '' })
  const [amount, setAmount] = useState<FieldState<string>>({ enabled: false, value: '' })
  const [categoryId, setCategoryId] = useState<FieldState<string>>({ enabled: false, value: '' })

  const selectedTxs = transactions.filter((t) => selectedIds.has(t.id) && t.type === 'transaction')
  const count = selectedTxs.length

  const mutation = useMutation({
    mutationFn: async () => {
      const amountCents = amount.enabled && amount.value
        ? Math.round(parseFloat(amount.value) * 100)
        : null

      await Promise.all(
        selectedTxs.map((tx) =>
          transactionsApi.update(tx.id, {
            date: date.enabled && date.value ? date.value : tx.date,
            accountId: accountId.enabled && accountId.value ? parseInt(accountId.value, 10) : tx.account_id,
            payee: payee.enabled ? (payee.value || null) : tx.payee,
            description: description.enabled ? (description.value || null) : tx.description,
            amount: amountCents !== null ? amountCents : tx.amount,
            categoryId: categoryId.enabled
              ? (categoryId.value === 'none' ? null : categoryId.value ? parseInt(categoryId.value, 10) : tx.category_id)
              : tx.category_id,
          }),
        ),
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      handleClose()
    },
  })

  const handleClose = () => {
    setDate({ enabled: false, value: '' })
    setAccountId({ enabled: false, value: '' })
    setPayee({ enabled: false, value: '' })
    setDescription({ enabled: false, value: '' })
    setAmount({ enabled: false, value: '' })
    setCategoryId({ enabled: false, value: '' })
    onClose()
  }

  const anyEnabled = date.enabled || accountId.enabled || payee.enabled || description.enabled || amount.enabled || categoryId.enabled

  return (
    <Modal open={open} onClose={handleClose} title={`Edit ${count} transaction${count !== 1 ? 's' : ''}`}>
      <p className="text-sm text-secondary mb-4">
        Check the fields you want to update. Unchecked fields are left as-is on each transaction.
      </p>

      <div className="space-y-3">
        {/* Date */}
        <div className="flex items-center gap-3">
          <input type="checkbox" checked={date.enabled} onChange={(e) => setDate((s) => ({ ...s, enabled: e.target.checked }))} className="w-4 h-4 accent-accent shrink-0" />
          <div className="flex-1">
            <Input
              label="Date"
              type="date"
              value={date.value}
              onChange={(e) => setDate({ enabled: true, value: e.target.value })}
              disabled={!date.enabled}
            />
          </div>
        </div>

        {/* Account */}
        <div className="flex items-center gap-3">
          <input type="checkbox" checked={accountId.enabled} onChange={(e) => setAccountId((s) => ({ ...s, enabled: e.target.checked }))} className="w-4 h-4 accent-accent shrink-0" />
          <div className="flex-1">
            <Select
              label="Account"
              value={accountId.value}
              onChange={(e) => setAccountId({ enabled: true, value: e.target.value })}
              disabled={!accountId.enabled}
            >
              <option value="">Select account…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
        </div>

        {/* Payee */}
        <div className="flex items-center gap-3">
          <input type="checkbox" checked={payee.enabled} onChange={(e) => setPayee((s) => ({ ...s, enabled: e.target.checked }))} className="w-4 h-4 accent-accent shrink-0" />
          <div className="flex-1">
            <Input
              label="Payee"
              value={payee.value}
              onChange={(e) => setPayee({ enabled: true, value: e.target.value })}
              disabled={!payee.enabled}
              placeholder="Leave blank to clear"
            />
          </div>
        </div>

        {/* Description */}
        <div className="flex items-center gap-3">
          <input type="checkbox" checked={description.enabled} onChange={(e) => setDescription((s) => ({ ...s, enabled: e.target.checked }))} className="w-4 h-4 accent-accent shrink-0" />
          <div className="flex-1">
            <Input
              label="Description"
              value={description.value}
              onChange={(e) => setDescription({ enabled: true, value: e.target.value })}
              disabled={!description.enabled}
              placeholder="Leave blank to clear"
            />
          </div>
        </div>

        {/* Amount */}
        <div className="flex items-center gap-3">
          <input type="checkbox" checked={amount.enabled} onChange={(e) => setAmount((s) => ({ ...s, enabled: e.target.checked }))} className="w-4 h-4 accent-accent shrink-0" />
          <div className="flex-1">
            <Input
              label="Amount"
              type="number"
              step="0.01"
              value={amount.value}
              onChange={(e) => setAmount({ enabled: true, value: e.target.value })}
              disabled={!amount.enabled}
              hint="Negative for expenses, positive for income"
            />
          </div>
        </div>

        {/* Category */}
        <div className="flex items-center gap-3">
          <input type="checkbox" checked={categoryId.enabled} onChange={(e) => setCategoryId((s) => ({ ...s, enabled: e.target.checked }))} className="w-4 h-4 accent-accent shrink-0" />
          <div className="flex-1">
            <Select
              label="Category"
              value={categoryId.value}
              onChange={(e) => setCategoryId({ enabled: true, value: e.target.value })}
              disabled={!categoryId.enabled}
            >
              <option value="">Select category…</option>
              <option value="none">— Uncategorised</option>
              {groups.map((group) => {
                const groupCats = categories.filter((c) => c.group_id === group.id)
                if (groupCats.length === 0) return null
                return (
                  <optgroup key={group.id} label={group.name}>
                    {groupCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                )
              })}
            </Select>
          </div>
        </div>
      </div>

      {mutation.isError && (
        <p className="mt-3 text-sm text-danger">{(mutation.error as Error).message}</p>
      )}

      <div className="flex items-center justify-end gap-3 mt-5">
        <Button variant="ghost" type="button" onClick={handleClose}>Cancel</Button>
        <Button
          type="button"
          disabled={!anyEnabled}
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Apply to {count} transaction{count !== 1 ? 's' : ''}
        </Button>
      </div>
    </Modal>
  )
}

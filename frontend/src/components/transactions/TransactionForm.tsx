import { useEffect, useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input, Select } from '../ui/Input'
import { transactionsApi, Transaction } from '../../api/transactions'
import { accountsApi } from '../../api/accounts'
import { budgetApi } from '../../api/budget'
import { payeesApi } from '../../api/payees'

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required'),
  type: z.enum(['debit', 'credit', 'transfer', 'starting_balance']),
  accountId: z.string().min(1, 'Required'),
  transferToAccountId: z.string().optional(),
  payee: z.string().optional(),
  description: z.string().optional(),
  amount: z.string().refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, 'Enter a positive amount'),
  categoryId: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  transaction?: Transaction | null
}

function PayeeCombobox({
  value,
  onChange,
  payees,
}: {
  value: string
  onChange: (v: string) => void
  payees: { id: number; name: string }[]
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const filtered = value.trim()
    ? payees.filter((p) => p.name.toLowerCase().includes(value.toLowerCase()))
    : payees

  const exactMatch = payees.some((p) => p.name.toLowerCase() === value.trim().toLowerCase())
  const showAdd = value.trim() && !exactMatch

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1">
      <label className="text-xs font-medium text-secondary uppercase tracking-wide">Payee</label>
      <input
        className="input-base"
        placeholder="Who was this from/to?"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
        autoComplete="off"
      />
      {open && (filtered.length > 0 || showAdd) && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-surface-2 border border-border rounded-lg shadow-lg overflow-hidden">
          {filtered.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-xs font-semibold text-muted uppercase tracking-wide">Payees</div>
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-surface-3 transition-colors"
                  onMouseDown={(e) => { e.preventDefault(); onChange(p.name); setOpen(false) }}
                >
                  {p.name}
                </button>
              ))}
            </>
          )}
          {showAdd && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm text-accent hover:bg-surface-3 transition-colors border-t border-border/50"
              onMouseDown={(e) => { e.preventDefault(); onChange(value.trim()); setOpen(false) }}
            >
              + Add "{value.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function deriveEditType(tx: Transaction): 'debit' | 'credit' | 'transfer' {
  if (tx.type === 'transfer') return 'transfer'
  return tx.amount < 0 ? 'debit' : 'credit'
}

export function TransactionForm({ open, onClose, transaction }: Props) {
  const qc = useQueryClient()
  const isEdit = !!transaction

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list })
  const { data: payees } = useQuery({ queryKey: ['payees'], queryFn: payeesApi.list })
  const { data: budgetWeek } = useQuery({
    queryKey: ['budget', 'categories-flat'],
    queryFn: () => budgetApi.getCategories(),
  })
  const { data: groups } = useQuery({ queryKey: ['budget', 'groups'], queryFn: budgetApi.getGroups })

  const today = new Date().toISOString().slice(0, 10)

  const { register, handleSubmit, watch, reset, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: today,
      type: 'debit',
      accountId: '',
      transferToAccountId: '',
      payee: '',
      description: '',
      amount: '',
      categoryId: '',
    },
  })

  const txType = watch('type')

  useEffect(() => {
    if (open) {
      if (transaction) {
        reset({
          date: transaction.date,
          type: deriveEditType(transaction),
          accountId: String(transaction.account_id),
          transferToAccountId: '',
          payee: transaction.payee ?? '',
          description: transaction.description ?? '',
          amount: (Math.abs(transaction.amount) / 100).toFixed(2),
          categoryId: transaction.category_id ? String(transaction.category_id) : '',
        })
      } else {
        reset({
          date: today,
          type: 'debit',
          accountId: accounts?.[0] ? String(accounts[0].id) : '',
          transferToAccountId: '',
          payee: '',
          description: '',
          amount: '',
          categoryId: '',
        })
      }
    }
  }, [open, transaction, reset, accounts, today])

  const mutation = useMutation({
    mutationFn: async (data: FormData): Promise<{ id: number; pairedId?: number }> => {
      const absAmount = Math.round(parseFloat(data.amount) * 100)
      const amount = data.type === 'credit' || data.type === 'starting_balance' ? absAmount : -absAmount

      if (isEdit) {
        const isTransfer = transaction!.type === 'transfer'
        await transactionsApi.update(transaction!.id, {
          date: data.date,
          accountId: parseInt(data.accountId, 10),
          payee: data.payee || null,
          description: data.description || null,
          // Preserve original amount and category for transfers
          amount: isTransfer ? transaction!.amount : amount,
          categoryId: isTransfer ? null : (data.categoryId ? parseInt(data.categoryId, 10) : null),
        })
        return { id: transaction!.id }
      }

      if (data.type === 'starting_balance') {
        return transactionsApi.create({
          date: data.date,
          accountId: parseInt(data.accountId, 10),
          payee: data.payee || null,
          description: data.description || null,
          amount: absAmount,
          type: 'starting_balance',
        })
      }

      return transactionsApi.create({
        date: data.date,
        accountId: parseInt(data.accountId, 10),
        payee: data.payee || null,
        description: data.description || null,
        amount,
        categoryId: data.categoryId ? parseInt(data.categoryId, 10) : null,
        type: data.type === 'transfer' ? 'transfer' : 'transaction',
        transferToAccountId: data.transferToAccountId
          ? parseInt(data.transferToAccountId, 10)
          : null,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      onClose()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => transactionsApi.delete(transaction!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      onClose()
    },
  })

  const categories = budgetWeek as Array<{ id: number; group_id: number; name: string; period: string }> | undefined

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Transaction' : 'Add Transaction'}>
      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" {...register('date')} error={errors.date?.message} />

          <Select label="Type" {...register('type')} disabled={isEdit && transaction?.type === 'transfer'}>
            <option value="debit">Debit</option>
            <option value="credit">Credit</option>
            {(!isEdit || transaction?.type === 'transfer') && (
              <option value="transfer">Transfer</option>
            )}
            {!isEdit && <option value="starting_balance">Starting Balance</option>}
          </Select>
        </div>

        <Select label="Account" {...register('accountId')} error={errors.accountId?.message}>
          <option value="">Select account...</option>
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>

        {txType === 'transfer' && !isEdit && (
          <Select label="Transfer To" {...register('transferToAccountId')}>
            <option value="">Select destination...</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        )}

        <PayeeCombobox
          value={watch('payee') ?? ''}
          onChange={(v) => setValue('payee', v)}
          payees={payees ?? []}
        />

        <Input
          label="Description"
          placeholder="Optional details"
          {...register('description')}
        />

        <Input
          label="Amount ($)"
          type="number"
          step="0.01"
          min="0.01"
          placeholder="0.00"
          disabled={isEdit && transaction?.type === 'transfer'}
          {...register('amount')}
          error={errors.amount?.message}
        />

        {txType !== 'transfer' && txType !== 'starting_balance' && (
          isEdit && transaction?.category_is_unlisted ? (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-secondary uppercase tracking-wide">Category</label>
              <div className="input-base text-sm text-muted cursor-not-allowed">
                {transaction.category_name ?? 'Uncategorised'}
              </div>
            </div>
          ) : (
            <Select label="Category (optional)" {...register('categoryId')}>
              <option value="">Uncategorised</option>
              {groups?.map((group) => {
                const groupCats = categories?.filter((c) => c.group_id === group.id) ?? []
                if (groupCats.length === 0) return null
                return (
                  <optgroup key={group.id} label={group.name}>
                    {groupCats.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                )
              })}
            </Select>
          )
        )}

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
            {isEdit ? 'Save' : 'Add'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

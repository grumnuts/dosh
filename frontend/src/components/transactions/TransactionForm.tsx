import { useEffect } from 'react'
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

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Required'),
  accountId: z.string().min(1, 'Required'),
  payee: z.string().optional(),
  description: z.string().optional(),
  amount: z.string().refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) !== 0, 'Enter a non-zero amount'),
  categoryId: z.string().optional(),
  type: z.enum(['transaction', 'transfer']),
  transferToAccountId: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  transaction?: Transaction | null
}

export function TransactionForm({ open, onClose, transaction }: Props) {
  const qc = useQueryClient()
  const isEdit = !!transaction

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list })
  const { data: budgetWeek } = useQuery({
    queryKey: ['budget', 'categories-flat'],
    queryFn: () => budgetApi.getCategories(),
  })

  const today = new Date().toISOString().slice(0, 10)

  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: today,
      accountId: '',
      payee: '',
      description: '',
      amount: '',
      categoryId: '',
      type: 'transaction',
      transferToAccountId: '',
    },
  })

  const txType = watch('type')

  useEffect(() => {
    if (open) {
      if (transaction) {
        reset({
          date: transaction.date,
          accountId: String(transaction.account_id),
          payee: transaction.payee ?? '',
          description: transaction.description ?? '',
          amount: (Math.abs(transaction.amount) / 100).toFixed(2),
          categoryId: transaction.category_id ? String(transaction.category_id) : '',
          type: 'transaction',
          transferToAccountId: '',
        })
      } else {
        reset({
          date: today,
          accountId: accounts?.[0] ? String(accounts[0].id) : '',
          payee: '',
          description: '',
          amount: '',
          categoryId: '',
          type: 'transaction',
          transferToAccountId: '',
        })
      }
    }
  }, [open, transaction, reset, accounts, today])

  const mutation = useMutation({
    mutationFn: async (data: FormData): Promise<{ id: number; pairedId?: number }> => {
      const amountCents = Math.round(parseFloat(data.amount) * 100)
      if (isEdit) {
        await transactionsApi.update(transaction!.id, {
          date: data.date,
          accountId: parseInt(data.accountId, 10),
          payee: data.payee || null,
          description: data.description || null,
          // For edit, preserve sign from original transaction
          amount: transaction!.amount < 0 ? -amountCents : amountCents,
          categoryId: data.categoryId ? parseInt(data.categoryId, 10) : null,
        })
        return { id: transaction!.id }
      }
      return transactionsApi.create({
        date: data.date,
        accountId: parseInt(data.accountId, 10),
        payee: data.payee || null,
        description: data.description || null,
        amount: amountCents,
        categoryId: data.categoryId ? parseInt(data.categoryId, 10) : null,
        type: data.type,
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

  // All categories flat for the dropdown
  const categories = budgetWeek as Array<{ id: number; group_id: number; name: string; period: string }> | undefined

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Transaction' : 'Add Transaction'}>
      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" {...register('date')} error={errors.date?.message} />

          <Select label="Type" {...register('type')} disabled={isEdit}>
            <option value="transaction">Transaction</option>
            <option value="transfer">Transfer</option>
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

        <Input
          label="Payee"
          placeholder="Who was this from/to?"
          {...register('payee')}
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
          placeholder="Enter amount (negative for expenses)"
          {...register('amount')}
          error={errors.amount?.message}
          hint={isEdit ? 'Preserves original sign (debit/credit)' : 'Negative = expense, positive = income'}
        />

        {txType === 'transaction' && (
          <Select label="Category (optional)" {...register('categoryId')}>
            <option value="">Uncategorised</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
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

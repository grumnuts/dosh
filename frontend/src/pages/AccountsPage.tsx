import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { accountsApi, Account, AccountInput } from '../api/accounts'
import { formatMoney } from '../components/ui/AmountDisplay'
import { Modal } from '../components/ui/Modal'
import { Button } from '../components/ui/Button'
import { Input, Select, Textarea } from '../components/ui/Input'

const schema = z.object({
  name: z.string().min(1, 'Required'),
  type: z.enum(['transactional', 'savings']),
  startingBalance: z.string(),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

function AccountForm({
  account,
  onClose,
}: {
  account?: Account | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const isEdit = !!account

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: account?.name ?? '',
      type: account?.type ?? 'transactional',
      startingBalance: account ? (account.startingBalance / 100).toFixed(2) : '0.00',
      notes: account?.notes ?? '',
    },
  })

  const mutation = useMutation({
    mutationFn: async (data: AccountInput): Promise<{ id: number }> => {
      if (isEdit) {
        await accountsApi.update(account!.id, data)
        return { id: account!.id }
      }
      return accountsApi.create(data)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      onClose()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => accountsApi.delete(account!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      onClose()
    },
  })

  const onSubmit = (data: FormData) => {
    mutation.mutate({
      name: data.name,
      type: data.type,
      startingBalance: Math.round(parseFloat(data.startingBalance || '0') * 100),
      notes: data.notes || null,
    })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Input label="Account Name" {...register('name')} error={errors.name?.message} autoFocus />

      <Select label="Type" {...register('type')}>
        <option value="transactional">Transactional</option>
        <option value="savings">Savings</option>
      </Select>

      <Input
        label="Starting Balance ($)"
        type="number"
        step="0.01"
        {...register('startingBalance')}
        hint="The opening balance before any transactions"
      />

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
          {isEdit ? 'Save' : 'Add Account'}
        </Button>
      </div>
    </form>
  )
}

export function AccountsPage() {
  const [modalState, setModalState] = useState<{
    open: boolean
    account?: Account | null
  }>({ open: false })

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
  })

  const totalBalance = accounts?.reduce((sum, a) => sum + a.currentBalance, 0) ?? 0
  const transactionalTotal = accounts
    ?.filter((a) => a.type === 'transactional')
    .reduce((sum, a) => sum + a.currentBalance, 0) ?? 0
  const savingsTotal = accounts
    ?.filter((a) => a.type === 'savings')
    .reduce((sum, a) => sum + a.currentBalance, 0) ?? 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-primary">Accounts</h1>
        <Button size="sm" onClick={() => setModalState({ open: true, account: null })}>
          + Add Account
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Net Worth', value: totalBalance },
          { label: 'Transactional', value: transactionalTotal },
          { label: 'Savings', value: savingsTotal },
        ].map(({ label, value }) => (
          <div key={label} className="card p-4">
            <div className="text-xs text-muted mb-1">{label}</div>
            <div className={`text-lg font-bold font-mono ${value < 0 ? 'text-danger' : 'text-accent'}`}>
              {formatMoney(value)}
            </div>
          </div>
        ))}
      </div>

      {/* Account list */}
      {isLoading ? (
        <div className="text-center py-12 text-secondary">Loading...</div>
      ) : (
        <div className="card divide-y divide-border">
          {accounts?.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between px-5 py-4 hover:bg-surface-2/50 cursor-pointer"
              onClick={() => setModalState({ open: true, account })}
            >
              <div>
                <div className="font-medium text-primary">{account.name}</div>
                <div className="text-xs text-muted mt-0.5 capitalize">{account.type}</div>
                {account.notes && (
                  <div className="text-xs text-muted mt-0.5 truncate max-w-[250px]">{account.notes}</div>
                )}
              </div>
              <div className="text-right">
                <div
                  className={`font-bold font-mono ${account.currentBalance < 0 ? 'text-danger' : 'text-primary'}`}
                >
                  {formatMoney(account.currentBalance)}
                </div>
                {account.startingBalance !== 0 && (
                  <div className="text-xs text-muted font-mono">
                    Start: {formatMoney(account.startingBalance)}
                  </div>
                )}
              </div>
            </div>
          ))}

          {accounts?.length === 0 && (
            <div className="px-5 py-12 text-center text-secondary">
              No accounts yet.
            </div>
          )}
        </div>
      )}

      <Modal
        open={modalState.open}
        onClose={() => setModalState({ open: false })}
        title={modalState.account ? 'Edit Account' : 'Add Account'}
      >
        <AccountForm
          account={modalState.account}
          onClose={() => setModalState({ open: false })}
        />
      </Modal>
    </div>
  )
}

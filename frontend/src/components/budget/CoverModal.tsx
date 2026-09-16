import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Select } from '../ui/Input'
import { formatMoney } from '../ui/AmountDisplay'
import { CategoryCombobox } from '../ui/CategoryCombobox'
import { SearchableSelect } from '../ui/SearchableSelect'
import { budgetApi, BudgetCategory } from '../../api/budget'
import { accountsApi, Account } from '../../api/accounts'

interface CoverSourceRow {
  id: string
  kind: 'account' | 'category'
  accountId: number | ''
  categoryId: number | ''
  amountStr: string
}

interface CoverModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  category: BudgetCategory
  weekStart: string
  transactionalAccounts: Account[]
  sourceCategories: BudgetCategory[]
  categoryGroups: Array<{ id: number; name: string }>
}

export function CoverModal({
  open,
  onClose,
  onSuccess,
  category,
  weekStart,
  transactionalAccounts,
  sourceCategories,
  categoryGroups,
}: CoverModalProps) {
  const qc = useQueryClient()
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  })

  const availableAccounts = accounts ?? []
  const overspendAmount = Math.abs(category.balance)
  const [destAccountId, setDestAccountId] = useState<number | ''>(transactionalAccounts[0]?.id ?? '')
  const [rows, setRows] = useState<CoverSourceRow[]>(() => {
    const initialKind = sourceCategories.length > 0 ? 'category' : 'account'
    const initialCategory = sourceCategories[0]
    const initialAccount = availableAccounts[0]

    return [{
      id: `source-${Date.now()}`,
      kind: initialKind,
      accountId: initialKind === 'account' ? (initialAccount?.id ?? '') : '',
      categoryId: initialKind === 'category' ? (initialCategory?.id ?? '') : '',
      amountStr: (Math.min(overspendAmount, initialKind === 'category' ? (initialCategory?.balance ?? overspendAmount) : (initialAccount?.currentBalance ?? overspendAmount)) / 100).toFixed(2),
    }]
  })

  const addSourceRow = () => {
    const categoryOption = sourceCategories.find((c) => !rows.some((row) => row.kind === 'category' && row.categoryId === c.id))
    const accountOption = availableAccounts.find((a) => !rows.some((row) => row.kind === 'account' && row.accountId === a.id))

    const nextKind = categoryOption ? 'category' : 'account'
    setRows((current) => [
      ...current,
      {
        id: `source-${Date.now()}-${Math.random()}`,
        kind: nextKind,
        accountId: nextKind === 'account' ? (accountOption?.id ?? '') : '',
        categoryId: nextKind === 'category' ? (categoryOption?.id ?? '') : '',
        amountStr: '0.00',
      },
    ])
  }

  const removeSourceRow = (id: string) => {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.id !== id) : current))
  }

  const updateRow = (id: string, patch: Partial<CoverSourceRow>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
  }

  const sourceStats = useMemo(() => {
    const stats = rows.map((row) => {
      const amountCents = Math.round(parseFloat(row.amountStr || '0') * 100)
      const available = row.kind === 'account'
        ? availableAccounts.find((a) => a.id === row.accountId)?.currentBalance ?? 0
        : sourceCategories.find((c) => c.id === row.categoryId)?.balance ?? 0
      return {
        row,
        amountCents,
        available,
        valid: Number.isFinite(amountCents) && amountCents > 0 && amountCents <= available,
      }
    })

    const total = stats.reduce((sum, item) => sum + item.amountCents, 0)
    return { stats, total, isValid: stats.every((item) => item.valid) && total > 0 && total <= overspendAmount }
  }, [rows, overspendAmount, availableAccounts, sourceCategories])

  const cover = useMutation({
    mutationFn: () => {
      const sources = sourceStats.stats.map((item) => ({
        kind: item.row.kind,
        amount: item.amountCents,
        ...(item.row.kind === 'account'
          ? { accountId: Number(item.row.accountId) }
          : { categoryId: Number(item.row.categoryId) }),
      }))

      return budgetApi.coverOverspend({
        categoryId: category.id,
        weekStart,
        destinationAccountId: Number(destAccountId),
        sources,
      })
    },
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

        {transactionalAccounts.length > 1 && (
          <Select
            label="Transfer to"
            value={destAccountId}
            onChange={(e) => setDestAccountId(Number(e.target.value))}
          >
            {transactionalAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-secondary uppercase tracking-wide">Sources</span>
            <button
              type="button"
              onClick={addSourceRow}
              className="text-xs text-accent hover:text-accent/80 transition-colors"
            >
              + Add source
            </button>
          </div>
          {rows.map((row, index) => {
            const selectedAccount = row.kind === 'account'
              ? availableAccounts.find((a) => a.id === row.accountId)
              : undefined
            const selectedCategory = row.kind === 'category'
              ? sourceCategories.find((c) => c.id === row.categoryId)
              : undefined
            const available = row.kind === 'account'
              ? selectedAccount?.currentBalance ?? 0
              : selectedCategory?.balance ?? 0

            return (
              <div key={row.id} className="space-y-1">
                <div className="flex gap-2 items-start">
                <Select
                  value={row.kind}
                  onChange={(e) => {
                    const nextKind = e.target.value as 'account' | 'category'
                    const nextAccount = nextKind === 'account'
                      ? (availableAccounts.find((a) => !rows.some((r) => r.id !== row.id && r.kind === 'account' && r.accountId === a.id))?.id ?? '')
                      : ''
                    const nextCategory = nextKind === 'category'
                      ? (sourceCategories.find((c) => !rows.some((r) => r.id !== row.id && r.kind === 'category' && r.categoryId === c.id))?.id ?? '')
                      : ''
                    updateRow(row.id, {
                      kind: nextKind,
                      accountId: nextKind === 'account' ? Number(nextAccount) || '' : '',
                      categoryId: nextKind === 'category' ? Number(nextCategory) || '' : '',
                      amountStr: nextKind === 'category'
                        ? (Math.min(
                            overspendAmount,
                            sourceCategories.find((sourceCategory) => sourceCategory.id === Number(nextCategory))?.balance ?? 0,
                          ) / 100).toFixed(2)
                        : '0.00',
                    })
                  }}
                  className="w-28"
                >
                  <option value="category">Category</option>
                  <option value="account">Account</option>
                </Select>

                {row.kind === 'account' ? (
                  <SearchableSelect
                    value={row.accountId === '' ? '' : String(row.accountId)}
                    onChange={(value) => updateRow(row.id, { accountId: Number(value) || '' })}
                    allLabel="Select account..."
                    className="flex-1 min-w-0 h-9"
                    items={availableAccounts.map((account) => ({ id: String(account.id), label: `${account.name} (${formatMoney(account.currentBalance)})` }))}
                  />
                ) : (
                  <div className="flex-1 min-w-0 h-9">
                    <CategoryCombobox
                      value={row.categoryId === '' ? '' : String(row.categoryId)}
                      onChange={(value) => {
                        const selectedCategory = sourceCategories.find((sourceCategory) => sourceCategory.id === Number(value))
                        updateRow(row.id, {
                          categoryId: Number(value) || '',
                          amountStr: selectedCategory
                            ? (Math.min(overspendAmount, selectedCategory.balance) / 100).toFixed(2)
                            : '0.00',
                        })
                      }}
                      categories={sourceCategories.map((sourceCategory) => ({
                        id: sourceCategory.id,
                        group_id: sourceCategory.groupId,
                        name: sourceCategory.name,
                      }))}
                      groups={categoryGroups}
                      placeholder="Select category..."
                      className="w-full h-9"
                      buttonClassName="input-base text-sm w-full h-9 text-left flex items-center"
                      balances={Object.fromEntries(sourceCategories.map((sourceCategory) => [sourceCategory.id, sourceCategory.balance]))}
                    />
                  </div>
                )}

                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={(Math.max(0, available) / 100).toFixed(2)}
                  value={row.amountStr}
                  onChange={(e) => updateRow(row.id, { amountStr: e.target.value })}
                  className="input-base text-sm text-right w-24 h-9"
                  aria-label="Amount to cover"
                />

                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSourceRow(row.id)}
                    className="mt-1 p-1 text-muted hover:text-danger transition-colors"
                    aria-label={`Remove source ${index + 1}`}
                  >
                    ×
                  </button>
                )}
                </div>

                <div className="text-xs text-secondary">
                  Available: {formatMoney(available)}
                </div>
              </div>
            )
          })}
        </div>

        <div className="rounded-lg border border-dashed border-border p-3 text-sm text-secondary">
          <div>Selected total: <span className="font-semibold text-primary">{formatMoney(sourceStats.total)}</span></div>
          <div>Remaining to cover: <span className={sourceStats.total > overspendAmount ? 'text-danger' : 'text-secondary'}>{formatMoney(Math.max(0, overspendAmount - sourceStats.total))}</span></div>
        </div>

        {cover.isError && (
          <p className="text-sm text-danger">{(cover.error as Error).message}</p>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => cover.mutate()}
            disabled={!destAccountId || !sourceStats.isValid}
            loading={cover.isPending}
          >
            Cover {formatMoney(sourceStats.total)}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

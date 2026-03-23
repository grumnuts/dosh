import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input, Select } from '../ui/Input'
import { ApiError } from '../../api/client'
import {
  rulesApi,
  type Rule,
  type RuleGroup,
  type ConditionField,
  type ActionField,
  type Operator,
  type ConditionLogic,
} from '../../api/rules'
import { accountsApi, type Account } from '../../api/accounts'
import { budgetApi } from '../../api/budget'

interface Props {
  open: boolean
  onClose: () => void
  rule?: Rule | null
  defaultGroupId?: number
  groups: RuleGroup[]
}

const CONDITION_FIELDS: { value: ConditionField; label: string }[] = [
  { value: 'payee', label: 'Payee' },
  { value: 'description', label: 'Description' },
  { value: 'amount', label: 'Amount' },
  { value: 'account', label: 'Account' },
  { value: 'category', label: 'Category' },
  { value: 'date', label: 'Date' },
]

const ACTION_FIELDS: { value: ActionField; label: string }[] = [
  { value: 'category', label: 'Category' },
  { value: 'payee', label: 'Payee' },
  { value: 'description', label: 'Description' },
  { value: 'account', label: 'Account' },
  { value: 'amount', label: 'Amount' },
  { value: 'date', label: 'Date' },
]

const ALL_OPERATORS: { value: Operator; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
]

function operatorsForField(field: ConditionField): typeof ALL_OPERATORS {
  if (field === 'amount' || field === 'account' || field === 'category') {
    return ALL_OPERATORS.filter((o) => o.value === 'is' || o.value === 'is_not')
  }
  return ALL_OPERATORS
}

interface ConditionRow { field: ConditionField; operator: Operator; value: string }
interface ActionRow { field: ActionField; value: string }

function defaultCondition(): ConditionRow {
  return { field: 'payee', operator: 'contains', value: '' }
}

function defaultAction(): ActionRow {
  return { field: 'category', value: '' }
}

function ConditionValueInput({
  field,
  value,
  onChange,
  accounts,
  categories,
  budgetGroups,
}: {
  field: ConditionField
  value: string
  onChange: (v: string) => void
  accounts: Account[]
  categories: Array<{ id: number; group_id: number; name: string }>
  budgetGroups: Array<{ id: number; name: string }>
}) {
  if (field === 'account') {
    return (
      <select className="input-base text-sm flex-1" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any account</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    )
  }
  if (field === 'category') {
    return (
      <select className="input-base text-sm flex-1" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Uncategorised</option>
        {budgetGroups.map((g) => {
          const cats = categories.filter((c) => c.group_id === g.id)
          if (cats.length === 0) return null
          return (
            <optgroup key={g.id} label={g.name}>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          )
        })}
      </select>
    )
  }
  if (field === 'amount') {
    return (
      <input
        type="number"
        step="0.01"
        min="0"
        placeholder="0.00"
        className="input-base text-sm flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  if (field === 'date') {
    return (
      <input
        type="date"
        className="input-base text-sm flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  return (
    <input
      type="text"
      className="input-base text-sm flex-1"
      placeholder="Value…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function ActionValueInput({
  field,
  value,
  onChange,
  accounts,
  categories,
  budgetGroups,
}: {
  field: ActionField
  value: string
  onChange: (v: string) => void
  accounts: Account[]
  categories: Array<{ id: number; group_id: number; name: string }>
  budgetGroups: Array<{ id: number; name: string }>
}) {
  if (field === 'account') {
    return (
      <select className="input-base text-sm flex-1" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select account…</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    )
  }
  if (field === 'category') {
    return (
      <select className="input-base text-sm flex-1" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Uncategorised</option>
        {budgetGroups.map((g) => {
          const cats = categories.filter((c) => c.group_id === g.id)
          if (cats.length === 0) return null
          return (
            <optgroup key={g.id} label={g.name}>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          )
        })}
      </select>
    )
  }
  if (field === 'amount') {
    return (
      <input
        type="number"
        step="0.01"
        min="0"
        placeholder="0.00"
        className="input-base text-sm flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  if (field === 'date') {
    return (
      <input
        type="date"
        className="input-base text-sm flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  return (
    <input
      type="text"
      className="input-base text-sm flex-1"
      placeholder="Value…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function RuleModal({ open, onClose, rule, defaultGroupId, groups }: Props) {
  const qc = useQueryClient()
  const isEdit = !!rule

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list, enabled: open })
  const { data: categoriesRaw = [] } = useQuery({ queryKey: ['budget', 'categories-flat'], queryFn: budgetApi.getCategories, enabled: open })
  const { data: budgetGroupsRaw = [] } = useQuery({ queryKey: ['budget', 'groups'], queryFn: budgetApi.getGroups, enabled: open })

  const categories = categoriesRaw as unknown as Array<{ id: number; group_id: number; name: string }>
  const budgetGroups = budgetGroupsRaw as Array<{ id: number; name: string }>

  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState<string>('')
  const [conditionLogic, setConditionLogic] = useState<ConditionLogic>('AND')
  const [isEnabled, setIsEnabled] = useState(true)
  const [conditions, setConditions] = useState<ConditionRow[]>([defaultCondition()])
  const [actions, setActions] = useState<ActionRow[]>([defaultAction()])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (rule) {
      setName(rule.name)
      setGroupId(String(rule.group_id))
      setConditionLogic(rule.condition_logic)
      setIsEnabled(rule.is_enabled)
      setConditions(rule.conditions.length > 0 ? rule.conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value })) : [defaultCondition()])
      setActions(rule.actions.length > 0 ? rule.actions.map((a) => ({ field: a.field, value: a.value })) : [defaultAction()])
    } else {
      setName('')
      setGroupId(defaultGroupId ? String(defaultGroupId) : (groups[0] ? String(groups[0].id) : ''))
      setConditionLogic('AND')
      setIsEnabled(true)
      setConditions([defaultCondition()])
      setActions([defaultAction()])
    }
  }, [open, rule, defaultGroupId, groups])

  const mutation = useMutation({
    mutationFn: async () => {
      const input = {
        name: name.trim(),
        groupId: parseInt(groupId, 10),
        conditionLogic,
        isEnabled,
        conditions,
        actions,
      }
      if (isEdit) await rulesApi.update(rule!.id, input)
      else await rulesApi.create(input)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rules'] })
      onClose()
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => rulesApi.delete(rule!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rules'] })
      onClose()
    },
  })

  const updateCondition = (i: number, patch: Partial<ConditionRow>) => {
    setConditions((prev) => prev.map((c, idx) => {
      if (idx !== i) return c
      const updated = { ...c, ...patch }
      // Reset operator if not valid for new field
      if (patch.field && !operatorsForField(updated.field).find((o) => o.value === updated.operator)) {
        updated.operator = 'is'
      }
      return updated
    }))
  }

  const updateAction = (i: number, patch: Partial<ActionRow>) => {
    setActions((prev) => prev.map((a, idx) => idx === i ? { ...a, ...patch } : a))
  }

  const canSave = name.trim() && groupId && conditions.length > 0 && actions.length > 0

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Rule' : 'Add Rule'}>
      <div className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Auto-categorise Coles" />

        <Select label="Group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>

        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-secondary uppercase tracking-wide">Enabled</span>
          <button
            type="button"
            onClick={() => setIsEnabled((v) => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isEnabled ? 'bg-accent' : 'bg-surface-3'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${isEnabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {/* Conditions */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-secondary uppercase tracking-wide">Conditions</span>
            <div className="flex rounded-md overflow-hidden border border-border text-xs">
              {(['AND', 'OR'] as ConditionLogic[]).map((logic) => (
                <button
                  key={logic}
                  type="button"
                  onClick={() => setConditionLogic(logic)}
                  className={`px-2.5 py-1 transition-colors ${conditionLogic === logic ? 'bg-accent text-black font-medium' : 'text-secondary hover:text-primary'}`}
                >
                  {logic}
                </button>
              ))}
            </div>
          </div>

          {conditions.map((cond, i) => (
            <div key={i} className="flex gap-2 items-center">
              <select
                className="input-base text-sm w-32 shrink-0"
                value={cond.field}
                onChange={(e) => updateCondition(i, { field: e.target.value as ConditionField, value: '' })}
              >
                {CONDITION_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <select
                className="input-base text-sm w-32 shrink-0"
                value={cond.operator}
                onChange={(e) => updateCondition(i, { operator: e.target.value as Operator })}
              >
                {operatorsForField(cond.field).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <ConditionValueInput
                field={cond.field}
                value={cond.value}
                onChange={(v) => updateCondition(i, { value: v })}
                accounts={accounts}
                categories={categories}
                budgetGroups={budgetGroups}
              />
              <button
                type="button"
                onClick={() => setConditions((prev) => prev.filter((_, idx) => idx !== i))}
                disabled={conditions.length <= 1}
                className="p-1 text-muted hover:text-danger disabled:opacity-30 transition-colors shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setConditions((prev) => [...prev, defaultCondition()])}
            className="text-xs text-accent hover:text-accent/80 transition-colors"
          >
            + Add condition
          </button>
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <span className="text-xs font-medium text-secondary uppercase tracking-wide">Actions</span>

          {actions.map((action, i) => (
            <div key={i} className="flex gap-2 items-center">
              <select
                className="input-base text-sm w-36 shrink-0"
                value={action.field}
                onChange={(e) => updateAction(i, { field: e.target.value as ActionField, value: '' })}
              >
                {ACTION_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <ActionValueInput
                field={action.field}
                value={action.value}
                onChange={(v) => updateAction(i, { value: v })}
                accounts={accounts}
                categories={categories}
                budgetGroups={budgetGroups}
              />
              <button
                type="button"
                onClick={() => setActions((prev) => prev.filter((_, idx) => idx !== i))}
                disabled={actions.length <= 1}
                className="p-1 text-muted hover:text-danger disabled:opacity-30 transition-colors shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setActions((prev) => [...prev, defaultAction()])}
            className="text-xs text-accent hover:text-accent/80 transition-colors"
          >
            + Add action
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2 bg-danger-muted/30 border border-danger/30 rounded-lg text-sm text-danger">
            <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2 pb-safe">
          {isEdit && (
            <Button type="button" variant="danger" onClick={() => deleteMutation.mutate()} loading={deleteMutation.isPending}>
              Delete
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!canSave} loading={mutation.isPending} onClick={() => mutation.mutate()}>
            {isEdit ? 'Save' : 'Add rule'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

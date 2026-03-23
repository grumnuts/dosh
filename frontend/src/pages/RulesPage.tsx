import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rulesApi, type Rule, type RuleGroup } from '../api/rules'
import { budgetApi } from '../api/budget'
import { accountsApi } from '../api/accounts'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { RuleModal } from '../components/rules/RuleModal'

// ─── Summary helpers ──────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  date: 'Date', account: 'Account', payee: 'Payee',
  description: 'Description', category: 'Category', amount: 'Amount',
}

const OP_LABELS: Record<string, string> = {
  is: 'is', is_not: 'is not', contains: 'contains',
  starts_with: 'starts with', ends_with: 'ends with',
}

function useNameLookup(
  accounts: Array<{ id: number; name: string }> | undefined,
  categories: Array<{ id: number; name: string }> | undefined,
): (field: string, value: string) => string {
  return (field, value) => {
    if (!value) return '(empty)'
    if (field === 'account') return accounts?.find((a) => String(a.id) === value)?.name ?? value
    if (field === 'category') return categories?.find((c) => String(c.id) === value)?.name ?? value
    if (field === 'amount') return `$${value}`
    return `"${value}"`
  }
}

function RuleSummary({ rule, lookup }: { rule: Rule; lookup: (field: string, value: string) => string }) {
  const condParts = rule.conditions.map(
    (c) => `${FIELD_LABELS[c.field] ?? c.field} ${OP_LABELS[c.operator] ?? c.operator} ${lookup(c.field, c.value)}`,
  )
  const actParts = rule.actions.map(
    (a) => `${FIELD_LABELS[a.field] ?? a.field} → ${lookup(a.field, a.value)}`,
  )
  return (
    <div className="text-xs text-secondary space-y-0.5 mt-0.5">
      <div>{condParts.join(` ${rule.condition_logic} `)}</div>
      <div className="text-muted">{actParts.join(' · ')}</div>
    </div>
  )
}

// ─── Group name modal ─────────────────────────────────────────────────────────

function GroupModal({
  open,
  onClose,
  initial,
  onSave,
  onDelete,
  loading,
  error,
}: {
  open: boolean
  onClose: () => void
  initial: string
  onSave: (name: string) => void
  onDelete?: () => void
  loading: boolean
  error?: string | null
}) {
  const [name, setName] = useState(initial)

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit Group' : 'Add Group'}>
      <div className="space-y-4" onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onSave(name.trim()) }}>
        <Input
          label="Group name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Categorisation"
          autoFocus
          key={String(open)}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex items-center justify-between pb-safe">
          {onDelete ? (
            <Button variant="ghost" type="button" className="text-danger hover:text-danger" onClick={onDelete}>
              Delete group
            </Button>
          ) : <span />}
          <div className="flex gap-3">
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button type="button" disabled={!name.trim()} loading={loading} onClick={() => onSave(name.trim())}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function RulesPage() {
  const qc = useQueryClient()

  const { data: groups = [], isLoading } = useQuery({ queryKey: ['rules'], queryFn: rulesApi.list })

  // Used for rule summaries in the list — read from cache populated by Budget/Accounts pages.
  // Not fetched here; the modal fetches them when it opens.
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list, staleTime: 30_000, enabled: false })
  const { data: categories } = useQuery({ queryKey: ['budget', 'categories-flat'], queryFn: budgetApi.getCategories, staleTime: 30_000, enabled: false })

  const lookup = useNameLookup(accounts, categories)

  const [groupModal, setGroupModal] = useState<{ open: boolean; group?: RuleGroup }>({ open: false })
  const [ruleModal, setRuleModal] = useState<{ open: boolean; rule?: Rule | null; groupId?: number }>({ open: false })
  const [runResult, setRunResult] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const createGroup = useMutation({
    mutationFn: (name: string) => rulesApi.createGroup(name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rules'] }); setGroupModal({ open: false }) },
  })

  const updateGroup = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => rulesApi.updateGroup(id, name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rules'] }); setGroupModal({ open: false }) },
  })

  const groupMutationError = (createGroup.error ?? updateGroup.error) as Error | null

  const deleteGroup = useMutation({
    mutationFn: (id: number) => rulesApi.deleteGroup(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  })

  const toggleRule = useMutation({
    mutationFn: (rule: Rule) =>
      rulesApi.update(rule.id, {
        name: rule.name,
        groupId: rule.group_id,
        conditionLogic: rule.condition_logic,
        isEnabled: !rule.is_enabled,
        conditions: rule.conditions,
        actions: rule.actions,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  })

  const runAll = useMutation({
    mutationFn: rulesApi.run,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      setRunResult(data.updatedCount)
    },
  })

  const runSingle = useMutation({
    mutationFn: (id: number) => rulesApi.runSingle(id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      setRunResult(data.updatedCount)
    },
  })

  const toggleCollapse = (id: number) =>
    setCollapsed((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-muted">Loading…</div>
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-primary">Rules</h1>
        <Button
          variant="ghost"
          onClick={() => runAll.mutate()}
          loading={runAll.isPending}
          className="text-sm"
        >
          Run all rules
        </Button>
      </div>

      {runResult !== null && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-accent-muted/30 border border-accent/30 rounded-lg text-sm text-accent">
          <span>{runResult === 0 ? 'No transactions updated.' : `${runResult} transaction${runResult !== 1 ? 's' : ''} updated.`}</span>
          <button onClick={() => setRunResult(null)} className="text-accent/60 hover:text-accent transition-colors">✕</button>
        </div>
      )}

      {groups.length === 0 && (
        <div className="text-center py-16 text-muted">
          <p className="mb-4">No rule groups yet.</p>
        </div>
      )}

      {/* Groups */}
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.id)
        return (
          <div key={group.id} className="bg-surface border border-border rounded-xl overflow-hidden">
            {/* Group header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-surface-2/50">
              <button
                onClick={() => toggleCollapse(group.id)}
                className="text-secondary hover:text-primary transition-colors"
              >
                <svg className={`w-4 h-4 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <button
                onClick={() => setGroupModal({ open: true, group })}
                className="text-sm font-semibold text-primary flex-1 text-left hover:text-accent transition-colors"
              >
                {group.name}
              </button>
            </div>

            {!isCollapsed && (
              <>
                {group.rules.length === 0 && (
                  <div className="px-4 py-3 text-sm text-muted italic">No rules in this group.</div>
                )}

                {group.rules.map((rule, i) => (
                  <div
                    key={rule.id}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-2/40 transition-colors ${i < group.rules.length - 1 ? 'border-b border-border/50' : ''}`}
                    onClick={() => setRuleModal({ open: true, rule, groupId: group.id })}
                  >
                    {/* Enabled toggle */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleRule.mutate(rule) }}
                      className={`shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${rule.is_enabled ? 'bg-accent' : 'bg-surface-3'}`}
                      title={rule.is_enabled ? 'Disable rule' : 'Enable rule'}
                    >
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${rule.is_enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                    </button>

                    <div className="flex-1 min-w-0">
                      <span className={`text-sm font-medium ${rule.is_enabled ? 'text-primary' : 'text-secondary'}`}>
                        {rule.name}
                      </span>
                      <RuleSummary rule={rule} lookup={lookup} />
                    </div>

                    <button
                      onClick={(e) => { e.stopPropagation(); runSingle.mutate(rule.id) }}
                      disabled={runSingle.isPending}
                      className="text-xs text-muted hover:text-accent transition-colors shrink-0 px-1"
                      title="Run this rule now"
                    >
                      {runSingle.isPending ? '…' : 'Run'}
                    </button>
                  </div>
                ))}

                <div className="px-4 py-2.5 border-t border-border/50">
                  <button
                    onClick={() => setRuleModal({ open: true, rule: null, groupId: group.id })}
                    className="text-sm text-muted hover:text-accent transition-colors flex items-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add rule
                  </button>
                </div>
              </>
            )}
          </div>
        )
      })}

      {/* Add group */}
      <button
        onClick={() => setGroupModal({ open: true })}
        className="w-full py-3 border border-dashed border-border rounded-xl text-sm text-muted hover:text-primary hover:border-border-2 transition-colors flex items-center justify-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add group
      </button>

      {/* Group modal */}
      <GroupModal
        open={groupModal.open}
        onClose={() => setGroupModal({ open: false })}
        initial={groupModal.group?.name ?? ''}
        loading={createGroup.isPending || updateGroup.isPending}
        error={groupMutationError?.message}
        onSave={(name) => {
          if (groupModal.group) {
            updateGroup.mutate({ id: groupModal.group.id, name })
          } else {
            createGroup.mutate(name)
          }
        }}
        onDelete={groupModal.group ? () => {
          if (confirm(`Delete group "${groupModal.group!.name}" and all its rules?`)) {
            deleteGroup.mutate(groupModal.group!.id)
            setGroupModal({ open: false })
          }
        } : undefined}
      />

      {/* Rule modal */}
      <RuleModal
        open={ruleModal.open}
        onClose={() => setRuleModal({ open: false })}
        rule={ruleModal.rule}
        defaultGroupId={ruleModal.groupId}
        groups={groups}
      />
    </div>
  )
}

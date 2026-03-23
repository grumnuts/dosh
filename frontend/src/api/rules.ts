import { api } from './client'

export type ConditionField = 'date' | 'account' | 'payee' | 'description' | 'category' | 'amount'
export type ActionField = 'date' | 'account' | 'payee' | 'description' | 'category' | 'amount'
export type Operator = 'is' | 'is_not' | 'contains' | 'starts_with' | 'ends_with'
export type ConditionLogic = 'AND' | 'OR'

export interface RuleCondition {
  id?: number
  field: ConditionField
  operator: Operator
  value: string
}

export interface RuleAction {
  id?: number
  field: ActionField
  value: string
}

export interface Rule {
  id: number
  group_id: number
  name: string
  condition_logic: ConditionLogic
  is_enabled: boolean
  sort_order: number
  conditions: RuleCondition[]
  actions: RuleAction[]
}

export interface RuleGroup {
  id: number
  name: string
  sort_order: number
  rules: Rule[]
}

export interface RuleInput {
  name: string
  groupId: number
  conditionLogic: ConditionLogic
  isEnabled: boolean
  conditions: Array<{ field: ConditionField; operator: Operator; value: string }>
  actions: Array<{ field: ActionField; value: string }>
}

export const rulesApi = {
  list: () => api.get<RuleGroup[]>('/api/rules'),
  createGroup: (name: string) => api.post<{ id: number }>('/api/rules/groups', { name }),
  updateGroup: (id: number, name: string) => api.put<{ ok: boolean }>(`/api/rules/groups/${id}`, { name }),
  deleteGroup: (id: number) => api.delete<{ ok: boolean }>(`/api/rules/groups/${id}`),
  create: (input: RuleInput) => api.post<{ id: number }>('/api/rules', input),
  update: (id: number, input: RuleInput) => api.put<{ ok: boolean }>(`/api/rules/${id}`, input),
  delete: (id: number) => api.delete<{ ok: boolean }>(`/api/rules/${id}`),
  run: () => api.post<{ updatedCount: number }>('/api/rules/run'),
  runSingle: (id: number) => api.post<{ updatedCount: number }>(`/api/rules/${id}/run`),
}

import { api } from './client'

export interface BudgetCategory {
  id: number
  name: string
  period: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually'
  budgetedAmount: number
  weeklyEquivalent: number
  spent: number
  covers: number
  balance: number
  isOverspent: boolean
  notes: string | null
  sortOrder: number
}

export interface BudgetGroup {
  id: number
  name: string
  sortOrder: number
  categories: BudgetCategory[]
}

export interface BudgetWeek {
  weekStart: string
  groups: BudgetGroup[]
  totalWeeklyBudget: number
  totalIncome: number
  unallocated: number
}

export interface CategoryInput {
  groupId: number
  name: string
  budgetedAmount: number
  period: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually'
  notes?: string | null
  sortOrder?: number
}

export interface GroupInput {
  name: string
  sortOrder?: number
}

export const budgetApi = {
  getWeek: (weekStart: string) => api.get<BudgetWeek>(`/api/budget/week/${weekStart}`),

  getGroups: () => api.get<Array<{ id: number; name: string; sort_order: number }>>('/api/budget/groups'),
  createGroup: (data: GroupInput) => api.post<{ id: number }>('/api/budget/groups', data),
  updateGroup: (id: number, data: GroupInput) => api.put<{ ok: boolean }>(`/api/budget/groups/${id}`, data),
  deleteGroup: (id: number) => api.delete<{ ok: boolean }>(`/api/budget/groups/${id}`),

  getCategories: () =>
    api.get<Array<CategoryInput & { id: number }>>('/api/budget/categories'),
  createCategory: (data: CategoryInput) => api.post<{ id: number }>('/api/budget/categories', data),
  updateCategory: (id: number, data: CategoryInput) =>
    api.put<{ ok: boolean }>(`/api/budget/categories/${id}`, data),
  deleteCategory: (id: number) => api.delete<{ ok: boolean }>(`/api/budget/categories/${id}`),

  coverOverspend: (data: {
    categoryId: number
    weekStart: string
    sourceAccountId: number
    destinationAccountId: number
  }) => api.post<{ ok: boolean; amount: number }>('/api/budget/cover', data),
}

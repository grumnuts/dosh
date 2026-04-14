import { api } from './client'

export interface BudgetCategory {
  id: number
  name: string
  period: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually'
  budgetedAmount: number
  weeklyEquivalent: number
  spent: number
  covers: number
  sweeps: number
  balance: number
  isOverspent: boolean
  notes: string | null
  sortOrder: number
  catchUp: boolean
  isInvestment: boolean
}

export interface BudgetGroup {
  id: number
  name: string
  sortOrder: number
  categories: BudgetCategory[]
}

export interface IncomeCategory {
  id: number
  name: string
  period: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually'
  received: number
  notes: string | null
  sortOrder: number
}

export interface IncomeGroup {
  id: number
  name: string
  sortOrder: number
  categories: IncomeCategory[]
}

export interface DebtCategory {
  id: number
  name: string
  period: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually'
  budgetedAmount: number
  weeklyEquivalent: number
  spent: number
  balance: number
  linkedAccountId: number
  linkedAccountBalance: number
  notes: string | null
  sortOrder: number
  catchUp: boolean
}

export interface DebtGroup {
  id: number
  name: string
  sortOrder: number
  categories: DebtCategory[]
}

export interface SavingsCategory {
  id: number
  name: string
  period: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually'
  budgetedAmount: number
  weeklyEquivalent: number
  contributed: number
  balance: number
  linkedAccountId: number
  linkedAccountBalance: number
  notes: string | null
  sortOrder: number
  catchUp: boolean
}

export interface SavingsGroup {
  id: number
  name: string
  sortOrder: number
  categories: SavingsCategory[]
}

export interface InvestmentCategory {
  id: number
  name: string
  ticker: string
  period: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually'
  budgetedAmount: number
  weeklyEquivalent: number
  spent: number
  balance: number
  isOverspent: boolean
  notes: string | null
  sortOrder: number
  catchUp: boolean
}

export interface InvestmentGroup {
  id: number
  name: string
  sortOrder: number
  categories: InvestmentCategory[]
}

export interface BudgetWeek {
  weekStart: string
  groups: BudgetGroup[]
  incomeGroups: IncomeGroup[]
  debtGroups: DebtGroup[]
  savingsGroups: SavingsGroup[]
  investmentGroups: InvestmentGroup[]
  totalWeeklyBudget: number
  totalIncome: number
  totalDebt: number
  unallocated: number
}

export interface CategoryInput {
  groupId: number
  name: string
  budgetedAmount: number
  period: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually'
  notes?: string | null
  sortOrder?: number
  catchUp?: boolean
  isInvestment?: boolean
  ticker?: string | null
}

export interface GroupInput {
  name: string
  isIncome?: boolean
  sortOrder?: number
}

export const budgetApi = {
  getWeek: (weekStart: string) => api.get<BudgetWeek>(`/api/budget/week/${weekStart}`),

  getGroups: () => api.get<Array<{ id: number; name: string; sort_order: number; is_income: number }>>('/api/budget/groups'),
  createGroup: (data: GroupInput) => api.post<{ id: number }>('/api/budget/groups', data),
  updateGroup: (id: number, data: GroupInput) => api.put<{ ok: boolean }>(`/api/budget/groups/${id}`, data),
  deleteGroup: (id: number) => api.delete<{ ok: boolean }>(`/api/budget/groups/${id}`),

  getCategories: () =>
    api.get<Array<CategoryInput & { id: number; is_investment: number; ticker: string | null }>>('/api/budget/categories'),
  createCategory: (data: CategoryInput) => api.post<{ id: number }>('/api/budget/categories', data),
  updateCategory: (id: number, data: CategoryInput) =>
    api.put<{ ok: boolean }>(`/api/budget/categories/${id}`, data),
  deleteCategory: (id: number) => api.delete<{ ok: boolean }>(`/api/budget/categories/${id}`),

  reorderGroups: (items: { id: number; sortOrder: number }[]) =>
    api.patch<{ ok: boolean }>('/api/budget/groups/reorder', items),
  reorderCategories: (items: { id: number; sortOrder: number }[]) =>
    api.patch<{ ok: boolean }>('/api/budget/categories/reorder', items),

  coverOverspend: (data: {
    categoryId: number
    weekStart: string
    sourceAccountId: number
    destinationAccountId: number
  }) => api.post<{ ok: boolean; amount: number }>('/api/budget/cover', data),

  sweepUnspent: (data: {
    categoryId: number
    weekStart: string
    amount: number
    sourceAccountId: number
    destinationAccountId: number
  }) => api.post<{ ok: boolean; amount: number }>('/api/budget/sweep', data),
}

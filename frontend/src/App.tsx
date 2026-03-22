import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { authApi } from './api/auth'
import { Layout } from './components/layout/Layout'
import { LoginPage } from './pages/LoginPage'
import { SetupPage } from './pages/SetupPage'
import { BudgetPage } from './pages/BudgetPage'
import { TransactionsPage } from './pages/TransactionsPage'
import { AccountsPage } from './pages/AccountsPage'
import { UsersPage } from './pages/UsersPage'
import { AuditPage } from './pages/AuditPage'

function AppRoutes() {
  const { user, loading } = useAuth()
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null)
  const [setupChecked, setSetupChecked] = useState(false)

  useEffect(() => {
    authApi
      .setupStatus()
      .then((res) => setNeedsSetup(res.needsSetup))
      .catch(() => setNeedsSetup(false))
      .finally(() => setSetupChecked(true))
  }, [])

  if (loading || !setupChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-accent text-2xl font-bold animate-pulse">Dosh</div>
      </div>
    )
  }

  if (needsSetup) {
    return (
      <SetupPage
        onComplete={() => {
          setNeedsSetup(false)
          // Redirect to login after setup
          window.location.href = '/login'
        }}
      />
    )
  }

  if (!user) {
    return <LoginPage />
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/budget" replace />} />
        <Route path="/budget" element={<BudgetPage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="*" element={<Navigate to="/budget" replace />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

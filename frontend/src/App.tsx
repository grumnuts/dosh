import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { authApi } from './api/auth'
import { Layout } from './components/layout/Layout'
import { LoginPage } from './pages/LoginPage'
import { SetupPage } from './pages/SetupPage'
import { BudgetPage } from './pages/BudgetPage'
import { AccountsPage } from './pages/AccountsPage'
import { SettingsPage } from './pages/SettingsPage'
import { AuditPage } from './pages/AuditPage'
import { RulesPage } from './pages/RulesPage'

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
        <img src="/DoshLogo.png" alt="Dosh" className="h-12 w-auto animate-pulse" />
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
        <Route path="/transactions" element={<Navigate to="/accounts" replace />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/users" element={<Navigate to="/settings" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/rules" element={<RulesPage />} />
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

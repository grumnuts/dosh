import { useState } from 'react'
import { authApi } from '../api/auth'
import { ApiError } from '../api/client'

interface Props {
  onComplete: () => void
}

export function SetupPage({ onComplete }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)
    try {
      await authApi.setupInit(username, password)
      onComplete()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Setup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight">
            <span className="text-accent">D</span>osh
          </h1>
          <p className="text-secondary text-sm mt-2">First-time setup</p>
        </div>

        <div className="card p-6">
          <h2 className="text-base font-semibold mb-1">Create your account</h2>
          <p className="text-sm text-secondary mb-5">
            Set up the first user. Additional users can be added later.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-secondary uppercase tracking-wide">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input-base"
                minLength={2}
                required
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-secondary uppercase tracking-wide">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-base"
                minLength={8}
                required
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-secondary uppercase tracking-wide">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="input-base"
                required
              />
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full mt-2"
            >
              {loading ? 'Setting up...' : 'Create Account'}
            </button>
          </form>
        </div>

        <p className="text-xs text-muted text-center mt-4">
          Two default accounts (Spending & Emergency) will be created automatically.
        </p>
      </div>
    </div>
  )
}

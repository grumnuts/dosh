import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { usersApi, User } from '../api/users'
import { UserRole } from '../api/auth'
import { settingsApi } from '../api/settings'
import { useAuth } from '../hooks/useAuth'
import { Modal } from '../components/ui/Modal'
import { ConfirmModal } from '../components/ui/ConfirmModal'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Input'

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function AddUserModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('admin')
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: () => usersApi.create(username, password, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      onClose()
    },
    onError: (err: Error) => setError(err.message),
  })

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate() }}
      className="space-y-4"
    >
      <Input label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint="Minimum 8 characters"
      />
      <div>
        <Select
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
        >
          <option value="admin">Admin</option>
          <option value="readonly">Read-only</option>
        </Select>
        <p className="text-xs text-muted mt-1">
          {role === 'readonly'
            ? 'Can only view the budget, ledger and reports — no edits.'
            : 'Full access to all features.'}
        </p>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-3 pt-2">
        <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Add User</Button>
      </div>
    </form>
  )
}

function ChangePasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const qc = useQueryClient()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: () => usersApi.changePassword(user.id, password),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      onClose()
    },
    onError: (err: Error) => setError(err.message),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) return setError('Passwords do not match')
    if (password.length < 8) return setError('Minimum 8 characters')
    mutation.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-secondary">
        Changing password for <strong className="text-primary">{user.username}</strong>.
        All existing sessions for this user will be invalidated.
      </p>
      <Input label="New Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      <Input label="Confirm Password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-3 pt-2">
        <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Change Password</Button>
      </div>
    </form>
  )
}

export function SettingsPage() {
  const { user: currentUser } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get })
  const { data: sysInfo } = useQuery({ queryKey: ['system-info'], queryFn: settingsApi.systemInfo })
  const updateSetting = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => settingsApi.update(key, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
  const [addOpen, setAddOpen] = useState(false)
  const [changePwUser, setChangePwUser] = useState<User | null>(null)
  const [deleteUser, setDeleteUser] = useState<User | null>(null)
  const [roleChange, setRoleChange] = useState<{ user: User; next: UserRole } | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [tokenRevealed, setTokenRevealed] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => usersApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setDeleteUser(null)
      setDeleteError('')
    },
    onError: (err: Error) => setDeleteError(err.message),
  })

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: number; role: UserRole }) => usersApi.changeRole(id, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setRoleChange(null)
    },
    onError: (err: Error) => {
      setRoleChange(null)
      alert(err.message)
    },
  })

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <h1 className="text-xl font-bold text-primary">Settings</h1>

      {/* General */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">General</h2>
        <div className="card px-5 py-4 space-y-4">
          <Select
            label="First Day of Week"
            value={settings?.week_start_day ?? '0'}
            onChange={(e) => updateSetting.mutate({ key: 'week_start_day', value: e.target.value })}
          >
            <option value="0">Sunday (Default)</option>
            <option value="1">Monday</option>
          </Select>
        </div>
      </section>

      {/* Users */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">Users</h2>
          <Button size="sm" onClick={() => setAddOpen(true)}>+ Add User</Button>
        </div>

        <div className="card divide-y divide-border">
          {isLoading ? (
            <div className="px-5 py-8 text-center text-secondary">Loading...</div>
          ) : (
            users?.map((user) => (
              <div key={user.id} className="flex items-center justify-between px-5 py-4">
                <div>
                  <div className="font-medium text-primary flex items-center gap-2">
                    {user.username}
                    {user.id === currentUser?.id && (
                      <span className="text-xs text-accent">(you)</span>
                    )}
                    <span
                      className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                        user.role === 'readonly'
                          ? 'bg-surface-2 text-muted border-border'
                          : 'bg-accent-muted text-accent border-accent/30'
                      }`}
                    >
                      {user.role === 'readonly' ? 'Read-only' : 'Admin'}
                    </span>
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    Created {format(parseISO(user.created_at), 'dd MMM yyyy')}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {user.id !== currentUser?.id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRoleChange({ user, next: user.role === 'admin' ? 'readonly' : 'admin' })}
                    >
                      {user.role === 'admin' ? 'Make Read-only' : 'Make Admin'}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setChangePwUser(user)}>
                    Change Password
                  </Button>
                  {user.id !== currentUser?.id && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => { setDeleteError(''); setDeleteUser(user) }}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Audit Log */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">Audit Log</h2>
        <div className="card px-5 py-4 flex items-center justify-between">
          <p className="text-sm text-secondary">View a full history of all changes made in Dosh.</p>
          <Button variant="ghost" size="sm" onClick={() => navigate('/audit')}>View Log</Button>
        </div>
      </section>

      {/* Read-only API */}
      {currentUser?.role === 'admin' && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">Read-only API</h2>
          <div className="card px-5 py-4 space-y-3">
            <p className="text-sm text-secondary">
              Bearer token for read-only external access to your budget, accounts, and transactions via{' '}
              <span className="font-mono text-xs text-primary">/api/ai/snapshot</span> and{' '}
              <span className="font-mono text-xs text-primary">/api/ai/transactions</span>.
            </p>
            {settings?.ai_api_token ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono bg-surface-2 rounded px-3 py-2 text-primary truncate">
                    {tokenRevealed ? settings.ai_api_token : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTokenRevealed((v) => !v)}
                  >
                    {tokenRevealed ? 'Hide' : 'Reveal'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(settings.ai_api_token!)
                      setTokenCopied(true)
                      setTimeout(() => setTokenCopied(false), 2000)
                    }}
                  >
                    {tokenCopied ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setTokenRevealed(false)
                    updateSetting.mutate({ key: 'ai_api_token', value: generateToken() })
                  }}
                >
                  Regenerate Token
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                onClick={() => updateSetting.mutate({ key: 'ai_api_token', value: generateToken() })}
                loading={updateSetting.isPending}
              >
                Generate Token
              </Button>
            )}
          </div>
        </section>
      )}

      {/* System */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">System</h2>
        <div className="card divide-y divide-border">
          <div className="flex items-center justify-between px-5 py-3">
            <span className="text-sm text-secondary">Version</span>
            <span className="text-sm font-mono text-primary">{sysInfo ? `v${sysInfo.version}` : '—'}</span>
          </div>
          <div className="flex items-center justify-between px-5 py-3">
            <span className="text-sm text-secondary">Uptime</span>
            <span className="text-sm font-mono text-primary">{sysInfo ? formatUptime(sysInfo.uptimeSeconds) : '—'}</span>
          </div>
          <div className="flex items-center justify-between px-5 py-3">
            <span className="text-sm text-secondary">Database size</span>
            <span className="text-sm font-mono text-primary">
              {sysInfo?.dbSizeBytes != null ? formatBytes(sysInfo.dbSizeBytes) : '—'}
            </span>
          </div>
        </div>
      </section>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add User">
        <AddUserModal onClose={() => setAddOpen(false)} />
      </Modal>

      {changePwUser && (
        <Modal open={true} onClose={() => setChangePwUser(null)} title="Change Password">
          <ChangePasswordModal user={changePwUser} onClose={() => setChangePwUser(null)} />
        </Modal>
      )}

      <ConfirmModal
        open={!!deleteUser}
        onClose={() => { setDeleteUser(null); setDeleteError('') }}
        onConfirm={() => deleteUser && deleteMutation.mutate(deleteUser.id)}
        title="Delete User"
        message={
          deleteError
            ? `Failed to delete "${deleteUser?.username}": ${deleteError}`
            : `Delete user "${deleteUser?.username}"? Their transactions, budget history and audit log entries will be retained but no longer attributed. This cannot be undone.`
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loading={deleteMutation.isPending}
      />

      <ConfirmModal
        open={!!roleChange}
        onClose={() => setRoleChange(null)}
        onConfirm={() => roleChange && roleMutation.mutate({ id: roleChange.user.id, role: roleChange.next })}
        title={roleChange?.next === 'readonly' ? 'Make user read-only' : 'Make user admin'}
        message={
          roleChange
            ? roleChange.next === 'readonly'
              ? `Demote "${roleChange.user.username}" to read-only? Their active sessions will be invalidated and they will lose edit access immediately.`
              : `Promote "${roleChange.user.username}" to admin? They will gain full edit access to everything in Dosh.`
            : ''
        }
        confirmLabel={roleChange?.next === 'readonly' ? 'Demote' : 'Promote'}
        cancelLabel="Cancel"
        loading={roleMutation.isPending}
      />
    </div>
  )
}

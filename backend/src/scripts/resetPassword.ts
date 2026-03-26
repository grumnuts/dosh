import argon2 from 'argon2'
import { initDb, getDb } from '../db/client'

const [, , username, newPassword] = process.argv

if (!username || !newPassword) {
  console.error('Usage: npm run reset-password -- <username> <new-password>')
  process.exit(1)
}

if (newPassword.length < 8) {
  console.error('Error: Password must be at least 8 characters')
  process.exit(1)
}

const dbPath = process.env.DB_PATH ?? './data/dosh.db'
initDb(dbPath)
const db = getDb()

const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined

if (!user) {
  console.error(`Error: User "${username}" not found`)
  process.exit(1)
}

argon2.hash(newPassword).then((hash) => {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id)
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)
  console.log(`Password reset for "${username}". All sessions invalidated.`)
})

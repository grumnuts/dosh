import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'

let db: DatabaseSync

export function getDb(): DatabaseSync {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.')
  }
  return db
}

export function initDb(dbPath: string): DatabaseSync {
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  db = new DatabaseSync(dbPath)

  // Performance and safety settings
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')

  runMigrations(db)

  return db
}

function runMigrations(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)

  // Migrations are in src/db/migrations (dev) or dist/migrations (prod)
  const candidates = [
    path.join(__dirname, 'migrations'),
    path.join(__dirname, '..', 'migrations'),
  ]
  const migrationsDir = candidates.find((p) => fs.existsSync(p)) ?? candidates[0]

  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found. Searched: ${candidates.join(', ')}`)
  }

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of migrationFiles) {
    const version = parseInt(file.split('_')[0], 10)
    const already = database
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get(version)

    if (!already) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      database.exec(sql)
      database
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(version, new Date().toISOString())
      console.log(`Applied migration: ${file}`)
    }
  }
}

export function hasUsers(): boolean {
  const row = getDb().prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
  return row.count > 0
}

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('transactional', 'savings')),
  starting_balance INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES budget_groups(id),
  name TEXT NOT NULL,
  budgeted_amount INTEGER NOT NULL DEFAULT 0,
  period TEXT NOT NULL DEFAULT 'weekly' CHECK(period IN ('weekly', 'fortnightly', 'monthly', 'quarterly', 'annually')),
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Tracks historical budget amounts. When a budget amount changes, a new record
-- is inserted with effective_from = current week start (Sunday). Historical
-- views look up the amount effective at that point in time.
CREATE TABLE IF NOT EXISTS budget_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES budget_categories(id),
  budgeted_amount INTEGER NOT NULL,
  period TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  payee TEXT,
  description TEXT,
  amount INTEGER NOT NULL,
  category_id INTEGER REFERENCES budget_categories(id),
  -- 'transaction': regular, 'transfer': account transfer, 'cover': overspend cover
  type TEXT NOT NULL DEFAULT 'transaction' CHECK(type IN ('transaction', 'transfer', 'cover')),
  transfer_pair_id INTEGER REFERENCES transactions(id),
  -- For cover type: the Sunday of the week whose overspend is being covered
  cover_week_start TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  username TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_cover ON transactions(cover_week_start, category_id, type);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_occurred_at ON audit_log(occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_budget_history_lookup ON budget_history(category_id, effective_from);

-- Add 'sweep' to the allowed transaction types.
-- SQLite doesn't support ALTER COLUMN, so the transactions table is recreated.
-- The self-referential transfer_pair_id FK is dropped to avoid rename issues;
-- the application manages that relationship in code.

PRAGMA foreign_keys = OFF;

CREATE TABLE transactions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  payee TEXT,
  description TEXT,
  amount INTEGER NOT NULL,
  category_id INTEGER REFERENCES budget_categories(id),
  -- 'transaction': regular, 'transfer': account transfer, 'cover': overspend cover, 'sweep': sweep unspent to savings
  type TEXT NOT NULL DEFAULT 'transaction' CHECK(type IN ('transaction', 'transfer', 'cover', 'sweep')),
  transfer_pair_id INTEGER,
  cover_week_start TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  ignore_rules INTEGER NOT NULL DEFAULT 0
);

INSERT INTO transactions_new SELECT * FROM transactions;
DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_cover ON transactions(cover_week_start, category_id, type);

PRAGMA foreign_keys = ON;

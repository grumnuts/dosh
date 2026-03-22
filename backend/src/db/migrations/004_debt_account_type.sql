-- Add 'debt' as a valid account type
-- SQLite doesn't support ALTER COLUMN, so we recreate the accounts table

PRAGMA foreign_keys = OFF;

CREATE TABLE accounts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('transactional', 'savings', 'debt')),
  starting_balance INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO accounts_new SELECT * FROM accounts;

DROP TABLE accounts;

ALTER TABLE accounts_new RENAME TO accounts;

PRAGMA foreign_keys = ON;

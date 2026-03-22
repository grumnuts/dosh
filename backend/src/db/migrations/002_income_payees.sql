-- Add income group flag to budget_groups
ALTER TABLE budget_groups ADD COLUMN is_income INTEGER NOT NULL DEFAULT 0;

-- Payees table for autocomplete and future reports/automations
CREATE TABLE IF NOT EXISTS payees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payees_name ON payees(name);

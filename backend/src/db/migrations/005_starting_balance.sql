-- Add is_system flag to budget_categories (system categories cannot be deleted)
ALTER TABLE budget_categories ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;

-- Ensure the income group exists
INSERT INTO budget_groups (name, is_income, sort_order, created_at, updated_at)
SELECT 'Income', 1, 0, datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM budget_groups WHERE is_income = 1);

-- Insert the Starting Balance system category under the income group
INSERT INTO budget_categories (group_id, name, budgeted_amount, period, is_system, sort_order, created_at, updated_at)
SELECT
  (SELECT id FROM budget_groups WHERE is_income = 1 ORDER BY id LIMIT 1),
  'Starting Balance',
  0,
  'weekly',
  1,
  -1,
  datetime('now'),
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM budget_categories WHERE name = 'Starting Balance' AND is_system = 1
);

-- Migrate existing starting_balance amounts to transactions
INSERT INTO transactions (date, account_id, amount, category_id, type, created_at, updated_at)
SELECT
  date(a.created_at),
  a.id,
  a.starting_balance,
  (SELECT id FROM budget_categories WHERE name = 'Starting Balance' AND is_system = 1),
  'transaction',
  a.created_at,
  a.created_at
FROM accounts a
WHERE a.starting_balance != 0 AND a.is_active = 1;

-- Reset starting_balance to 0 now that it's captured as a transaction
UPDATE accounts SET starting_balance = 0 WHERE starting_balance != 0;

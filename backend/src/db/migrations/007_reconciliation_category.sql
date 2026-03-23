-- Add is_unlisted flag: unlisted categories are hidden from the budget view and
-- category dropdowns but can still be assigned to system-generated transactions.
ALTER TABLE budget_categories ADD COLUMN is_unlisted INTEGER NOT NULL DEFAULT 0;

-- Starting Balance is a system category that should not appear in the UI
UPDATE budget_categories SET is_unlisted = 1 WHERE name = 'Starting Balance' AND is_system = 1;

-- Add the Reconciliation system category under the income group
INSERT INTO budget_categories (group_id, name, budgeted_amount, period, is_system, is_unlisted, sort_order, created_at, updated_at)
SELECT
  (SELECT id FROM budget_groups WHERE is_income = 1 ORDER BY id LIMIT 1),
  'Reconciliation',
  0,
  'weekly',
  1,
  1,
  -2,
  datetime('now'),
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM budget_categories WHERE name = 'Reconciliation' AND is_system = 1
);

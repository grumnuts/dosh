-- Add savings and investments flags to budget_groups
ALTER TABLE budget_groups ADD COLUMN is_savings INTEGER NOT NULL DEFAULT 0;
ALTER TABLE budget_groups ADD COLUMN is_investments INTEGER NOT NULL DEFAULT 0;

-- Add ticker to budget_categories (for investment categories — ticker stored on category, not transaction)
ALTER TABLE budget_categories ADD COLUMN ticker TEXT;

-- Seed the Savings group
INSERT INTO budget_groups (name, is_savings, is_income, is_debt, is_investments, is_active, sort_order, created_at, updated_at)
SELECT 'Savings', 1, 0, 0, 0, 1,
  COALESCE((SELECT MAX(sort_order) FROM budget_groups), -1) + 1,
  datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM budget_groups WHERE is_savings = 1);

-- Seed the Investments group
INSERT INTO budget_groups (name, is_savings, is_income, is_debt, is_investments, is_active, sort_order, created_at, updated_at)
SELECT 'Investments', 0, 0, 0, 1, 1,
  COALESCE((SELECT MAX(sort_order) FROM budget_groups), -1) + 1,
  datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM budget_groups WHERE is_investments = 1);

-- Auto-create linked categories in the Savings group for existing savings accounts
INSERT INTO budget_categories (group_id, name, budgeted_amount, period, linked_account_id, is_system, sort_order, created_at, updated_at)
SELECT
  (SELECT id FROM budget_groups WHERE is_savings = 1 LIMIT 1),
  a.name,
  0,
  'monthly',
  a.id,
  1,
  a.sort_order,
  datetime('now'),
  datetime('now')
FROM accounts a
WHERE a.type = 'savings'
  AND a.is_active = 1
  AND NOT EXISTS (
    SELECT 1 FROM budget_categories bc
    JOIN budget_groups bg ON bc.group_id = bg.id
    WHERE bc.linked_account_id = a.id AND bg.is_savings = 1
  );

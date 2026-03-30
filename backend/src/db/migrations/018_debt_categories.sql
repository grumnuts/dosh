-- Add is_debt flag to budget_groups (mirrors is_income)
ALTER TABLE budget_groups ADD COLUMN is_debt INTEGER NOT NULL DEFAULT 0;

-- Link a budget category to a debt account (auto-created on account creation)
ALTER TABLE budget_categories ADD COLUMN linked_account_id INTEGER REFERENCES accounts(id);

-- Seed exactly one Debt group
INSERT INTO budget_groups (name, is_debt, is_income, sort_order, is_active, created_at, updated_at)
SELECT 'Debt', 1, 0, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM budget_groups), 1, datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM budget_groups WHERE is_debt = 1);

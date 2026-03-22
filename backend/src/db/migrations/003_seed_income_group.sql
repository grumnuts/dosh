-- Ensure there is always exactly one income group
INSERT INTO budget_groups (name, is_income, sort_order, created_at, updated_at)
SELECT 'Income', 1, 0, datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM budget_groups WHERE is_income = 1);

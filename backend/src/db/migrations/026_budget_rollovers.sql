-- Budget rollovers: tracks unspent balance rolled forward from one period to the next.
-- No money moves between accounts — this is a pure budget accounting record.
-- source_week_start: the weekStart of the period being rolled from.
-- dest_period_start: the first calendar day of the destination period (e.g. 2026-04-01 for April).

CREATE TABLE budget_rollovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES budget_categories(id),
  source_week_start TEXT NOT NULL,
  dest_period_start TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id)
);

CREATE UNIQUE INDEX idx_budget_rollovers_source ON budget_rollovers(category_id, source_week_start);
CREATE INDEX idx_budget_rollovers_dest ON budget_rollovers(category_id, dest_period_start);

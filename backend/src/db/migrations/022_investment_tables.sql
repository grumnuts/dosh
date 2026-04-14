CREATE TABLE IF NOT EXISTS investment_holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL COLLATE NOCASE,
  quantity REAL NOT NULL DEFAULT 0,
  cost_basis_cents INTEGER NOT NULL DEFAULT 0,
  UNIQUE(account_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_investment_holdings_account
  ON investment_holdings(account_id);

-- Latest cached price per ticker (for live display)
CREATE TABLE IF NOT EXISTS share_prices (
  ticker TEXT PRIMARY KEY COLLATE NOCASE,
  name TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  last_updated TEXT NOT NULL
);

-- Monthly price snapshots — accumulated over time for net worth history
CREATE TABLE IF NOT EXISTS share_price_history (
  ticker TEXT NOT NULL COLLATE NOCASE,
  month TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  PRIMARY KEY (ticker, month)
);

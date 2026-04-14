ALTER TABLE transactions ADD COLUMN investment_ticker TEXT;
ALTER TABLE transactions ADD COLUMN investment_quantity REAL;

CREATE INDEX IF NOT EXISTS idx_transactions_investment
  ON transactions(account_id, investment_ticker)
  WHERE investment_ticker IS NOT NULL;

ALTER TABLE transactions ADD COLUMN investment_trade_value_cents INTEGER;
ALTER TABLE transactions ADD COLUMN investment_fee_cents INTEGER NOT NULL DEFAULT 0;

UPDATE transactions
SET investment_trade_value_cents = ABS(amount),
    investment_fee_cents = 0
WHERE investment_ticker IS NOT NULL
  AND investment_quantity IS NOT NULL
  AND investment_trade_value_cents IS NULL;

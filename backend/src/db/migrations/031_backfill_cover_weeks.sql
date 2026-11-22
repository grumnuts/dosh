-- Backfill the week being covered for legacy cover transactions that predate
-- cover_week_start being populated by the cover route.
UPDATE transactions
SET cover_week_start = date(date, '-' || CAST(strftime('%w', date) AS INTEGER) || ' days')
WHERE type = 'cover' AND (cover_week_start IS NULL OR cover_week_start = '');

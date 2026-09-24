-- Normalize legacy cover rows that used an empty string instead of a week start.
UPDATE transactions
SET cover_week_start = date(date, '-' || CAST(strftime('%w', date) AS INTEGER) || ' days')
WHERE type = 'cover' AND cover_week_start = '';

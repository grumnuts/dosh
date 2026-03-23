# Release Notes

## Unreleased

---

## v1.0.1 — 2026-03-23

### Bug Fixes
- Fixed container failing to start when a named Docker volume is mounted at `/data` — volume directories are created as `root:root` by the Docker daemon, causing the non-root `dosh` user to be unable to open the database file

---

## v1.0.0 — 2026-03-23

### New Features
- Zero-based envelope budgeting with weekly (Sunday–Saturday) budget periods
- Budget categories with weekly, fortnightly, monthly, quarterly, and annual periods; spent resets at the end of each category's own period
- Weekly equivalent column — fixed formula per period (weekly = budgeted amount, fortnightly = amount × 2, monthly = (amount × 12) ÷ 52, quarterly = (amount × 4) ÷ 52, annually = amount ÷ 52); planning only, does not affect balances
- Budget history — amount changes only affect the current and future weeks; past weeks reflect the amount that was set at the time
- Cover overspend — transfer from a savings account to cover an overspent category; creates a tagged transfer transaction
- Account management — transactional, savings, and debt accounts with calculated current balances
- Reconciliation — enter your actual bank balance to create a reconciliation adjustment transaction
- Starting Balance — set an opening balance when creating an account, or add one later via the transaction type selector
- Transactions list with inline category assignment; filter by date, account, category, or search by payee/description/amount
- CSV import wizard — column mapping, date format selector (DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD), duplicate detection by date and amount
- Bulk transaction actions — select multiple transactions to delete or reassign category
- Multi-user support with argon2 password hashing and httpOnly cookie sessions (30-day expiry)
- First-run setup wizard — creates the first user and two default accounts
- Audit log tracking all data and user events
- Dark mode UI with green accent colour
- Mobile-friendly layout — sidebar navigation on desktop, bottom navigation on mobile
- Docker deployment — single container, SQLite database, persistent named volume

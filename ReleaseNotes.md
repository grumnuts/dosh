# Release Notes

## Unreleased

---

## v1.4.0 — 2026-03-24

### New Features
- Reports section with four tabs: Cashflow (spending by category, in vs out, net worth, and account balances), Overspend (categories and months where spending exceeded budget), Payees (income and expenses per payee with search), and Goals (savings account balance history with projections to goal)
- Drag-to-reorder budget groups and categories on the budget page (desktop only) — grip handles appear on hover, order is persisted
- Resizable columns on all tables (desktop only) — drag the right edge of any column header to resize; widths are saved per table across sessions

### Enhancements
- Wider desktop layout (up from 1024px to 1280px max width) across Budget, Accounts, and Reports pages

---

## v1.3.1 — 2026-03-23

### Bug Fixes
- Fixed false positive conflict detection for rules using `contains`, `starts_with`, or `ends_with` conditions on the same field with different values (e.g. "Description contains CENTRELINK" no longer conflicts with "Description contains WESTPAC CARDS")

---

## v1.3.0 — 2026-03-23

### New Features
- Rules engine — create rule groups with AND/OR conditions (date, account, payee, description, category, amount) and multiple actions (set any field); rules apply automatically on transaction creation and CSV import, and can be run on-demand against all transactions (all rules or a single rule)
- Searchable category combobox in the transaction editor and the inline category column on the transactions list
- "Split..." option in the inline category combobox opens the transaction editor directly in split mode

### Bug Fixes
- Cover (overspend) transactions can now be selected and deleted; deleting a cover reverts the category balance to negative

### Enhancements
- Category balance shown in orange when it falls below 10% of the budgeted amount

---

## v1.2.1 — 2026-03-23

### Bug Fixes
- Fixed "Invalid input" error when saving an edited transaction — the update endpoint rejected an empty splits array, causing all non-split edits to fail
- Fixed a stray "0" appearing in the transaction edit form for transactions with a non-unlisted category

---

## v1.2.0 — 2026-03-23

### New Features
- Transactions list is now paginated — 100 items per page with previous/next controls and an X–Y of Z counter; page resets automatically when filters change

### Bug Fixes
- Description column is now a fixed width so it no longer pushes the Category column off-screen on wide viewports

---

## v1.1.0 — 2026-03-23

### New Features
- Split transactions — assign a single transaction across multiple categories with individual amounts and optional notes
- "Split..." option in the inline category dropdown on the transactions list, opening the transaction editor directly in split mode

### Enhancements
- Collapsed/expanded state for budget groups and page sections is now remembered across navigation
- Period badges (wk / fn / mo / qtr / yr) are now colour-coded and visible on mobile

### Bug Fixes
- Weekly equivalent now rounds up (ceiling), so the displayed weekly amount never underestimates the true weekly cost

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

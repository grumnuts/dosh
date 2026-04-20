# Release Notes

## Unreleased

### New Features
- Budget: roll forward a category's remaining balance to the next period; supports partial amounts and is fully undoable
- Budget: cover, sweep, and roll forward actions are now always-visible icon buttons on desktop (replacing context menus); roll forward and undo roll are accessible via the category modal on mobile

---

## v1.13.2 — 2026-04-17

### New Features
- Portfolio Breakdown: assets can now be excluded from the breakdown; excluded assets are hidden by default with a toggle to show/re-add them; exclusions persist across sessions
- Ledger filter: added a "No payee" option to the payee filter to show only transactions with no payee set

### Enhancements
- Ledger mobile view: payee is now the primary field on each transaction row, with account name shown below; falls back to description if no payee is set, or "Transfer" for transfer transactions
- Ledger desktop: closing the filter panel now clears all active filters

### Bug Fixes
- Ledger mobile view: transfer transactions no longer show "Uncategorised" as a category label

---

## v1.13.1 — 2026-04-16

### Bug Fixes
- Fixed Reports page rendering a black screen after navigating to it — caused by a React hooks violation introduced in v1.13.0

---

## v1.13.0 — 2026-04-16

### New Features
- Investments report now shows a portfolio value-over-time chart; clicking a holding focuses the chart on that ticker
- New Portfolio Breakdown section shows each asset as a percentage of total assets; investment tickers are listed individually
- Receipt attachments for transactions — attach JPEG, PNG, WebP, GIF, or PDF files (up to 10 MB) to any transaction; receipts are stored on the server and viewable inline; a paperclip icon appears on transaction rows that have attachments
- "Has receipts" filter on the transaction list — show only transactions with attachments

### Bug Fixes
- In vs Out report query simplified to correctly capture all cash flows; excludes system-category entries (starting balance, reconciliation) rather than filtering by category type
- Fixed Rules page group edit modal pre-populating with the wrong group name
- Fixed false positive conflict detection for OR-logic rules whose conditions are on different fields than the existing rule
- Fixed reconciliation with a past date incorrectly including post-date transactions in the balance calculation, causing the adjustment to offset the current balance
- Fixed predicted payoff/goal date displaying as YYYY-MM; now shown as MM/YY
- Fixed investment cost basis showing $0 when a purchase was entered as a credit transaction; cost basis now uses ABS(amount) weighted by quantity sign, correct regardless of debit or credit entry
- Fixed sell transactions not reducing holdings quantity; credit (sell) transactions now correctly negate the quantity
- Refreshing prices now also recalculates all holdings cost basis, fixing any stale data
- Fixed Contributed column header not shown on mobile in the Savings & Investments section

---

## v1.12.1 — 2026-04-15

### Enhancements
- In vs Out report now includes all cash flows — transfers, covers, and sweeps are counted alongside income and expenses

### Bug Fixes
- Ledger net worth now includes current investment portfolio value
- Account balances chart Y-axis no longer shows duplicate tick labels; values ≥ $1M now display as `$1M` instead of `$1000k`
- Overspend report now uses the budget amount in effect at the time of each period rather than an averaged historical amount — fixes false overspend on categories whose budget was ever changed
- Budget page modals now appear correctly on mobile when the week navigation bar is visible

---

## v1.12.0 — 2026-04-15

### New Features
- **Investment tracking** — mark a budget category as an investment and associate a ticker; buy and sell transactions record quantity held; a portfolio view in Reports shows holdings, current price, market value, and gain/loss
- **Savings & Investments section on the Budget page** — investment categories appear alongside savings accounts at the bottom of the budget view, with budgeted contribution, spent, and balance columns
- **Portfolio value chart** — historical portfolio value per ticker plotted over time, shown in the Portfolio tab of Reports
- **New Portfolio tab on the Reports page** — groups Net Worth, Account Balances, Goals, and Investments into one place
- **Income by Category report** in the Cashflow tab — stacked bar chart broken down by income group, with a full 12-month category table on desktop and a month-selector breakdown on mobile

### Enhancements
- Reports page reorganised: Cashflow tab now contains Spending by Category, Overspend, Income by Category, In vs Out, and Payees; Goals and Investments moved under the Portfolio tab alongside Net Worth and Account Balances
- In vs Out account filter replaced with a left-side account list (same style as Payees) — "All accounts" selected by default
- Cashflow section order updated: Spending by Category → Overspend → Income by Category → In vs Out → Payees
- Net Worth chart now appears above the summary stat cards
- Net Worth line colour turns red when net worth is negative or trending down month-over-month
- Account balances chart Y-axis now always includes $0 when an individual account is selected, with clean tick intervals
- Net worth, assets, and liabilities charts Y-axis domain now always extends down to $0 (or below for negative balances)
- Goal charts now use a custom solid/dashed line legend instead of the Recharts default
- Debt started date can now be edited from the debt account editor
- Navigation "Accounts" renamed to "Ledger"

### Bug Fixes
- Categorised debt payments are now correctly included in goal payoff projections
- Debt current balance in goal projections now calculated correctly
- In vs Out now correctly handles split transactions
- Closed savings accounts no longer shown in the Budget page Savings & Investments section
- Portfolio holdings correctly aggregate per ticker across all accounts
- Modal scroll lock on mobile now preserves the page scroll position when the modal is closed
- Modal bottom padding on mobile increased to clear the bottom navigation bar
- Investment quantity field now supports up to 10 decimal places

---

## v1.11.1 — 2026-04-12

### Bug Fixes
- Account balances chart now supports clicking a row to isolate that account and auto-scale the Y-axis — makes changes in smaller accounts visible alongside large ones like superannuation
- Sidebar now correctly stays fixed while page content scrolls on desktop
- Debt payoff projections now appear correctly when the account was created in the same month as the first payments
- Overspend report now shows one summarised row per category for the full year instead of a separate row per budget period
- Week navigation on the budget page now animates with a slide transition on mobile

---

## v1.11.0 — 2026-04-12

### New Features
- Sweep unspent balance to savings — when a category has leftover budget, a **Sweep** button appears on hover (desktop) or in the category editor (mobile). Enter an amount, select the spending and savings accounts, and the unspent money is transferred out and the category balance reduced accordingly

### Bug Fixes
- Overspend report: credit and refund transactions now reduce the reported spent amount for a category, instead of being ignored
- Overspend report: weekly and fortnightly categories are now compared per-week (and per-fortnight) instead of being averaged across the month — individual overspent weeks now appear correctly
- Overspend report: now shows one summarised row per category for the full year, instead of a separate row per budget period
- In vs Out report: starting balance and reconciliation transactions are now excluded, so the chart reflects real income and expenses only
- Sweep transactions now display in grey like cover and transfer amounts in the transaction list
- Sidebar now stays fixed while page content scrolls on desktop — main content area scrolls independently

---

## v1.10.1 — 2026-04-12

### Enhancements
- Swipe left/right on the Budget page to navigate between weeks on mobile
- Cover button now appears in the category editor modal on mobile when the category is overspent — no need to close the modal to cover an overspend
- Mobile nav bar height increased for easier tapping
- Long press on budget group rows and account rows now reliably opens the editor — fixed text-selection interference by adding CSS user-select: none and reducing the trigger threshold to 600ms

---

## v1.10.0 — 2026-04-12

### Enhancements
- Rebuilt mobile UI: bottom tab bar navigation replaces the top header; More menu is a bottom popup above the nav bar for easier one-handed use
- Floating action button (FAB) on the Budget and Accounts pages on mobile — tap to expand a speed dial with quick access to common actions (add group, category, transaction, account, import, reconcile)
- Budget page week navigation is now a fixed bar above the mobile nav; tap the week label to jump to the current week; current week is highlighted in green
- Budget group rows support long-press (1 second) to open the group editor on mobile; quick tap collapses/expands categories
- Account rows support long-press (1 second) to open the account editor on mobile; quick tap filters the transaction list to that account
- Budget table on mobile hides the Spent column (expense groups) and Outstanding column (debt groups) to maximise category name space
- Transaction filters on mobile now open as a modal instead of an inline panel
- Tapping an account on mobile instantly filters the transaction list without opening the filter modal
- Edit button on budget group rows moved to desktop only; period indicators moved to the left of category names with fixed width
- Cash Flow report In vs Out now includes all transaction types (starting balances, reconciliation, etc.) — transfers remain excluded
- Debt Payment budget table columns (Budgeted, Weekly, Paid, Outstanding) now align with the expense table columns

### Bug Fixes
- Closing the search bar on the Accounts page now clears the active search filter
- Debt accounts with only one month of transaction history now correctly show payoff projections in the Goals report
- Filtering by uncategorised transactions now clears automatically when the last uncategorised transaction is categorised
- Changing an existing account type to Debt now correctly creates the linked budget category
- Budget page now updates immediately after adding or modifying an account — no manual refresh required

---

## v1.9.3 — 2026-04-10

### New Features
- Accounts can now be closed — funds are transferred to another account before closing, and closed accounts are hidden from the UI with a toggle to show them
- Category balances are now shown next to category names in all dropdowns throughout the app
- Delete buttons throughout the app (accounts, transactions, categories, groups, rules) now show a confirmation prompt before deleting

### Bug Fixes
- Credit transactions (e.g. refunds) now correctly reduce category spent and update the balance
- New payees added during a transaction are now available immediately in subsequent modals — no page refresh required

### Enhancements
- Budget page footer no longer shows the unallocated amount — only the total weekly allocation is displayed
- Goal cards with a target date now show the weekly contribution needed to reach the goal on time

---

## v1.9.2 — 2026-04-05

### Bug Fixes
- Cover transactions can now be deleted — click the row to open a read-only modal with a delete button, or select via checkbox for bulk delete
- Cover transactions can now have their date and account edited — the date update applies to both legs
- Covers on non-weekly categories (monthly, quarterly, annually, fortnightly) now persist for the full period, not just the week they were created
- Dates now use server/browser local time instead of UTC, fixing incorrect "today" in non-UTC timezones (e.g. dates showing as yesterday before 10am in UTC+10)
- Settings page now correctly reflects the current version number

---

## v1.9.1 — 2026-04-04

### Bug Fixes
- Category filter now includes split transactions where at least one split matches the selected category

---

## v1.9.0 — 2026-04-04

### New Features
- Transactions can now be retyped as a transfer when editing — changing away from transfer removes the paired leg
- Running balance column on the desktop transaction table, toggled via a slider next to the Uncategorised button — hidden by default, state persists across sessions

### Bug Fixes
- Running balance is now computed server-side per account, making it accurate on any page and with any filter applied, and automatically correct after adding, editing, or deleting transactions
- Preserve debit/credit sign when retyping a transaction as transfer (was incorrectly flipping debits to positive, inflating account balances)

---

## v1.8.2 — 2026-04-01

### Bug Fixes
- Debt Payments table no longer shows the Balance column header on mobile — only Outstanding is shown, matching the data rows

---

## v1.8.1 — 2026-04-01

### Bug Fixes
- Debt category rows on mobile no longer show the balance column — only outstanding is shown, preventing horizontal scroll

---

## v1.8.0 — 2026-03-31

### New Features
- Debt accounts now have auto-created budget categories — payments categorised to a debt category reduce the account balance, with a dedicated Debt Payments section in the budget alongside Income
- Client IP address recorded in the audit log for all user actions
- Failed login attempts logged in the audit trail
- Ignore Rules toggle on the transaction form and bulk edit — skip automatic rule application per transaction

### Bug Fixes
- Transaction rules now always override existing field values, including an already-set category
- Rules now applied when saving a transaction with no category set

### Enhancements
- System section added to Settings for week start day and dynamic calculations configuration

---

## v1.7.0 — 2026-03-30

### New Features
- Searchable category, account, and payee filters on the transactions list — static selects replaced with comboboxes; account and payee filters added end-to-end (backend + frontend)
- Goal target date on savings accounts — set a target month/year; the Goals report shows "On track" or "Off track" based on the projected balance trend
- Debt payoff projections in the Goals report — active debt accounts now appear alongside savings goals with balance history and a projected paid-off date

### Bug Fixes
- Payee filter options sourced from the transactions table instead of the payees table — CSV-imported payees that bypassed the payees upsert now appear correctly in the dropdown
- Opening searchable filter dropdowns no longer causes a scroll jump

### Enhancements
- Number input spinners hidden globally for cleaner numeric fields
- Per-field clear button on searchable filter dropdowns (category, account, payee)

---

## v1.6.0 — 2026-03-28

### New Features
- Per-category catch-up toggle — when enabled on a category, the weekly equivalent is recalculated from the most recent budget change to the end of the period, so mid-period adjustments spread correctly across remaining weeks rather than inflating totals
- CLI password reset script — run `npm run reset-password -- <username> <password>` (dev) or via `docker exec` (production) to reset a password without logging in

### Bug Fixes
- Fortnightly categories used the wrong monthly equivalent in the Overspend report (×52 instead of ×26), causing the threshold to be doubled and overspend to never appear
- Net Worth report showed $0 for accounts in months before their first transaction instead of the account's starting balance
- Income categories ignored the configured week-start day when calculating period boundaries, defaulting to Sunday regardless of settings
- Starting balance transactions on debt accounts now preserve the correct sign instead of always being forced positive
- Bulk deleting cover transactions is now blocked with a clear error — covers must be removed individually to keep budget state consistent

### Enhancements
- Login page now shows the full Dosh logo instead of text branding
- Clicking an account row now filters the transaction list to that account; clicking again clears the filter. An edit icon button replaces the previous row-click-to-edit behaviour
- CSV import duplicate detection now matches on date + amount + payee when a payee is present, reducing false positives when two legitimate same-day same-amount transactions exist
- Budget week calculations batch all history, spent, covers, and received queries instead of issuing multiple queries per category
- Muted text color lightened for better readability on dark backgrounds

---

## v1.5.0 — 2026-03-25

### New Features
- Drag-to-reorder accounts on the Accounts page (desktop only) — grip handles appear on hover, order is persisted across sessions; accounts can be dragged freely across all account types

### Enhancements
- Transaction and budget tables are now edge-to-edge on mobile (no side borders or rounded corners)
- Account list redesigned with explicit Name, Type, Notes, and Balance columns; type grouping removed in favour of free-form ordering
- Bulk transaction actions (Edit, Delete, Clear) moved inline into the transactions toolbar instead of a separate bar
- Income "Received" totals in the budget table now align under the Balance column
- Budget group rows and table headers use a subtle tint (`bg-white/5`) for better visual separation
- Cover button repositioned as an absolute overlay so it no longer affects table column widths

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

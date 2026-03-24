# Dosh

A self-hosted, zero-based envelope budgeting app. Set a budget per category with weekly, fortnightly, monthly, quarterly, or annual periods. Tracks spending against each category's own period, supports CSV imports from your bank, and lets you cover overspend from savings.

## Quick Start

### Docker Compose (recommended)

1. Edit `docker-compose.yml` and set `SECRET_KEY` to a long random string:
   ```bash
   openssl rand -base64 48
   ```

2. Start the app:
   ```bash
   docker compose up -d
   ```

3. Open [http://localhost:3000](http://localhost:3000) and create your first user account.

### Development

**Prerequisites:** Node.js 20+

**Backend:**
```bash
cd backend
npm install
npm run dev
```

**Frontend** (in a second terminal):
```bash
cd frontend
npm install
npm run dev
```

The frontend dev server proxies `/api` requests to the backend at `localhost:3000`.
Open [http://localhost:5173](http://localhost:5173).

## Environment Variables

Only `SECRET_KEY` is required in `docker-compose.yml`. Everything else has a sensible default and only needs to be set if you want to override it.

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | — | **Required.** Secret for signing session cookies. Generate with `openssl rand -base64 48`. |
| `TZ` | `UTC` | **Recommended.** Container timezone. Set to your local timezone (e.g. `Australia/Sydney`) so week boundaries and transaction dates are calculated correctly. |
| `PORT` | `3000` | Port the server listens on. Also update the `ports` mapping in `docker-compose.yml` if changed. |
| `HOST` | `0.0.0.0` | Interface to bind to. |
| `DB_PATH` | `/data/dosh.db` | Path to the SQLite database file inside the container. |
| `LOG_LEVEL` | `info` | Log verbosity: `trace`, `debug`, `info`, `warn`, `error`. |

## Data Persistence

All data is stored in a single SQLite database file. The Docker Compose setup mounts a named volume at `/data` inside the container. To back up your data:

```bash
docker cp dosh:/data/dosh.db ./dosh-backup.db
```

## How It Works

### Budget Periods

- The overall budget cycle is **weekly** (Sunday–Saturday)
- Each category has its own period: weekly, fortnightly, monthly, quarterly, or annually
- "Spent" for a category is calculated over that category's own period
- At the end of each period, spent resets and the full budgeted amount is available again

### Weekly Equivalent

The **Weekly** column in the budget view shows a fixed weekly estimate derived from each category's budgeted amount and period:

| Period | Weekly equivalent |
|---|---|
| Weekly | Budgeted amount |
| Fortnightly | Budgeted amount × 2 |
| Monthly | ⌈(Budgeted amount × 12) ÷ 52⌉ |
| Quarterly | ⌈(Budgeted amount × 4) ÷ 52⌉ |
| Annually | ⌈Budgeted amount ÷ 52⌉ |

Fractional cents are always rounded up so the weekly figure never underestimates.

This column is for planning purposes only — it has no effect on balance or overspend calculations, which always use the full budgeted amount over the category's own period.

### Budget History

Changing a budget amount only affects the current and future weeks. Historical weeks display the amount that was configured at the time, so past records are preserved accurately.

### CSV Import

Dosh supports importing bank statements in CSV format. The import wizard lets you:
1. Upload a CSV file
2. Specify whether it has a header row and the date format
3. Map columns to fields (date, payee, description, amount — or separate debit/credit columns)
4. Preview with duplicate detection (matches on date + amount)
5. Confirm import

After importing, assign categories to transactions from the Accounts page.

### Reports

The **Reports** section provides financial insights across four tabs:

- **Cashflow** — spending by category (stacked bar chart + table), income vs expenses by month, net worth trend, and current account balances
- **Overspend** — categories and months where spending exceeded the budgeted amount, with budgeted vs spent comparison
- **Payees** — income and expense totals per payee per month, with a searchable payee list and per-payee bar chart
- **Goals** — savings account balance history with a projected line to the goal amount based on recent monthly trends

A year selector filters the Cashflow, Overspend, and Payee reports. The Goals tab always shows current data.

### Drag-to-Reorder Budget

On desktop, budget groups and categories can be reordered by dragging the grip handle on the left of each row. Order is persisted and reflected everywhere groups and categories appear.

### Resizable Table Columns

On desktop, any column in any table can be resized by dragging the right edge of its column header. Widths are saved per table in the browser and restored on next visit.

### Covering Overspend

When a category is overspent:
1. Click "Cover" on the overspent category in the budget view
2. Select which savings account to transfer from
3. A transfer transaction is created (debit from savings, credit to spending), tagged to the overspent category
4. Ensure you also transfer the exact amount in your bank account
4. When you import next week's bank CSV, duplicate detection will match the corresponding real bank transfer so you can skip it

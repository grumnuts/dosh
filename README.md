# Dosh

A self-hosted, zero-based envelope budgeting app for households. Weekly budget periods (Sunday–Saturday), CSV import, and overspend tracking.

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

All variables are set in `docker-compose.yml` — no `.env` file required.

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | *(change this)* | Secret for signing session cookies. Use `openssl rand -base64 48`. |
| `PORT` | `3000` | Port the server listens on |
| `HOST` | `0.0.0.0` | Interface to bind to |
| `DB_PATH` | `/data/dosh.db` | Path to the SQLite database file |
| `LOG_LEVEL` | `info` | Fastify log level (`trace`, `debug`, `info`, `warn`, `error`) |

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
- Short periods (weekly/fortnightly/monthly) reset each period
- Long periods (quarterly/annually) accumulate spending — balance carries forward until the full budgeted amount is spent or the year resets

### Budget History

Changing a budget amount only affects the current and future weeks. Historical weeks display the amount that was configured at the time, so past records are preserved accurately.

### CSV Import

Dosh supports importing bank statements in CSV format. The import wizard lets you:
1. Upload a CSV file
2. Specify whether it has a header row and the date format
3. Map columns to fields (date, payee, description, amount — or separate debit/credit columns)
4. Preview with duplicate detection (matches on date + amount)
5. Confirm import

After importing, assign categories to transactions from the Transactions page.

### Covering Overspend

When a category is overspent:
1. Click "Cover" on the overspent category in the budget view
2. Select which savings account to transfer from
3. A transfer transaction is created (debit from savings, credit to spending), tagged to the overspent category
4. When you import next week's bank CSV, duplicate detection will match the corresponding real bank transfer so you can skip it

## Tech Stack

- **Backend:** Node.js, Fastify, TypeScript, better-sqlite3, argon2
- **Frontend:** React, Vite, TailwindCSS, TanStack Query
- **Database:** SQLite
- **Container:** Single Docker container, non-root user

# Dosh

A self-hosted, zero-based envelope budgeting app. Set a budget per category with weekly, fortnightly, monthly, quarterly, or annual periods — Dosh tracks your spending against each category and keeps everything in one place.

## Installation

**Prerequisites:** Docker

1. Create a `docker-compose.yml`:
   ```yaml
   services:
     dosh:
       image: grumnuts/dosh:latest
       ports:
         - "3000:3000"
       volumes:
         - dosh_data:/data
       environment:
         SECRET_KEY: your-secret-key-here
         TZ: Australia/Sydney

   volumes:
     dosh_data:
   ```

2. Generate a secret key and paste it in:
   ```bash
   openssl rand -base64 48
   ```

3. Start the app:
   ```bash
   docker compose up -d
   ```

4. Open [http://localhost:3000](http://localhost:3000) and create your first user.

## Features

- **Envelope budgeting** — assign a budget to each category with its own period (weekly through annually); spending tracks against that period
- **Transaction management** — manually add transactions or import bank CSVs with duplicate detection and column mapping
- **Cover overspend** — transfer from a savings account to cover an overspent category, tagged back to the budget
- **Sweep to savings** — move unspent budget balance to a savings account at the end of a period; the reverse of cover
- **Debt tracking** — debt accounts auto-create a budget category; payments reduce the outstanding balance and appear in a dedicated Debt Payments section
- **Investment tracking** — tag budget categories with a ticker symbol; buy and sell transactions record quantity held; portfolio view shows holdings, market value, and gain/loss with live prices
- **Reports** — cashflow, spending by category, overspend, income by category, payee breakdown, savings goals, debt payoff projections, net worth, and investment portfolio
- **Ledger** — track checking, savings, and debt accounts; starting balances, reconciliation, and net worth calculated automatically
- **Catch Up** — weekly amounts are increased to cover the full budgeted amount by the end of the period, useful when adding new categories mid-period or when a bill increases
- **Audit log** — all user actions recorded with timestamps and client IP address; failed login attempts logged
- **Mobile-optimised** — bottom tab bar navigation, floating action button with speed dial, and long-press interactions for quick access on mobile

---

For full documentation, visit the [Dosh Wiki](https://github.com/grumnuts/dosh/wiki).

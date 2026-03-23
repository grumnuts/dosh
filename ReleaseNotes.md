# Release Notes

## Unreleased

### New Features
- Initial application build

### Enhancements
- Weekly equivalent is now fixed at the time a budget is set or edited — mid-period edits account for amounts already allocated, and period rollover resets to the full-period rate
- Reconciliation: adjust an account's balance to match the actual bank balance; creates a Reconciliation transaction for the difference
- Zero-based envelope budgeting with weekly (Sunday–Saturday) periods
- Budget categories with weekly, fortnightly, monthly, quarterly, and annually periods
- Weekly equivalent calculation for all category periods
- Budget history — amount changes only affect current and future weeks
- Cover overspend — creates a transfer transaction tagged to the category and period
- CSV import wizard with column mapping, date format selector, and duplicate detection
- Inline category assignment from the transactions list
- Account management with calculated current balances
- Multi-user support with argon2 password hashing and httpOnly cookie sessions
- First-run setup wizard
- Audit log tracking all user and data events
- Dark mode UI with green accent colour
- Mobile-friendly layout with sidebar (desktop) and bottom navigation (mobile)
- Docker deployment with single container and persistent SQLite volume

# Dosh — Claude Guidelines

## Project Overview

Dosh is a self-hosted zero-based envelope budgeting app. Single Docker container, SQLite database, weekly (Sunday–Saturday) budget periods. Built with Fastify + TypeScript on the backend and React + Vite + TailwindCSS on the frontend.

---

## Git Workflow

### Branching
- **Always** create a new branch before starting any feature, bug fix, or refactor
- Branch naming: `feature/short-description`, `fix/short-description`, `refactor/short-description`
- Never commit directly to `main`
- Example: `git checkout -b feature/transaction-search`

### Stay on task
- Each branch has a clear objective. If a request seems to be pulling toward unrelated work, flag it
- Say something like: *"This looks like a separate concern from the current branch. Want me to finish this work, commit, and open a new branch for that?"*
- Small scope creep is fine. Large detours are not

### Committing
- Commit often — after each meaningful, working change
- Don't batch unrelated changes into one commit
- Write clear commit messages: what changed and why, not just what
- Format: short imperative subject line, optional body for context
- Always ensure TypeScript compiles before committing

### Pull Requests
- When a feature or fix is ready, open a PR from the feature branch into `main`
- PR title should match the branch objective — short and descriptive
- PR body should summarise what changed and why, and note any decisions worth capturing
- Squash-merge into `main` to keep history clean, unless the branch history is meaningful
- Delete the branch after merging
- Never merge a branch with TypeScript errors or a broken build

---

## Release Process

When asked to publish a new release, follow these steps **in order** and **ask for confirmation before publishing**:

### 1. Confirm with the user
Before doing anything, confirm:
- The version number (semantic versioning: `v1.2.3`)
- Whether to use `:latest` tag (default: yes)
- Any last-minute changes to include

### 2. Update ReleaseNotes.md
`ReleaseNotes.md` always has an `## Unreleased` section at the top where changes accumulate as work is merged into `main`. On release, replace `## Unreleased` with the version heading and add a fresh empty `## Unreleased` section above it.

**During development** — as changes land on `main`, add entries under the relevant category in `## Unreleased`. Omit categories with no entries:

```markdown
## Unreleased

### New Features
- Added CSV import duplicate detection

### Bug Fixes
- Fixed fortnightly period boundary calculation
```

**On release** — replace the `## Unreleased` heading with the version and date, then prepend a new empty section:

```markdown
## Unreleased

---

## v1.2.3 — 2026-03-22

### New Features
- Added CSV import duplicate detection

### Bug Fixes
- Fixed fortnightly period boundary calculation
```

Use exactly these three category names — omit any that have no entries: **New Features**, **Bug Fixes**, **Enhancements**.

### 3. Commit and push
```bash
git add ReleaseNotes.md
git commit -m "chore: release v1.2.3"
git push origin main
```

### 4. Create GitHub release
Use the content from the version section of `ReleaseNotes.md` as the release notes:
```bash
gh release create v1.2.3 --title "v1.2.3" --notes "..."
```

### 5. Build and publish Docker image (multi-architecture)
```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t yourdockerhubuser/dosh:v1.2.3 \
  -t yourdockerhubuser/dosh:latest \
  --push .
```

> Docker Hub username: confirm with user if not set in context

### Versioning
Releases follow **semantic versioning**: `vMAJOR.MINOR.PATCH`
- MAJOR: breaking changes to data schema or API
- MINOR: new features, backwards compatible
- PATCH: bug fixes, small improvements

---

## Code Standards

### TypeScript
- Both `backend` and `frontend` must compile with **zero TypeScript errors** before committing
  - Backend: `cd backend && npx tsc --noEmit`
  - Frontend: `cd frontend && npx tsc --noEmit`
- No `any` types unless there is genuinely no better option — use `unknown` and narrow instead
- Prefer explicit return types on exported functions

### Backend
- All monetary values are **integer cents** — never floats. Use `parseCents()` / `formatCents()` from `src/utils/money.ts`
- All SQL queries must use **parameterised statements** — no string interpolation into SQL
- New routes go in `src/routes/`, business logic in `src/services/`, shared helpers in `src/utils/`
- Log all user-facing events with `logAudit()` from `src/utils/audit.ts`
- Use `getDb()` from `src/db/client.ts` — never instantiate the DB directly
- Budget history: when a category's budgeted amount changes, always call `recordBudgetChange()` so historical weeks remain accurate

### Frontend
- Money display uses `<Amount cents={n} />` or `formatMoney(cents)` from `components/ui/AmountDisplay.tsx`
- Use TanStack Query for all server state — no `useState` + `useEffect` for data fetching
- Invalidate relevant query keys after mutations: `['budget']`, `['transactions']`, `['accounts']`
- Forms use `react-hook-form` + `zod` validation
- Modals use the shared `<Modal>` component — don't create custom backdrop/overlay logic

### No over-engineering
- Don't add abstractions, helpers, or config for one-off cases
- Don't add error handling for scenarios that can't happen
- Don't add comments unless the logic is genuinely non-obvious

---

## UI & Styling

### Design system
- **Dark mode only** — background `#111111`, surfaces `#1c1c1c` / `#252525` / `#2e2e2e`
- **Accent colour**: bright green (`#4ade80` / Tailwind `accent`)
- **Danger**: red (`#f87171` / Tailwind `danger`)
- **Transfers**: grey (`#6b7280` / Tailwind `transfer`)
- Overspent categories and negative balances: `text-danger`
- Income and positive balances: `text-accent`
- Transfer/cover amounts: `text-transfer`

### Layout
- Sidebar navigation on desktop (≥ md), bottom navigation on mobile
- No horizontal scroll on any page — all tables use `min-w-[...]` with outer `overflow-x-auto`
- Key actions must be reachable in ≤ 2 taps on mobile

### Components
- Use existing UI primitives: `<Button>`, `<Input>`, `<Select>`, `<Textarea>`, `<Modal>`, `<Badge>`, `<Amount>`
- Don't create new layout primitives without good reason
- Tailwind utility classes only — no custom CSS unless Tailwind can't do it

---

## Budget Logic (critical — get this right)

- **Spent** for a category is summed over that category's own period (not the week)
  - Weekly → this week's transactions
  - Monthly → this calendar month's transactions
  - Quarterly/annually → full period, accumulates (carry forward)
- **Balance** = `budgetedAmount - spent + covers`
- **Cover transfers** are type `'cover'`, tagged with `category_id` + `cover_week_start`
  - Only the credit leg (positive amount to spending account) is summed as a cover
  - A category can be covered multiple times (each cover zeroes the current overspend)
- **Transfers** between accounts (type `'transfer'`) do NOT affect budget categories
- **Weekly equivalent**: used for footer totals only — not for spent/balance calculation

---

## Running Locally

```bash
# Backend (port 3000)
cd backend && npm run dev

# Frontend (port 5173, proxies /api → 3000)
cd frontend && npm run dev
```

First visit triggers the setup wizard if no users exist.

## Running Tests

*(No test suite yet — add one before the first release)*

---

## File Structure Reference

```
backend/src/
  db/           # Schema, migrations, DB client
  routes/       # One file per resource (auth, budget, transactions, ...)
  services/     # Business logic (budget calculations, CSV import)
  middleware/   # Auth session validation
  utils/        # audit, dates, money

frontend/src/
  api/          # Typed fetch wrappers per resource
  components/
    ui/         # Shared primitives (Button, Input, Modal, ...)
    layout/     # Sidebar, BottomNav, Layout
    budget/     # BudgetTable, CategoryModal, GroupModal, CoverModal
    transactions/ # TransactionForm, ImportWizard
  hooks/        # useAuth, useWeek
  pages/        # One file per route
```

// Seed script: 3 years of sample data (Jan 2023 – Mar 2026)
// Run from backend/: node seed-data.js

const { DatabaseSync } = require('node:sqlite')
const path = require('path')

const db = new DatabaseSync(path.join(__dirname, 'data/dosh.db'))
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

const USER_ID = 1               // Nate
const SPENDING_ACC = 7          // Spending (transactional)
const SAVINGS_ACC = 6           // Savings
const TESTING_SAVINGS_ACC = 9   // testing (savings)

// Category IDs
const CAT_RENT       = 1
const CAT_FOOD       = 2
const CAT_BIRTHDAY   = 3
const CAT_CHRISTMAS  = 4
const CAT_SALARY     = 5

// Additional categories to add for richer data
// (transport, dining out, subscriptions, utilities)

function dateStr(d) {
  return d.toISOString().slice(0, 10)
}

function rand(min, max) {
  return Math.round(min + Math.random() * (max - min))
}

function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

const now = new Date().toISOString()

// ── Add extra budget groups and categories ─────────────────────────────────

console.log('Setting up extra categories...')

db.prepare(`INSERT OR IGNORE INTO budget_groups (id, name, sort_order, is_income, is_active, created_at, updated_at)
  VALUES (4, 'Everyday', 0, 0, 1, ?, ?)`).run(now, now)

db.prepare(`INSERT OR IGNORE INTO budget_groups (id, name, sort_order, is_income, is_active, created_at, updated_at)
  VALUES (5, 'Lifestyle', 1, 0, 1, ?, ?)`).run(now, now)

// Fix Bills and Sinking sort orders so Everyday/Lifestyle come first
db.prepare(`UPDATE budget_groups SET sort_order=2 WHERE id=1`).run()  // Bills
db.prepare(`UPDATE budget_groups SET sort_order=3 WHERE id=2`).run()  // Sinking

const extraCats = [
  // [id, group_id, name, period, budgeted_cents]
  [20, 4, 'Groceries',       'weekly',   18000],
  [21, 4, 'Transport',       'weekly',    8000],
  [22, 4, 'Coffee',          'weekly',    3000],
  [23, 5, 'Dining Out',      'monthly',  25000],
  [24, 5, 'Entertainment',   'monthly',  10000],
  [25, 5, 'Subscriptions',   'monthly',   5000],
  [26, 1, 'Utilities',       'monthly',  18000],
  [27, 1, 'Internet',        'monthly',   8000],
  [28, 1, 'Phone',           'monthly',   8000],
  [29, 2, 'Car Registration','annually', 90000],
  [30, 2, 'Holiday',         'annually',300000],
]

for (const [id, gid, name, period, amt] of extraCats) {
  db.prepare(`INSERT OR IGNORE INTO budget_categories
    (id, group_id, name, period, budgeted_amount, sort_order, is_active, is_unlisted, is_system, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, 1, 0, 0, ?, ?)`
  ).run(id, gid, name, period, amt, now, now)
}

// Update Rent to be in Bills group properly, set salary budget
db.prepare(`UPDATE budget_categories SET group_id=1, budgeted_amount=200000 WHERE id=?`).run(CAT_RENT)
db.prepare(`UPDATE budget_categories SET budgeted_amount=230000 WHERE id=?`).run(CAT_SALARY)
db.prepare(`UPDATE budget_categories SET budgeted_amount=60000 WHERE id=?`).run(CAT_FOOD)

// Goal on testing savings account
db.prepare(`UPDATE accounts SET goal_amount=1500000 WHERE id=?`).run(TESTING_SAVINGS_ACC) // $15,000 goal

// ── Generate transactions ──────────────────────────────────────────────────

console.log('Generating transactions...')

const insertTx = db.prepare(`
  INSERT INTO transactions (date, account_id, payee, amount, category_id, type, description, created_at, updated_at, created_by)
  VALUES (?, ?, ?, ?, ?, 'transaction', ?, ?, ?, ?)
`)

const insertTransfer = db.prepare(`
  INSERT INTO transactions (date, account_id, payee, amount, category_id, type, description, created_at, updated_at, created_by)
  VALUES (?, ?, ?, ?, NULL, 'transfer', ?, ?, ?, ?)
`)

let txCount = 0

function tx(date, accountId, payee, amountCents, categoryId, notes = null) {
  insertTx.run(dateStr(date), accountId, payee, amountCents, categoryId, notes, now, now, USER_ID)
  txCount++
}

function transfer(date, fromAcc, toAcc, amountCents, notes = null) {
  // Debit from source
  insertTransfer.run(dateStr(date), fromAcc, 'Transfer', -amountCents, notes, now, now, USER_ID)
  // Credit to destination
  insertTransfer.run(dateStr(date), toAcc, 'Transfer', amountCents, notes, now, now, USER_ID)
  txCount += 2
}

// Start date: Jan 1 2023 (Sunday)
const start = new Date('2023-01-01')
const end   = new Date('2026-03-22') // up to existing data

// Weekly loop (Sunday = pay day)
let current = new Date(start)

const PAYEES_FOOD   = ['Coles', 'Woolworths', 'Aldi', 'IGA', 'Harris Farm']
const PAYEES_COFFEE = ['The Coffee Club', 'Gloria Jeans', 'Starbucks', 'Local Brew', 'Cafe Nero']
const PAYEES_TRANSPORT = ['Opal Card', 'Fuel Station', 'BP', '7-Eleven', 'Caltex']
const PAYEES_DINING = ['The Pub', 'Grill\'d', 'Nandos', 'Oporto', 'Local Restaurant', 'Thai Palace', 'Sushi Train']
const PAYEES_ENTERTAINMENT = ['Event Cinemas', 'Netflix', 'Spotify', 'Steam', 'Ticketek']

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// Months we've already generated a monthly recurring tx for
const monthlyDone = {}

while (current <= end) {
  const d = new Date(current)
  const year = d.getFullYear()
  const month = d.getMonth() // 0-indexed
  const monthKey = `${year}-${month}`
  const dayOfWeek = d.getDay() // 0 = Sunday

  // === WEEKLY ===
  if (dayOfWeek === 0) { // Every Sunday

    // Salary income (weekly)
    const salaryVariance = rand(-5000, 5000)
    tx(d, SPENDING_ACC, 'Employer Direct Credit', 230000 + salaryVariance, CAT_SALARY)

    // Rent — always exact
    tx(addDays(d, 1), SPENDING_ACC, 'Real Estate Agency', -200000, CAT_RENT)

    // Groceries (weekly, slight variance, occasional overspend)
    const groceryAmount = rand(14000, 26000) // $140–$260
    tx(addDays(d, rand(2, 5)), SPENDING_ACC, pick(PAYEES_FOOD), -groceryAmount, 20)

    // Transport
    tx(addDays(d, rand(1, 6)), SPENDING_ACC, pick(PAYEES_TRANSPORT), -rand(4000, 10000), 21)

    // Coffee (2–4 times a week, grouped as one weekly tx)
    tx(addDays(d, rand(1, 5)), SPENDING_ACC, pick(PAYEES_COFFEE), -rand(1500, 4500), 22)

    // Occasional second coffee
    if (Math.random() < 0.4) {
      tx(addDays(d, rand(1, 6)), SPENDING_ACC, pick(PAYEES_COFFEE), -rand(800, 2000), 22)
    }
  }

  // === MONTHLY (first week of month) ===
  if (!monthlyDone[monthKey] && dayOfWeek === 0 && d.getDate() <= 7) {
    monthlyDone[monthKey] = true

    // Utilities
    tx(addDays(d, 1), SPENDING_ACC, 'Energy Australia', -rand(14000, 22000), 26)

    // Internet
    tx(addDays(d, 2), SPENDING_ACC, 'Aussie Broadband', -8000, 27)

    // Phone
    tx(addDays(d, 2), SPENDING_ACC, 'Telstra', -rand(6000, 9000), 28)

    // Dining out (1–3 times a month)
    const diningCount = rand(1, 3)
    for (let i = 0; i < diningCount; i++) {
      tx(addDays(d, rand(1, 25)), SPENDING_ACC, pick(PAYEES_DINING), -rand(3500, 9500), 23)
    }

    // Entertainment
    tx(addDays(d, rand(3, 12)), SPENDING_ACC, pick(PAYEES_ENTERTAINMENT), -rand(2000, 6000), 24)

    // Subscriptions (Netflix, Spotify)
    tx(addDays(d, 1), SPENDING_ACC, 'Netflix', -1999, 25)
    tx(addDays(d, 1), SPENDING_ACC, 'Spotify', -1099, 25)

    // Savings transfer (monthly, $400–$600)
    const savingsAmt = rand(40000, 60000)
    transfer(addDays(d, 3), SPENDING_ACC, TESTING_SAVINGS_ACC, savingsAmt, 'Monthly savings')
  }

  // === ANNUAL ===
  // Birthday (April each year)
  if (month === 3 && d.getDate() >= 1 && d.getDate() <= 7 && dayOfWeek === 0) {
    tx(addDays(d, 2), SPENDING_ACC, 'Birthday Gifts', -rand(15000, 25000), CAT_BIRTHDAY)
  }

  // Christmas (December each year)
  if (month === 11 && d.getDate() >= 1 && d.getDate() <= 7 && dayOfWeek === 0) {
    tx(addDays(d, 2), SPENDING_ACC, 'Christmas Gifts', -rand(40000, 65000), CAT_CHRISTMAS)
  }

  // Car registration (July each year)
  if (month === 6 && d.getDate() >= 1 && d.getDate() <= 7 && dayOfWeek === 0) {
    tx(addDays(d, 1), SPENDING_ACC, 'Service NSW', -rand(85000, 95000), 29)
  }

  // Holiday (January each year — summer holiday)
  if (month === 0 && d.getDate() >= 8 && d.getDate() <= 14 && dayOfWeek === 0) {
    tx(addDays(d, 1), SPENDING_ACC, 'Booking.com', -rand(150000, 400000), 30)
    tx(addDays(d, 1), SPENDING_ACC, 'Virgin Australia', -rand(80000, 180000), 30)
  }

  current = addDays(current, 1)
}

// Add payee records for all new payees
console.log('Updating payees table...')
const allPayees = db.prepare(`
  SELECT DISTINCT payee FROM transactions WHERE payee IS NOT NULL AND payee != ''
`).all()
const insertPayee = db.prepare(`INSERT OR IGNORE INTO payees (name, created_at) VALUES (?, ?)`)
for (const { payee } of allPayees) {
  insertPayee.run(payee, now)
}

// Add budget_history entries so overspend report can see historical budgets
console.log('Adding budget history...')
const cats = db.prepare(`SELECT id, budgeted_amount, period FROM budget_categories WHERE is_active=1 AND is_unlisted=0`).all()
const insertHistory = db.prepare(`
  INSERT OR IGNORE INTO budget_history (category_id, budgeted_amount, period, effective_from, created_at, created_by)
  VALUES (?, ?, ?, ?, ?, ?)
`)
for (const cat of cats) {
  // Mark effective from start of data
  insertHistory.run(cat.id, cat.budgeted_amount, cat.period, '2023-01-01', now, USER_ID)
}

console.log(`Done! Inserted ${txCount} transactions.`)
db.close({})

// demo/scenarios/student.js
// ─────────────────────────────────────────────────────────────────────────────
// Scenario: College student working at Starbucks (~$15/hr, part-time ~24hr/wk)
// ─────────────────────────────────────────────────────────────────────────────

export const scenario = {
  name: 'starbucks-student',
  url:  'https://www.firephin.com',

  // ── Profile ────────────────────────────────────────────────────────────────
  profile: {
    age:             20,
    annualIncome:    18720,   // $15/hr × 24hr/wk × 52wk
    monthlyTakeHome: 1400,
  },

  // ── Expenses ───────────────────────────────────────────────────────────────
  // The app pre-fills 5 default rows (indices 0–4). We update those in-place
  // and add only 2 new rows to keep the expense segment short.
  //
  // Default rows and what we change:
  //   0  "Rent / Mortgage"  Housing      $1500  → rename + $550
  //   1  "Groceries"        Food         $400   → $180 (amount only)
  //   2  "Car + gas"        Transport    $550   → rename + $60
  //   3  "Utilities"        Utilities    $150   → $45  (amount only)
  //   4  "Phone"            Subscriptions $80   → $25  (amount only)
  expenses: {
    update: [
      { index: 0, name: 'Rent (split)',    amount: 550 },
      { index: 1,                          amount: 180 },
      { index: 2, name: 'Bus pass / gas', amount: 60  },
      { index: 3,                          amount: 45  },
      { index: 4,                          amount: 25  },
    ],
    add: [
      { name: 'Dining out',    category: 'Food',          amount: 80 },
      { name: 'Entertainment', category: 'Entertainment', amount: 60 },
    ],
  },

  // ── Monthly investment allocations ─────────────────────────────────────────
  accounts: {
    rothIRA:          100,
    taxableBrokerage:  50,   // Simulation 1 (baseline)
  },

  // ── Comparison demo ────────────────────────────────────────────────────────
  // After finishing Sim 1 with `before`, we clone → Sim 2 gets `after`.
  comparisonDemo: {
    before:   50,
    after:   150,
  },
};
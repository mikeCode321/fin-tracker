import { useState, useMemo, useEffect, useRef } from "react";
import "./global.css";
import "./FinanceTracker.css";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
// Kept configurable so you can update these as tax/benchmark data changes.
const ROTH_LIMIT = 7500;
const K401_LIMIT = 23000;

// Simulations are capped so the comparison view and header tab strip stay
// usable — raise this if you need more scenarios at once.
const MAX_SIMULATIONS = 5;

// Approximate U.S. household net-worth reference points by age.
// These are intentionally kept in one place so they can be replaced with
// updated Federal Reserve SCF data later.
const NET_WORTH_BENCHMARKS = [
  { minAge: 18, maxAge: 29, p25: 1000,   p50: 10200,  p75: 54800,   p90: 189000,  p99: 800000   },
  { minAge: 30, maxAge: 34, p25: 7000,   p50: 35700,  p75: 135000,  p90: 350000,  p99: 1200000  },
  { minAge: 35, maxAge: 39, p25: 12000,  p50: 67000,  p75: 250000,  p90: 600000,  p99: 2000000  },
  { minAge: 40, maxAge: 44, p25: 20000,  p50: 134000, p75: 400000,  p90: 950000,  p99: 3500000  },
  {
    minAge: 45,
    maxAge: 49,
    p25: 25000,
    p50: 180000,
    p75: 500000,
    p90: 1200000,
    p99: 4800000,
  },
  {
    minAge: 50,
    maxAge: 54,
    p25: 30000,
    p50: 290000,
    p75: 750000,
    p90: 1600000,
    p99: 6500000,
  },
  {
    minAge: 55,
    maxAge: 59,
    p25: 45000,
    p50: 380000,
    p75: 1000000,
    p90: 2200000,
    p99: 9000000,
  },
  {
    minAge: 60,
    maxAge: 64,
    p25: 70000,
    p50: 490000,
    p75: 1300000,
    p90: 2800000,
    p99: 11000000,
  },
  {
    minAge: 65,
    maxAge: 74,
    p25: 100000,
    p50: 580000,
    p75: 1500000,
    p90: 3200000,
    p99: 12500000,
  },
  {
    minAge: 75,
    maxAge: 100,
    p25: 90000,
    p50: 550000,
    p75: 1400000,
    p90: 3000000,
    p99: 11500000,
  },
];

function fmt(n, decimals = 0) {
  if (isNaN(n) || !isFinite(n)) return "$—";

  const neg = n < 0;
  return (
    (neg ? "-$" : "$") +
    Math.abs(n)
      .toFixed(decimals)
      .replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  );
}

function pct(n) {
  return (n * 100).toFixed(1) + "%";
}

function getAgeBenchmark(age) {
  return (
    NET_WORTH_BENCHMARKS.find((b) => age >= b.minAge && age <= b.maxAge) ||
    NET_WORTH_BENCHMARKS[NET_WORTH_BENCHMARKS.length - 1]
  );
}

function getNetWorthStatus(value, benchmark) {
  if (value >= benchmark.p99) return "99th+";
  if (value >= benchmark.p90) return "90th–99th";
  if (value >= benchmark.p75) return "75th–90th";
  if (value >= benchmark.p50) return "50th–75th";
  if (value >= benchmark.p25) return "25th–50th";
  return "Below 25th";
}

function getHealthStatus(value, thresholds, reverse = false) {
  if (reverse) {
    if (value <= thresholds.good) return "healthy";
    if (value <= thresholds.watch) return "watch";
    return "high";
  }

  if (value >= thresholds.good) return "healthy";
  if (value >= thresholds.watch) return "watch";
  return "low";
}

function statusLabel(status) {
  if (status === "healthy") return "Healthy";
  if (status === "watch") return "Watch";
  return "Needs attention";
}

// Maps a status string ("healthy" | "watch" | anything else) to the
// `.status-*` utility class that exposes `--status-color` for CSS to consume.
function statusClass(status) {
  if (status === "healthy") return "status-healthy";
  if (status === "watch") return "status-watch";
  return "status-low";
}

// Maps a plain boolean (e.g. "is this number non-negative?") to the same
// kind of status utility class, for the many green/red good-or-bad values.
function boolStatusClass(isGood) {
  return isGood ? "status-positive" : "status-negative";
}

function projectAll({
  annualRoth: baseAnnualRoth,
  annualK401: baseAnnualK401,
  annualBrokerage: baseAnnualBrokerage,
  annualLeftover: baseAnnualLeftover,
  years,
  rothRate,
  k401Rate,
  brokerageRate,
  cashRate,
  initRoth,
  initK401,
  initBrokerage,
  initCash,
  salaryGrowth,
  contributionGrowth,
  initialGross,
  initialTakeHome,
  k401Pct,
  employerMatch: employerMatchPct,
  employerMatchMax,
}) {
  let roth = Number(initRoth) || 0;
  let k401 = Number(initK401) || 0;
  let brokerage = Number(initBrokerage) || 0;
  let cash = Number(initCash) || 0;
  let gross = Number(initialGross) || 0;
  let takeHomeAnnual = Number(initialTakeHome) || 0;

  const startingExpensesAnnual = Math.max(
    takeHomeAnnual - baseAnnualRoth - baseAnnualBrokerage - baseAnnualLeftover,
    0,
  );
  const snapshots = [];

  for (let y = 1; y <= years; y++) {
    gross *= 1 + salaryGrowth;

    let employee401k = Math.min((k401Pct / 100) * gross, K401_LIMIT);

    takeHomeAnnual *= 1 + salaryGrowth;

    const growthFactor = contributionGrowth ? Math.pow(1 + salaryGrowth, y) : 1;

    const yearlyRoth = Math.min(
      Math.max(baseAnnualRoth * growthFactor, 0),
      ROTH_LIMIT,
    );
    const yearlyBrokerage = Math.max(baseAnnualBrokerage * growthFactor, 0);
    const yearlyExpenses = startingExpensesAnnual * growthFactor;
    const yearlyLeftover =
      takeHomeAnnual - yearlyExpenses - yearlyRoth - yearlyBrokerage;
    const employerMatchAmount =
      gross * (Math.min(employerMatchPct, employerMatchMax) / 100);

    roth = roth * (1 + rothRate) + yearlyRoth;
    k401 = k401 * (1 + k401Rate) + employee401k + employerMatchAmount;
    brokerage = brokerage * (1 + brokerageRate) + yearlyBrokerage;
    cash = cash * (1 + cashRate) + yearlyLeftover;

    const total = roth + k401 + brokerage + cash;

    snapshots.push({
      year: y,
      gross,
      takeHome: takeHomeAnnual / 12,
      roth,
      k401,
      brokerage,
      cash,
      total,
      annualRoth: yearlyRoth,
      annualK401: employee401k,
      employerMatch: employerMatchAmount,
      annualBrokerage: yearlyBrokerage,
      annualLeftover: yearlyLeftover,
    });
  }

  return {
    roth,
    k401,
    brokerage,
    cash,
    total: roth + k401 + brokerage + cash,
    snapshots,
  };
}

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────────
const Label = ({ children }) => <div className="field-label">{children}</div>;

const Row = ({ label, value, highlight, sub, valueColor }) => (
  <div className="data-row">
    <span className={`data-row-label${sub ? " is-sub" : ""}`}>{label}</span>
    <span
      className={`data-row-value${highlight ? " is-highlight" : ""}${
        valueColor ? ` ${valueColor}` : ""
      }`}
    >
      {value}
    </span>
  </div>
);

const Card = ({ title, badge, children, accent }) => (
  <div className={`card${accent ? " is-accent" : ""}`}>
    <div className="card-head">
      <h3 className="card-title">{title}</h3>

      {badge && <span className="card-badge">{badge}</span>}
    </div>

    {children}
  </div>
);

const Slider = ({ label, value, min, max, step, onChange, display }) => (
  <div className="slider-field">
    <div className="slider-field-head">
      <Label>{label}</Label>
      <span className="slider-field-value">{display}</span>
    </div>

    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />

    <div className="slider-field-range">
      <span>{min}</span>
      <span>{max}</span>
    </div>
  </div>
);

const NumInput = ({
  label,
  value,
  onChange,
  prefix = "$",
  suffix,
  placeholder,
}) => (
  <div className="num-field">
    <Label>{label}</Label>

    <div className="num-field-box">
      {prefix && (
        <span className="num-field-affix is-prefix">{prefix}</span>
      )}

      <input
        type="number"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(Number(e.target.value))}
        className="num-field-input"
      />

      {suffix && (
        <span className="num-field-affix is-suffix">{suffix}</span>
      )}
    </div>
  </div>
);

const Tab = ({ label, active, onClick }) => (
  <button className={`ft-tab${active ? " is-active" : ""}`} onClick={onClick}>
    {label}
  </button>
);

const Progress = ({ value, max, statusClassName }) => (
  <div className="progress-track">
    <div
      className={`progress-fill${statusClassName ? ` ${statusClassName}` : ""}`}
      style={{
        width: `${Math.min(Math.max(value / (max || 1), 0), 1) * 100}%`,
      }}
    />
  </div>
);

const InfoBox = ({ children, variant = "accent" }) => (
  <div className={`info-box${variant !== "accent" ? ` is-${variant}` : ""}`}>
    {children}
  </div>
);

const HealthMetric = ({ label, value, target, status }) => (
  <div className="health-metric">
    <div className="health-metric-row">
      <div className="health-metric-info">
        <div className="health-metric-label">{label}</div>

        <div className="health-metric-target">Target {target}</div>
      </div>

      <div className={`health-metric-stat ${statusClass(status)}`}>
        <div className="health-metric-value">{value}</div>

        <div className="health-metric-status">{statusLabel(status)}</div>
      </div>
    </div>
  </div>
);

// ─── EXPENSES ─────────────────────────────────────────────────────────────────
const CATEGORIES = [
  "Housing",
  "Food",
  "Transport",
  "Utilities",
  "Insurance",
  "Healthcare",
  "Entertainment",
  "Subscriptions",
  "Clothing",
  "Debt",
  "Other",
];

function ExpenseRow({ item, onChange, onRemove }) {
  return (
    <div className="expense-row">
      <input
        className="expense-input"
        value={item.name}
        onChange={(e) =>
          onChange({
            ...item,
            name: e.target.value,
          })
        }
        placeholder="Expense name"
      />

      <select
        className="expense-select"
        value={item.category}
        onChange={(e) =>
          onChange({
            ...item,
            category: e.target.value,
          })
        }
      >
        {CATEGORIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>

      <div className="expense-amount">
        <span className="expense-amount-prefix">$</span>

        <input
          type="number"
          className="expense-amount-input"
          value={item.amount}
          onChange={(e) =>
            onChange({
              ...item,
              amount: Number(e.target.value),
            })
          }
        />
      </div>

      <button className="expense-remove" onClick={onRemove}>
        ×
      </button>
    </div>
  );
}

// ─── SNAPSHOT TABLE ───────────────────────────────────────────────────────────
function SnapshotTable({ snapshots }) {
  const cols = [
    "Year",
    "Gross",
    "Take-home",
    "Roth IRA",
    "401k",
    "Brokerage",
    "Cash",
    "Total",
  ];

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>

        <tbody>
          {snapshots.map((s) => (
            <tr key={s.year} className="has-top-border">
              <td className="cell-muted">Yr {s.year}</td>

              <td>{fmt(s.gross)}</td>

              <td>{fmt(s.takeHome)}</td>

              <td className="cell-accent">{fmt(s.roth)}</td>

              <td className="cell-accent">{fmt(s.k401)}</td>

              <td className="cell-accent">{fmt(s.brokerage)}</td>

              <td className={`cell-status ${boolStatusClass(s.cash >= 0)}`}>
                {fmt(s.cash)}
              </td>

              <td className="cell-strong">{fmt(s.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Builds a projection for a saved simulation using the app-wide projection
// length (years), so every simulation reflects the same "Simulation length"
// slider value rather than a value frozen into the simulation itself.
function buildProjectionFromSimulation(sim, years) {
  const expenses = Array.isArray(sim.expenses) ? sim.expenses : [];
  const totalExpenses = expenses.reduce(
    (sum, e) => sum + Math.max(Number(e.amount) || 0, 0),
    0,
  );
  const grossSalary = Number(sim.grossSalary) || 0;
  const k401Annual = Math.min(
    ((Number(sim.k401Pct) || 0) / 100) * grossSalary,
    K401_LIMIT,
  );
  const netMonthly = Number(sim.actualTakeHome) || 0;
  const netAnnual = netMonthly * 12;
  const matchPct =
    Math.min(
      Number(sim.employerMatch) || 0,
      Number(sim.employerMatchMax) || 0,
    ) / 100;
  const employerMatchAmt = grossSalary * matchPct;
  const rothMonthly = Math.min(
    Math.max(Number(sim.rothContrib) || 0, 0),
    ROTH_LIMIT / 12,
  );
  const rothAnnual = rothMonthly * 12;
  const brokerageAnnual = Math.max(Number(sim.brokerageContrib) || 0, 0) * 12;
  const leftoverAnnual =
    (netMonthly -
      totalExpenses -
      rothMonthly -
      Math.max(Number(sim.brokerageContrib) || 0, 0)) *
    12;

  return projectAll({
    annualRoth: rothAnnual,
    annualK401: k401Annual,
    annualBrokerage: brokerageAnnual,
    annualLeftover: leftoverAnnual,
    years: Number(years) || 20,
    rothRate: (Number(sim.rothRate) || 0) / 100,
    k401Rate: (Number(sim.k401Rate) || 0) / 100,
    brokerageRate: (Number(sim.brokerageRate) || 0) / 100,
    cashRate: (Number(sim.cashRate) || 0) / 100,
    initRoth: sim.rothBalance,
    initK401: sim.k401Balance,
    initBrokerage: sim.brokerageBalance,
    initCash: sim.initCash,
    salaryGrowth: (Number(sim.salaryGrowth) || 0) / 100,
    contributionGrowth: !!sim.contributionGrowth,
    initialGross: grossSalary,
    initialTakeHome: netAnnual,
    k401Pct: Number(sim.k401Pct) || 0,
    employerMatch: Number(sim.employerMatch) || 0,
    employerMatchMax: Number(sim.employerMatchMax) || 0,
  });
}

function CollapsibleYearTable({
  snapshots,
  projYears,
  age,
  finalAge,
  salaryGrowth,
  cashRate,
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-18">
      <div className="year-table-shell">
        <button className="year-table-toggle" onClick={() => setOpen((v) => !v)}>
          <span className="year-table-toggle-label">
            Year-by-year breakdown — {projYears} year projection
          </span>
          <span className={`year-table-caret${open ? " is-open" : ""}`}>▾</span>
        </button>
        {open && (
          <div className="year-table-body">
            <div className="year-table-meta">
              Starting age: {age}. Final age: {finalAge}. Salary grows{" "}
              {salaryGrowth}% annually. Cash earns {cashRate}% APY.
            </div>
            <SnapshotTable snapshots={snapshots} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── FLOATING HEALTH PANEL ────────────────────────────────────────────────────
function FloatingHealthPanel({
  calc,
  pct,
  getHealthStatus,
  statusClass,
  statusLabel,
}) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 860);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const score = calc.healthScore;
  const scoreStatus = score >= 85 ? "healthy" : score >= 70 ? "watch" : "low";
  const scoreClass = statusClass(scoreStatus);

  const metrics = [
    {
      label: "Housing",
      value: pct(calc.housingTakeHomeRatio),
      target: "< 30%",
      status: getHealthStatus(
        calc.housingTakeHomeRatio,
        { good: 0.3, watch: 0.35 },
        true,
      ),
    },
    {
      label: "Expenses",
      value: pct(calc.expenseRatio),
      target: "< 50%",
      status: getHealthStatus(
        calc.expenseRatio,
        { good: 0.5, watch: 0.6 },
        true,
      ),
    },
    {
      label: "Investing",
      value: pct(calc.investmentGrossRatio),
      target: "≥ 15%",
      status:
        calc.investmentGrossRatio >= 0.15
          ? "healthy"
          : calc.investmentGrossRatio >= 0.1
            ? "watch"
            : "low",
    },
    {
      label: "Cash buffer",
      value: pct(calc.surplusRatio),
      target: "≥ 10%",
      status:
        calc.surplusRatio >= 0.1
          ? "healthy"
          : calc.surplusRatio >= 0
            ? "watch"
            : "low",
    },
    {
      label: "Debt",
      value: pct(calc.debtToIncome),
      target: "< 20%",
      status: getHealthStatus(
        calc.debtToIncome,
        { good: 0.2, watch: 0.36 },
        true,
      ),
    },
    {
      label: "Emergency",
      value: `${Math.min(calc.emergencyFunding * 100, 999).toFixed(0)}%`,
      target: "6 months",
      note: `Cash + surplus vs ${calc.emergencyTarget ? fmt(calc.emergencyTarget) : "—"} target`,
      status:
        calc.emergencyFunding >= 1
          ? "healthy"
          : calc.emergencyFunding >= 0.5
            ? "watch"
            : "low",
    },
  ];

  const panelContent = (
    <div className="health-panel-body">
      {/* Score row */}
      <div className={`health-score-row ${scoreClass}`}>
        <div>
          <div className="health-score-label">Overall score</div>
          <div className="health-score-value">
            {score}
            <span className="health-score-suffix">/100</span>
          </div>
        </div>
        <div className="health-score-tag">{calc.healthLabel}</div>
      </div>
      {metrics.map((m) => (
        <HealthMetric
          key={m.label}
          label={m.label}
          value={m.value}
          target={m.target}
          status={m.status}
        />
      ))}
    </div>
  );

  if (isMobile) {
    // Mobile: sticky button + slide-up drawer
    return (
      <>
        {/* Floating button */}
        <button
          className={`health-fab ${scoreClass}`}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="health-fab-heart">❤</span>
          <span>{score}</span>
        </button>

        {/* Backdrop */}
        {open && (
          <div className="health-backdrop" onClick={() => setOpen(false)} />
        )}

        {/* Drawer */}
        <div className={`health-drawer ${scoreClass}${open ? " is-open" : ""}`}>
          <div className="health-drawer-head">
            <div className="health-drawer-title">
              Financial Health{" "}
            </div>
            <button
              className="health-close-btn"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          {panelContent}
        </div>
      </>
    );
  }

  // Desktop: fixed floating panel on the right
  return (
    <>
      {/* Toggle button when collapsed */}
      {!open && (
        <button
          className={`health-toggle-tab ${scoreClass}`}
          onClick={() => setOpen(true)}
        >
          <span className="health-toggle-score">{score}</span>
          <span className="health-toggle-label">Health</span>
          <span className="health-toggle-caret">◂</span>
        </button>
      )}

      {/* Floating panel */}
      <div className={`health-panel ${scoreClass}${open ? " is-open" : ""}`}>
        <div className="health-panel-head">
          <div className="health-panel-title">
            Financial Health{" "}
          </div>
          <button
            className="health-close-btn"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>
        {panelContent}
      </div>
    </>
  );
}

// Compact summary bar — all 5 values in a single segmented row.
// No expand/toggle; scales gracefully to mobile via CSS wrapping.
function Summary({ calc }) {
  const stats = [
    {
      label: "Take-home / mo",
      value: fmt(calc.netMonthly),
      className: "u-text-green",
      tone: "green",
    },
    {
      label: "Monthly expenses",
      value: fmt(calc.totalExpenses),
      className: "u-text-red",
      tone: "red",
    },
    {
      label: "After expenses",
      value: fmt(calc.afterExpenses),
      className: calc.afterExpenses >= 0 ? "u-text-green" : "u-text-red",
      tone: calc.afterExpenses >= 0 ? "green" : "red",
    },
    {
      label: "Investing / mo",
      value: fmt(calc.totalInvesting),
      className: "u-text-accent",
      tone: "accent",
    },
    {
      label: "Cash surplus / mo",
      value: fmt(calc.leftoverMonthly),
      className: calc.leftoverMonthly >= 0 ? "u-text-green" : "u-text-red",
      tone: calc.leftoverMonthly >= 0 ? "green" : "red",
    },
  ];

  return (
    <div className="summary-bar">
      {stats.map((s) => (
        <div key={s.label} className={`summary-bar-item tone-${s.tone}`}>
          <div className="summary-bar-label">{s.label}</div>
          <div className={`summary-bar-value ${s.className}`}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── SUGGESTIONS STRIP ────────────────────────────────────────────────────────
// Replaces the "What Should I Change?" full Card — lives as a slim strip
function SuggestionsStrip({ calc, pct }) {
  const hints = [];
  if (calc.housingTakeHomeRatio > 0.3)
    hints.push(`🏠 Housing at ${pct(calc.housingTakeHomeRatio)} of take-home — target < 30%`);
  if (calc.investmentGrossRatio < 0.15)
    hints.push(`📈 Investing ${pct(calc.investmentGrossRatio)} of gross — target ≥ 15%`);
  if (calc.expenseRatio > 0.5)
    hints.push(`💰 Expenses at ${pct(calc.expenseRatio)} of take-home — high`);
  if (calc.emergencyFunding < 1)
    hints.push(
      `🛟 Emergency fund ${Math.min(Math.round(calc.emergencyFunding * 100), 999)}% of 6-month target`,
    );

  if (hints.length === 0) {
    return (
      <div className="suggestions-strip is-all-good">
        <span>✓ Plan looks strong across all major ratios — keep growing income and investments.</span>
      </div>
    );
  }

  return (
    <div className="suggestions-strip">
      <span className="suggestions-label">Heads up</span>
      <div className="suggestions-pills">
        {hints.map((h, i) => (
          <span key={i} className="suggestion-pill">{h}</span>
        ))}
      </div>
    </div>
  );
}

// ─── COMPARISON VIEW ──────────────────────────────────────────────────────────
function CompareView({
  simulations,
  compareSimulationIds,
  setCompareSimulationIds,
  compareMetricKeys,
  compareMetrics,
  graphMetricKey,
  selectGraphMetric,
  toggleCompareSimulation,
  toggleCompareMetric,
  projYears,
}) {
  const [tableOpen, setTableOpen] = useState(false);
  const selectedIds = compareSimulationIds.length
    ? compareSimulationIds
    : simulations.map((s) => s.id);
  const selectedSims = simulations.filter((s) => selectedIds.includes(s.id));
  const metricMap = Object.fromEntries(compareMetrics.map((m) => [m.key, m]));

  const getSeriesValue = (snapshot, key) => snapshot?.[key] ?? 0;
  const snapshots = selectedSims
    .reduce((all, sim) => {
      buildProjectionFromSimulation(sim, projYears).snapshots.forEach(
        (snapshot) => {
          if (!all.some((x) => x.year === snapshot.year))
            all.push({ year: snapshot.year });
        },
      );
      return all;
    }, [])
    .sort((a, b) => a.year - b.year);

  const finalYear = snapshots[snapshots.length - 1]?.year || 0;

  return (
    <div>
      <Card title="Compare simulations" accent>
        <div className="chip-row">
          <button
            className={`chip-btn${compareSimulationIds.length === 0 ? " is-active" : ""}`}
            onClick={() => setCompareSimulationIds([])}
          >
            All simulations
          </button>
          {simulations.map((sim) => {
            const active = selectedIds.includes(sim.id);
            return (
              <button
                key={sim.id}
                className={`chip-btn${active ? " is-active" : ""}`}
                onClick={() => toggleCompareSimulation(sim.id)}
              >
                {active ? "✓ " : ""}
                {sim.name}
              </button>
            );
          })}
        </div>
      </Card>

      {selectedSims.length === 0 ? (
        <Card title="No simulations selected">
          <div className="u-text-muted" style={{ fontSize: 13 }}>
            Select at least one simulation to compare.
          </div>
        </Card>
      ) : (
        <>
          <Card title="Growth graph" accent>
            <div className="mb-18" style={{ marginBottom: 12 }}>
              <div className="chip-row">
                {compareMetrics.map((metric) => {
                  const active = graphMetricKey === metric.key;
                  return (
                    <button
                      key={`graph-${metric.key}`}
                      className={`chip-btn${active ? " is-active-alt" : ""}`}
                      onClick={() => selectGraphMetric(metric.key)}
                    >
                      {active ? "● " : ""}
                      {metric.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <ComparisonChart
              simulations={selectedSims}
              metricKey={graphMetricKey}
              metric={metricMap[graphMetricKey]}
              projYears={projYears}
            />
          </Card>

          <div className="year-table-shell mb-18">
            <button
              className="year-table-toggle"
              onClick={() => setTableOpen((v) => !v)}
            >
              <span className="year-table-toggle-label">
                Comparison table{finalYear ? ` — through year ${finalYear}` : ""}
              </span>
              <span className={`year-table-caret${tableOpen ? " is-open" : ""}`}>
                ▾
              </span>
            </button>
            {tableOpen && (
              <div className="year-table-body">
                <div style={{ marginBottom: 12 }}>
                  <div className="u-text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
                    Table metrics — choose which columns appear in the table below.
                  </div>
                  <div className="chip-row">
                    {compareMetrics.map((metric) => {
                      const active = compareMetricKeys.includes(metric.key);
                      return (
                        <button
                          key={metric.key}
                          className={`chip-btn${active ? " is-active-alt" : ""}`}
                          onClick={() => toggleCompareMetric(metric.key)}
                        >
                          {active ? "✓ " : ""}
                          {metric.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="compare-table-wrap">
                  <table className="compare-table">
                    <thead>
                      <tr>
                        <th className="is-year">Year</th>
                        {selectedSims.flatMap((sim) =>
                          compareMetricKeys.map((key) => (
                            <th
                              key={`${sim.id}-${key}`}
                              className={`is-metric metric-${key}`}
                            >
                              {sim.name} · {metricMap[key].label}
                            </th>
                          )),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {snapshots.map((row) => (
                        <tr key={row.year}>
                          <td className="is-year">Yr {row.year}</td>
                          {selectedSims.flatMap((sim) =>
                            compareMetricKeys.map((key) => {
                              const snapshot = buildProjectionFromSimulation(
                                sim,
                                projYears,
                              ).snapshots.find((s) => s.year === row.year);
                              return (
                                <td key={`${sim.id}-${key}-${row.year}`} className="is-metric">
                                  {fmt(getSeriesValue(snapshot, key))}
                                </td>
                              );
                            }),
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function fmtShort(n) {
  if (Math.abs(n) >= 1_000_000)
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return n.toFixed(0);
}

const SIM_COLORS = [
  "#6c8ef5",
  "#4ade80",
  "#fbbf24",
  "#f472b6",
  "#38bdf8",
  "#fb923c",
  "#a78bfa",
];

function ComparisonChart({ simulations, metricKey, metric, projYears }) {
  const width = 960;
  const height = 420;
  const pad = { left: 78, right: 24, top: 24, bottom: 42 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const getSnapshots = (sim) =>
    buildProjectionFromSimulation(sim, projYears).snapshots;
  const maxYear = Math.max(
    1,
    ...simulations.flatMap((sim) => getSnapshots(sim).map((x) => x.year)),
  );
  const points = simulations.flatMap((sim) =>
    getSnapshots(sim).map((s) => Number(s[metricKey]) || 0),
  );
  const maxValue = Math.max(1, ...points);
  const minValue = Math.min(0, ...points);
  const valueRange = Math.max(1, maxValue - minValue);
  const x = (year) => pad.left + (year / maxYear) * innerW;
  const y = (value) =>
    pad.top + innerH - ((value - minValue) / valueRange) * innerH;
  const ticks = 5;
  const dash = ["0", "7 5", "2 4", "10 5 2 5", "14 5 2 5 2 5"];

  return (
    <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        role="img"
        aria-label={`${metric?.label || metricKey} simulation comparison chart`}
      >
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const value = minValue + (valueRange / ticks) * i;
          const yy = y(value);
          return (
            <g key={i}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={yy}
                y2={yy}
                stroke="var(--border)"
              />
              <text
                x={pad.left - 8}
                y={yy + 4}
                textAnchor="end"
                fill="var(--muted)"
                fontSize="11"
              >
                {fmtShort(value)}
              </text>
            </g>
          );
        })}
        <line
          x1={pad.left}
          x2={pad.left}
          y1={pad.top}
          y2={height - pad.bottom}
          stroke="var(--border)"
        />
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={height - pad.bottom}
          y2={height - pad.bottom}
          stroke="var(--border)"
        />
        <text x={pad.left} y={height - 14} fill="var(--muted)" fontSize="10">
          Year 0
        </text>
        <text
          x={width - pad.right}
          y={height - 14}
          textAnchor="end"
          fill="var(--muted)"
          fontSize="10"
        >
          Year {maxYear}
        </text>
        {simulations.map((sim, seriesIndex) => {
          const snapshots = getSnapshots(sim);
          const color = SIM_COLORS[seriesIndex % SIM_COLORS.length];
          const d = snapshots
            .map(
              (s, i) =>
                `${i === 0 ? "M" : "L"} ${x(s.year)} ${y(Number(s[metricKey]) || 0)}`,
            )
            .join(" ");
          return (
            <path
              key={`${sim.id}-${metricKey}`}
              d={d}
              fill="none"
              stroke={color}
              strokeWidth="2.8"
              strokeDasharray={dash[seriesIndex % dash.length]}
              opacity="0.95"
            />
          );
        })}
      </svg>
      <div className="chart-legend">
        {simulations.map((sim, i) => (
          <div key={`${sim.id}-legend`} className="chart-legend-item">
            <span
              className="chart-legend-swatch"
              style={{ background: SIM_COLORS[i % SIM_COLORS.length] }}
            />
            <span>{sim.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("income");
  const [deleteConfirm, setDeleteConfirm] = useState(null); // holds sim object pending deletion
  // Default is light mode. The attribute is set here (during the state
  // initializer, before first paint) rather than only in an effect, so a
  // returning user with "dark" saved doesn't see a flash of the light
  // theme before it switches over.
  const [theme, setTheme] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("fp-theme") || "light";
      document.documentElement.setAttribute("data-theme", stored);
      return stored;
    }
    return "light";
  });

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("fp-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const [actualTakeHome, setActualTakeHome] = useState(5200);
  const [grossSalary, setGrossSalary] = useState(85000);

  // New: annual merit/raise assumption.
  const [salaryGrowth, setSalaryGrowth] = useState(3);

  // New: optionally grow contributions with salary.
  const [contributionGrowth, setContributionGrowth] = useState(true);

  const [age, setAge] = useState(30);

  const [k401Pct, setK401Pct] = useState(6);
  const [employerMatch, setEmployerMatch] = useState(3);
  const [employerMatchMax, setEmployerMatchMax] = useState(3);
  const [k401Balance, setK401Balance] = useState(0);
  const [k401Rate, setK401Rate] = useState(7);

  const [expenses, setExpenses] = useState([
    {
      id: 1,
      name: "Rent / Mortgage",
      category: "Housing",
      amount: 1500,
    },
    {
      id: 2,
      name: "Groceries",
      category: "Food",
      amount: 400,
    },
    {
      id: 3,
      name: "Car + gas",
      category: "Transport",
      amount: 550,
    },
    {
      id: 4,
      name: "Utilities",
      category: "Utilities",
      amount: 150,
    },
    {
      id: 5,
      name: "Phone",
      category: "Subscriptions",
      amount: 80,
    },
  ]);

  const [rothContrib, setRothContrib] = useState(500);
  const [rothBalance, setRothBalance] = useState(0);
  const [rothRate, setRothRate] = useState(7);

  const [brokerageContrib, setBrokerageContrib] = useState(300);
  const [brokerageBalance, setBrokerageBalance] = useState(0);
  const [brokerageRate, setBrokerageRate] = useState(7);

  const [initCash, setInitCash] = useState(0);
  const [cashRate, setCashRate] = useState(4);

  // Global projection setting — applies to every simulation, including in
  // comparisons, rather than being saved per-simulation.
  const [projYears, setProjYears] = useState(20);

  const nextId = () => Date.now();

  // ─── SIMULATIONS ─────────────────────────────────────────────────────────────
  // Each simulation keeps a complete copy of its inputs, so scenarios can be
  // branched, switched, and referenced without overwriting one another.
  // Projection length is intentionally NOT part of a simulation's saved
  // state — it's a single global control (see `projYears` above) so that
  // changing it applies consistently to every simulation everywhere,
  // including side-by-side comparisons.
  const defaultExpenses = [
    { id: 1, name: "Rent / Mortgage", category: "Housing", amount: 1500 },
    { id: 2, name: "Groceries", category: "Food", amount: 400 },
    { id: 3, name: "Car + gas", category: "Transport", amount: 550 },
    { id: 4, name: "Utilities", category: "Utilities", amount: 150 },
    { id: 5, name: "Phone", category: "Subscriptions", amount: 80 },
  ];

  const [simulationName, setSimulationName] = useState("Simulation 1");
  const [simulations, setSimulations] = useState([]);
  const [activeSimulationId, setActiveSimulationId] = useState(null);
  const [compareMetricKeys, setCompareMetricKeys] = useState([
    "total",
    "roth",
    "k401",
    "brokerage",
    "cash",
  ]);
  const [graphMetricKey, setGraphMetricKey] = useState("total");
  const [compareSimulationIds, setCompareSimulationIds] = useState([]);

  const compareMetrics = [
    { key: "total", label: "Total net worth" },
    { key: "roth", label: "Roth IRA" },
    { key: "k401", label: "401k" },
    { key: "brokerage", label: "Brokerage" },
    { key: "cash", label: "Cash" },
    { key: "gross", label: "Gross income" },
    { key: "takeHome", label: "Take-home" },
  ];

  const atSimulationLimit = simulations.length >= MAX_SIMULATIONS;

  const getCurrentSimulation = () => ({
    id: activeSimulationId,
    name: simulationName,
    tab,
    actualTakeHome,
    grossSalary,
    salaryGrowth,
    contributionGrowth,
    age,
    k401Pct,
    employerMatch,
    employerMatchMax,
    k401Balance,
    k401Rate,
    expenses,
    rothContrib,
    rothBalance,
    rothRate,
    brokerageContrib,
    brokerageBalance,
    brokerageRate,
    initCash,
    cashRate,
  });

  const applySimulation = (sim) => {
    setSimulationName(sim.name || "Untitled simulation");
    setTab(sim.tab || "income");
    setActualTakeHome(sim.actualTakeHome ?? 5200);
    setGrossSalary(sim.grossSalary ?? 85000);
    setSalaryGrowth(sim.salaryGrowth ?? 3);
    setContributionGrowth(sim.contributionGrowth ?? true);
    setAge(sim.age ?? 30);
    setK401Pct(sim.k401Pct ?? 6);
    setEmployerMatch(sim.employerMatch ?? 3);
    setEmployerMatchMax(sim.employerMatchMax ?? 3);
    setK401Balance(sim.k401Balance ?? 0);
    setK401Rate(sim.k401Rate ?? 7);
    setExpenses((sim.expenses || defaultExpenses).map((e) => ({ ...e })));
    setRothContrib(sim.rothContrib ?? 500);
    setRothBalance(sim.rothBalance ?? 0);
    setRothRate(sim.rothRate ?? 7);
    setBrokerageContrib(sim.brokerageContrib ?? 300);
    setBrokerageBalance(sim.brokerageBalance ?? 0);
    setBrokerageRate(sim.brokerageRate ?? 7);
    setInitCash(sim.initCash ?? 0);
    setCashRate(sim.cashRate ?? 4);
    // Note: projYears is intentionally left untouched here — it's global.
  };

  const freshSimulation = (id, name) => ({
    id,
    name,
    tab: "income",
    actualTakeHome: 5200,
    grossSalary: 85000,
    salaryGrowth: 3,
    contributionGrowth: true,
    age: 30,
    k401Pct: 6,
    employerMatch: 3,
    employerMatchMax: 3,
    k401Balance: 0,
    k401Rate: 7,
    expenses: defaultExpenses.map((e) => ({ ...e })),
    rothContrib: 500,
    rothBalance: 0,
    rothRate: 7,
    brokerageContrib: 300,
    brokerageBalance: 0,
    brokerageRate: 7,
    initCash: 0,
    cashRate: 4,
  });

  // JSON-file persistence is handled by the small local Node API.
  // We keep the app state in React and write the latest snapshot every 30 seconds.
  const hydratedRef = useRef(false);
  const stateRef = useRef({ simulations: [], activeSimulationId: null });
  const saveInFlightRef = useRef(false);
  const [saveStatus, setSaveStatus] = useState("loading");

  useEffect(() => {
    let cancelled = false;

    async function loadSimulationFile() {
      try {
        const response = await fetch("http://localhost:3001/api/simulation");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const parsed = await response.json();
        if (cancelled) return;

        if (Array.isArray(parsed.simulations) && parsed.simulations.length) {
          const active =
            parsed.simulations.find(
              (s) => s.id === parsed.activeSimulationId,
            ) || parsed.simulations[0];

          setSimulations(parsed.simulations.slice(0, MAX_SIMULATIONS));
          setActiveSimulationId(active.id);
          applySimulation(active);
          if (typeof parsed.projYears === "number") {
            setProjYears(parsed.projYears);
          }
        } else {
          const initial = freshSimulation(Date.now(), "Simulation 1");
          setActiveSimulationId(initial.id);
          setSimulationName(initial.name);
          setSimulations([initial]);
        }

        hydratedRef.current = true;
        setSaveStatus("saved");
      } catch (error) {
        console.error("Could not load simulation.json:", error);
        if (!cancelled) {
          const initial = freshSimulation(Date.now(), "Simulation 1");
          setActiveSimulationId(initial.id);
          setSimulationName(initial.name);
          setSimulations([initial]);
          hydratedRef.current = true;
          setSaveStatus("error");
        }
      }
    }

    loadSimulationFile();

    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the latest React state available to the fixed 30-second save timer.
  useEffect(() => {
    if (!hydratedRef.current || activeSimulationId == null) return;

    const current = getCurrentSimulation();
    setSimulations((prev) => {
      const next = prev.some((s) => s.id === activeSimulationId)
        ? prev.map((s) => (s.id === activeSimulationId ? current : s))
        : [...prev, current];

      stateRef.current = {
        simulations: next,
        activeSimulationId,
        projYears,
      };

      return next;
    });
  }, [
    activeSimulationId,
    simulationName,
    tab,
    actualTakeHome,
    grossSalary,
    salaryGrowth,
    contributionGrowth,
    age,
    k401Pct,
    employerMatch,
    employerMatchMax,
    k401Balance,
    k401Rate,
    expenses,
    rothContrib,
    rothBalance,
    rothRate,
    brokerageContrib,
    brokerageBalance,
    brokerageRate,
    initCash,
    cashRate,
    projYears,
  ]);

  // Save to data/simulation.json every 30 seconds.
  useEffect(() => {
    const saveToDisk = async () => {
      if (!hydratedRef.current || saveInFlightRef.current) return;

      const payload = stateRef.current;
      if (!payload.activeSimulationId || !payload.simulations.length) return;

      saveInFlightRef.current = true;
      setSaveStatus("saving");

      try {
        const response = await fetch("http://localhost:3001/api/simulation", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: 1,
            simulations: payload.simulations,
            activeSimulationId: payload.activeSimulationId,
            projYears: payload.projYears,
          }),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setSaveStatus("saved");
      } catch (error) {
        console.error("Could not save simulation.json:", error);
        setSaveStatus("error");
      } finally {
        saveInFlightRef.current = false;
      }
    };

    const timer = window.setInterval(saveToDisk, 10000);
    return () => window.clearInterval(timer);
  }, []);

  const createNewSimulation = () => {
    if (atSimulationLimit) return;

    const id = nextId();
    const current = getCurrentSimulation();
    // Copy all current values into the new sim, only override id and name
    const cloned = {
      ...current,
      id,
      name: `Simulation ${simulations.length + 1}`,
      expenses: (current.expenses || []).map((e) => ({ ...e })),
    };

    setSimulations((prev) => {
      const saved = prev.map((s) =>
        s.id === activeSimulationId ? current : s,
      );
      return [...saved, cloned];
    });

    setActiveSimulationId(id);
    applySimulation(cloned);
  };

  const switchSimulation = (id) => {
    if (id === activeSimulationId) return;
    const target = simulations.find((s) => s.id === id);
    if (!target) return;

    const current = getCurrentSimulation();
    setSimulations((prev) =>
      prev.map((s) => (s.id === activeSimulationId ? current : s)),
    );
    setActiveSimulationId(id);
    applySimulation(target);
  };

  const renameSimulation = (name) => setSimulationName(name);

  const deleteSimulation = (id) => {
    if (simulations.length <= 1) return;
    const target = simulations.find((s) => s.id === id);
    if (!target) return;

    const remaining = simulations.filter((s) => s.id !== id);
    const nextActiveId =
      id === activeSimulationId ? remaining[0].id : activeSimulationId;
    setSimulations(remaining);
    setCompareSimulationIds((ids) => ids.filter((simId) => simId !== id));
    if (id === activeSimulationId) {
      const next = remaining.find((s) => s.id === nextActiveId) || remaining[0];
      setActiveSimulationId(next.id);
      applySimulation(next);
    }
  };

  const toggleCompareSimulation = (id) => {
    setCompareSimulationIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  };

  const toggleCompareMetric = (key) => {
    setCompareMetricKeys((keys) =>
      keys.includes(key)
        ? keys.length === 1
          ? keys
          : keys.filter((x) => x !== key)
        : [...keys, key],
    );
  };

  const selectGraphMetric = (key) => setGraphMetricKey(key);

  const calc = useMemo(() => {
    const k401Annual = Math.min((k401Pct / 100) * grossSalary, K401_LIMIT);

    const k401Monthly = k401Annual / 12;

    const netMonthly = actualTakeHome;

    const netAnnual = netMonthly * 12;

    const matchPct = Math.min(employerMatch, employerMatchMax) / 100;

    const employerMatchAmt = grossSalary * matchPct;

    const totalExpenses = expenses.reduce(
      (s, e) => s + Math.max(e.amount, 0),
      0,
    );

    const afterExpenses = netMonthly - totalExpenses;

    const rothMonthly = Math.min(Math.max(rothContrib, 0), ROTH_LIMIT / 12);

    const rothAnnual = rothMonthly * 12;

    const brokerageAnnual = Math.max(brokerageContrib, 0) * 12;

    const totalInvesting =
      rothMonthly + Math.max(k401Monthly, 0) + Math.max(brokerageContrib, 0);

    const postTaxInvesting = rothMonthly + Math.max(brokerageContrib, 0);

    const leftoverMonthly = afterExpenses - postTaxInvesting;

    const leftoverAnnual = leftoverMonthly * 12;

    const housingExpense = expenses
      .filter((e) => e.category === "Housing")
      .reduce((s, e) => s + Math.max(e.amount, 0), 0);

    const debtExpense = expenses
      .filter((e) => e.category === "Debt")
      .reduce((s, e) => s + Math.max(e.amount, 0), 0);

    const housingTakeHomeRatio = housingExpense / (netMonthly || 1);

    const housingGrossRatio = housingExpense / (grossSalary / 12 || 1);

    const expenseRatio = totalExpenses / (netMonthly || 1);

    const investmentGrossRatio =
      (k401Annual + employerMatchAmt + rothAnnual + brokerageAnnual) /
      (grossSalary || 1);

    const investmentTakeHomeRatio =
      (postTaxInvesting * 12 + k401Annual + employerMatchAmt) /
      (netAnnual || 1);

    const surplusRatio = leftoverMonthly / (netMonthly || 1);

    const debtToIncome = debtExpense / (grossSalary / 12 || 1);

    const emergencyTarget = totalExpenses * 6;
    // Emergency fund = what you have saved + what you'll accumulate in the next year
    const emergencyAvailable = initCash + Math.max(leftoverAnnual, 0);
    const emergencyFunding = emergencyAvailable / (emergencyTarget || 1);

    // Health score out of 100.
    const healthScores = [
      // Housing vs take-home: max 20pts
      housingTakeHomeRatio <= 0.25
        ? 20
        : housingTakeHomeRatio <= 0.3
          ? 17
          : housingTakeHomeRatio <= 0.35
            ? 12
            : 4,
      // Total expense ratio: max 20pts
      expenseRatio <= 0.4
        ? 20
        : expenseRatio <= 0.5
          ? 17
          : expenseRatio <= 0.6
            ? 11
            : 4,
      // Investment rate of gross: max 25pts
      investmentGrossRatio >= 0.2
        ? 25
        : investmentGrossRatio >= 0.15
          ? 21
          : investmentGrossRatio >= 0.1
            ? 14
            : 7,
      // Cash surplus as % of take-home: max 15pts
      surplusRatio >= 0.15
        ? 15
        : surplusRatio >= 0.1
          ? 12
          : surplusRatio >= 0
            ? 7
            : 1,
      // Debt-to-income: max 10pts
      debtToIncome <= 0.1
        ? 10
        : debtToIncome <= 0.2
          ? 7
          : debtToIncome <= 0.36
            ? 4
            : 1,
      // Emergency fund (initCash + annual surplus vs 6mo expenses): max 10pts
      emergencyFunding >= 1.0
        ? 10
        : emergencyFunding >= 0.5
          ? 7
          : emergencyFunding >= 0.25
            ? 4
            : 1,
    ];

    const healthScore = Math.round(healthScores.reduce((a, b) => a + b, 0));

    let healthLabel = "Needs attention";

    if (healthScore >= 85) healthLabel = "Excellent";
    else if (healthScore >= 70) healthLabel = "Good";
    else if (healthScore >= 55) healthLabel = "Fair";

    const proj = projectAll({
      annualRoth: rothAnnual,
      annualK401: k401Annual,
      annualBrokerage: brokerageAnnual,
      annualLeftover: leftoverAnnual,
      years: projYears,
      rothRate: rothRate / 100,
      k401Rate: k401Rate / 100,
      brokerageRate: brokerageRate / 100,
      cashRate: cashRate / 100,
      initRoth: rothBalance,
      initK401: k401Balance,
      initBrokerage: brokerageBalance,
      initCash,
      salaryGrowth: salaryGrowth / 100,
      contributionGrowth,
      initialGross: grossSalary,
      initialTakeHome: netAnnual,
      k401Pct,
      employerMatch,
      employerMatchMax,
    });

    return {
      k401Annual,
      k401Monthly,
      netMonthly,
      netAnnual,
      employerMatchAmt,
      totalExpenses,
      afterExpenses,
      rothMonthly,
      rothAnnual,
      brokerageAnnual,
      totalInvesting,
      postTaxInvesting,
      leftoverMonthly,
      leftoverAnnual,
      housingExpense,
      debtExpense,
      housingTakeHomeRatio,
      housingGrossRatio,
      expenseRatio,
      investmentGrossRatio,
      investmentTakeHomeRatio,
      surplusRatio,
      debtToIncome,
      emergencyTarget,
      emergencyAvailable,
      emergencyFunding,
      healthScore,
      healthLabel,
      proj,
    };
  }, [
    actualTakeHome,
    grossSalary,
    salaryGrowth,
    contributionGrowth,
    age,
    k401Pct,
    employerMatch,
    employerMatchMax,
    k401Balance,
    k401Rate,
    expenses,
    rothContrib,
    rothBalance,
    rothRate,
    brokerageContrib,
    brokerageBalance,
    brokerageRate,
    initCash,
    cashRate,
    projYears,
  ]);

  const currentBenchmark = getAgeBenchmark(age);

  const currentNetWorth =
    rothBalance + k401Balance + brokerageBalance + initCash;

  const currentNetWorthStatus = getNetWorthStatus(
    currentNetWorth,
    currentBenchmark,
  );

  const finalAge = age + projYears;

  const finalBenchmark = getAgeBenchmark(finalAge);

  const finalStatus = getNetWorthStatus(calc.proj.total, finalBenchmark);

  const milestoneTargets = [100000, 250000, 500000, 1000000];

  const milestones = milestoneTargets.map((target) => {
    // "reached" = already there via entered balances OR already exceeded by year-1 projection
    const yearOneTotal = calc.proj.snapshots[0]?.total ?? 0;
    const reached = currentNetWorth >= target || yearOneTotal >= target;
    // "hit" = first year the projection crosses the target (only relevant if not already reached)
    const hit = reached
      ? null
      : calc.proj.snapshots.find((s) => s.total >= target);
    return { target, hit, reached };
  });

  // Maps the 4-bucket net-worth-vs-benchmark status into the same
  // healthy/watch/low status vocabulary the rest of the app uses for color.
  const netWorthStatusBucket = (status) =>
    status === "99th+" || status === "90th–99th" || status === "75th–90th"
      ? "healthy"
      : status === "50th–75th"
        ? "watch"
        : "low";

  const navItems = [
    { key: "income",   label: "Income",      icon: "＄" },
    { key: "expenses", label: "Expenses",    icon: "≡" },
    { key: "invest",   label: "Investments", icon: "◎" },
    { key: "outlook",  label: "Outlook",     icon: "→" },
    { key: "compare",  label: "Compare",     icon: "⇄" },
  ];

  const saveLabel =
    saveStatus === "loading" ? "Loading…"
    : saveStatus === "saving" ? "Saving…"
    : saveStatus === "error"  ? "Save failed"
    : "Saved";

  const saveCls =
    saveStatus === "error"   ? "status-low"
    : saveStatus === "saving" ? "status-watch"
    : saveStatus === "loading"? ""
    : "status-positive";

  // Shared sidebar content, rendered once for the persistent desktop
  // sidebar and once inside the mobile slide-in drawer, so nav items,
  // simulations, and the projection slider only exist in one place.
  // `onNavigate` additionally closes the mobile drawer after an action;
  // it's a no-op on desktop where there's no drawer to close.
  const renderSidebarContent = (onNavigate = () => {}) => (
    <div className="ft-sidebar-inner">
      {/* Brand */}
      <div className="ft-brand">FirePhin</div>

      {/* Nav */}
      <div className="ft-nav">
        {navItems.map(({ key, label, icon }) => (
          <button
            key={key}
            className={`ft-nav-item${tab === key ? " is-active" : ""}`}
            onClick={() => {
              setTab(key);
              onNavigate();
            }}
          >
            <span className="ft-nav-icon">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      <div className="ft-sidebar-divider" />

      {/* Simulations */}
      <div className="ft-sidebar-section">
        <div className="ft-sidebar-section-label">Simulations</div>
        {simulations.map((sim, index) => (
          <button
            key={sim.id}
            className={`ft-sim-item${sim.id === activeSimulationId ? " is-active" : ""}`}
            onClick={() => {
              switchSimulation(sim.id);
              onNavigate();
            }}
            title={sim.name}
          >
            <span className="ft-sim-item-name">
              {sim.name || `Simulation ${index + 1}`}
            </span>
            {simulations.length > 1 && (
              <span
                className="ft-sim-tab-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteConfirm(sim);
                }}
                role="button"
                aria-label={`Delete ${sim.name || `Simulation ${index + 1}`}`}
                title="Delete"
              >
                ×
              </span>
            )}
          </button>
        ))}
        <button
          className="ft-sim-add"
          onClick={() => {
            createNewSimulation();
            onNavigate();
          }}
          disabled={atSimulationLimit}
          title={atSimulationLimit ? `Max ${MAX_SIMULATIONS} simulations` : "New simulation"}
        >
          + New simulation
        </button>
        {atSimulationLimit && (
          <div className="ft-sim-limit-note">Max {MAX_SIMULATIONS} reached</div>
        )}
      </div>

      <div className="ft-sidebar-divider" />

      {/* Projection */}
      <div className="ft-sidebar-section">
        <div className="ft-sidebar-section-label">Projection</div>
        <div className="ft-sidebar-proj">
          <div className="ft-sidebar-proj-row">
            <span className="ft-projection-slider-label">Length</span>
            <span className="ft-projection-value">{projYears} yrs</span>
          </div>
          <input
            type="range"
            min={1}
            max={40}
            step={1}
            value={projYears}
            onChange={(e) => setProjYears(Number(e.target.value))}
          />
          <div className="ft-sidebar-age-range">Age {age} → {finalAge}</div>
        </div>
      </div>

      {/* Spacer pushes bottom controls down */}
      <div className="ft-sidebar-spacer" />

      {/* Theme + Save status */}
      <div className="ft-sidebar-bottom">
        <button
          className="ft-theme-toggle"
          onClick={toggleTheme}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? "☀" : "🌙"}
        </button>
        <div className={`ft-save-status ${saveCls}`}>{saveLabel}</div>
      </div>
    </div>
  );

  return (
    <div className="ft-shell">
      {/* ── LEFT SIDEBAR (desktop) ── */}
      <nav className="ft-sidebar">{renderSidebarContent()}</nav>

      {/* ── RIGHT COLUMN: header (mobile only) + scrolling content ── */}
      <div className="ft-right-col">
        {/* Mobile top header — in normal flow, sits above ft-main */}
        <header className="ft-mobile-header">
          <span className="ft-mobile-header-brand">FirePhin</span>
          <button
            className="ft-hamburger"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Open menu"
          >
            <span className="ft-hamburger-line"></span>
            <span className="ft-hamburger-line"></span>
            <span className="ft-hamburger-line"></span>
          </button>
        </header>

      {/* ── MAIN CONTENT ── */}
      <div className="ft-main">
        {/* Mobile sidebar backdrop */}
        {mobileSidebarOpen && (
          <div
            className="ft-sidebar-backdrop"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}

        {/* Mobile sidebar drawer — same content as the desktop sidebar,
            plus a close button, and every action also closes the drawer. */}
        <nav className={`ft-sidebar-drawer ${mobileSidebarOpen ? "is-open" : ""}`}>
          {renderSidebarContent(() => setMobileSidebarOpen(false))}
          <button
            className="ft-sidebar-close"
            onClick={() => setMobileSidebarOpen(false)}
            aria-label="Close menu"
          >
            ×
          </button>
        </nav>

        {/* FINANCIAL HEALTH - floating panel */}
        <FloatingHealthPanel
          calc={calc}
          pct={pct}
          getHealthStatus={getHealthStatus}
          statusClass={statusClass}
          statusLabel={statusLabel}
        />

        {tab === "compare" && (
          <CompareView
            simulations={simulations}
            compareSimulationIds={compareSimulationIds}
            setCompareSimulationIds={setCompareSimulationIds}
            compareMetricKeys={compareMetricKeys}
            compareMetrics={compareMetrics}
            graphMetricKey={graphMetricKey}
            selectGraphMetric={selectGraphMetric}
            toggleCompareSimulation={toggleCompareSimulation}
            toggleCompareMetric={toggleCompareMetric}
            projYears={projYears}
          />
        )}

        {tab === "income" && (
          <>
            <Summary calc={calc} />
            <div className="income-grid">
              {/* Left: Income & Identity */}
              <Card title="Income">
                <NumInput
                  label="Actual monthly take-home"
                  value={actualTakeHome}
                  onChange={setActualTakeHome}
                />

                <NumInput
                  label="Gross annual salary"
                  value={grossSalary}
                  onChange={setGrossSalary}
                />

                <NumInput
                  label="Current age"
                  value={age}
                  onChange={setAge}
                  prefix=""
                />

                <div style={{ marginTop: 14 }}>
                  <Slider
                    label="Annual merit / raise"
                    value={salaryGrowth}
                    min={0}
                    max={10}
                    step={0.5}
                    onChange={setSalaryGrowth}
                    display={salaryGrowth + "%"}
                  />

                  <InfoBox variant="muted">
                    For simplification, net and gross pay grows at {salaryGrowth}%/yr
                  </InfoBox>
                </div>
              </Card>

              {/* Right: 401k & Employer Match */}
              <Card title="401k & Employer Match">
                <Slider
                  label="401k contribution (% of gross)"
                  value={k401Pct}
                  min={0}
                  max={50}
                  step={0.5}
                  onChange={setK401Pct}
                  display={k401Pct + "%"}
                />

                <div className="income-401k-math">
                  <span>
                    {fmt(calc.k401Annual)}/yr · {fmt(calc.k401Monthly)}/mo
                  </span>
                  <span className="income-401k-limit">
                    Limit {fmt(K401_LIMIT)}
                  </span>
                </div>

                <Progress value={calc.k401Annual} max={K401_LIMIT} />

                <div style={{ marginTop: 18 }}>
                  <Label>Employer match</Label>
                  <div className="two-col gap-10">
                    <NumInput
                      label="Match %"
                      value={employerMatch}
                      onChange={setEmployerMatch}
                      prefix="%"
                    />
                    <NumInput
                      label="Up to % of salary"
                      value={employerMatchMax}
                      onChange={setEmployerMatchMax}
                      prefix="%"
                    />
                  </div>
                  <div className="income-match-preview">
                    Employer adds {fmt(calc.employerMatchAmt)}/yr · total{" "}
                    {fmt(calc.k401Annual + calc.employerMatchAmt)}/yr to 401k
                  </div>
                </div>

                <div style={{ marginTop: 16 }}>
                  <Row
                    label="Total to 401k / yr"
                    value={fmt(calc.k401Annual + calc.employerMatchAmt)}
                    highlight
                  />
                  <Row
                    label="401k limit utilization"
                    value={pct(calc.k401Annual / K401_LIMIT)}
                    valueColor={statusClass(
                      getHealthStatus(
                        calc.k401Annual / K401_LIMIT,
                        { good: 0.8, watch: 0.4 },
                      )
                    )}
                  />
                </div>

                <div className="toggle-row" style={{ marginTop: 14 }}>
                  <button
                    className={`toggle-btn${contributionGrowth ? " is-active" : ""}`}
                    onClick={() => setContributionGrowth(!contributionGrowth)}
                  >
                    {contributionGrowth
                      ? "Contribution growth: ON"
                      : "Contribution growth: OFF"}
                  </button>
                </div>

                <InfoBox variant="muted">
                  When ON, Roth and brokerage contributions scale with your
                  annual raise. Roth stays capped at the IRA limit.
                </InfoBox>
              </Card>
            </div>
          </>
        )}

        {/* EXPENSES */}
        {tab === "expenses" && (
          <>
            <Summary calc={calc} />
            <div className="two-col">
              <Card title="Monthly Expenses" badge={`${expenses.length} items`}>
                <div className="expense-header">
                  <span>Name</span>
                  <span>Category</span>
                  <span>Amount/mo</span>
                  <span />
                </div>

                {expenses.map((item) => (
                  <ExpenseRow
                    key={item.id}
                    item={item}
                    onChange={(u) =>
                      setExpenses(
                        expenses.map((e) => (e.id === item.id ? u : e)),
                      )
                    }
                    onRemove={() =>
                      setExpenses(expenses.filter((e) => e.id !== item.id))
                    }
                  />
                ))}

                <button
                  className="expense-add-btn"
                  onClick={() =>
                    setExpenses([
                      ...expenses,
                      {
                        id: nextId(),
                        name: "",
                        category: "Other",
                        amount: 0,
                      },
                    ])
                  }
                >
                  + Add expense
                </button>
              </Card>

              <div>
                <Card title="Expense Summary">
                  {CATEGORIES.filter((cat) =>
                    expenses.some((e) => e.category === cat),
                  ).map((cat) => {
                    const total = expenses
                      .filter((e) => e.category === cat)
                      .reduce((s, e) => s + e.amount, 0);

                    const ratio = total / (calc.netMonthly || 1);
                    const ratioClass =
                      ratio > 0.35
                        ? "status-low"
                        : ratio > 0.2
                          ? "status-watch"
                          : "status-healthy";
                    const barStatusClass =
                      ratio > 0.35
                        ? "status-low"
                        : ratio > 0.2
                          ? "status-watch"
                          : null;

                    return (
                      <div key={cat} className="expense-category-item">
                        <div className="expense-category-row">
                          <span>{cat}</span>

                          <span className={`expense-category-amount ${ratioClass}`}>
                            {fmt(total)}{" "}
                            <span className="expense-category-pct">
                              ({pct(ratio)})
                            </span>
                          </span>
                        </div>

                        <Progress
                          value={total}
                          max={calc.netMonthly}
                          statusClassName={barStatusClass}
                        />
                      </div>
                    );
                  })}

                  <div style={{ marginTop: 12 }}>
                    <Row
                      label="Total expenses / mo"
                      value={fmt(calc.totalExpenses)}
                      highlight
                    />

                    <Row label="Take-home / mo" value={fmt(calc.netMonthly)} />

                    <Row
                      label="Remaining after expenses"
                      value={fmt(calc.afterExpenses)}
                      highlight
                      valueColor={boolStatusClass(calc.afterExpenses >= 0)}
                    />

                    <Row
                      label="Housing / take-home"
                      value={pct(calc.housingTakeHomeRatio)}
                      valueColor={statusClass(
                        getHealthStatus(
                          calc.housingTakeHomeRatio,
                          {
                            good: 0.3,
                            watch: 0.35,
                          },
                          true,
                        ),
                      )}
                    />

                    <Row
                      label="Housing / gross"
                      value={pct(calc.housingGrossRatio)}
                    />
                  </div>

                  <InfoBox variant={calc.afterExpenses < 0 ? "red" : "accent"}>
                    {calc.afterExpenses < 0
                      ? "Expenses exceed take-home. Reduce spending or increase income."
                      : `You have ${fmt(
                          calc.afterExpenses,
                        )}/mo available after expenses.`}
                  </InfoBox>
                </Card>
              </div>
            </div>
          </>
        )}

        {/* INVESTMENTS */}
        {tab === "invest" && (
          <>
            <Summary calc={calc} />

            {/* Cash Reserve inputs + Waterfall — at top for visibility */}
            <div className="two-col">
              <Card title="Cash Reserve">
                <NumInput
                  label="Starting cash reserve"
                  value={initCash}
                  onChange={setInitCash}
                />

                <Slider
                  label="Cash / HYSA annual return"
                  value={cashRate}
                  min={0}
                  max={8}
                  step={0.25}
                  onChange={setCashRate}
                  display={cashRate + "%"}
                />
              </Card>

              <Card title="Monthly Cash Flow Waterfall">
                {[
                  {
                    label: "Take-home",
                    value: calc.netMonthly,
                    className: "u-text-default",
                  },
                  {
                    label: "– Expenses",
                    value: calc.totalExpenses,
                    className: "u-text-red",
                  },
                  {
                    label: "– Roth IRA",
                    value: calc.rothMonthly,
                    className: "u-text-accent",
                  },
                  {
                    label: "– Brokerage",
                    value: brokerageContrib,
                    className: "u-text-accent",
                  },
                  {
                    label: "= Cash surplus / mo",
                    value: calc.leftoverMonthly,
                    className:
                      calc.leftoverMonthly >= 0
                        ? "u-text-green"
                        : "u-text-red",
                  },
                ].map((r) => (
                  <Row
                    key={r.label}
                    label={r.label}
                    value={<span className={r.className}>{fmt(r.value)}</span>}
                  />
                ))}
              </Card>
            </div>

            {/* Three account cards below */}
            <div className="invest-account-grid">
              <Card title="Roth IRA" badge="Post-tax" accent>
                <NumInput
                  label="Monthly contribution"
                  value={rothContrib}
                  onChange={setRothContrib}
                />

                <div className="stat-sub" style={{ marginBottom: 6 }}>
                  Annual: {fmt(calc.rothAnnual)} · Limit: {fmt(ROTH_LIMIT)} ·{" "}
                </div>

                <Progress value={calc.rothAnnual} max={ROTH_LIMIT} />

                <div style={{ marginTop: 14 }}>
                  <NumInput
                    label="Current balance"
                    value={rothBalance}
                    onChange={setRothBalance}
                  />

                  <Slider
                    label="Annual return"
                    value={rothRate}
                    min={3}
                    max={12}
                    step={0.5}
                    onChange={setRothRate}
                    display={rothRate + "%"}
                  />
                </div>

                <InfoBox>Tax-free growth assuming Roth rules are satisfied.</InfoBox>
              </Card>

              <Card title="401k" badge="Pre-tax">

                <NumInput
                  label="Current balance"
                  value={k401Balance}
                  onChange={setK401Balance}
                />

                <Slider
                  label="Annual return"
                  value={k401Rate}
                  min={3}
                  max={12}
                  step={0.5}
                  onChange={setK401Rate}
                  display={k401Rate + "%"}
                />

                <Row
                  label={`Your contribution (${k401Pct}%)`}
                  value={`${fmt(calc.k401Annual)}/yr`}
                />

                <Row
                  label="Employer match"
                  value={`${fmt(calc.employerMatchAmt)}/yr`}
                />

                <Row
                  label="Total to 401k / yr"
                  value={fmt(calc.k401Annual + calc.employerMatchAmt)}
                  highlight
                />

                <InfoBox>
                  Tax-deferred growth. Withdrawals not modeled for taxes.
                </InfoBox>
              </Card>

              <Card title="Taxable Brokerage">
                <NumInput
                  label="Monthly contribution"
                  value={brokerageContrib}
                  onChange={setBrokerageContrib}
                />

                <NumInput
                  label="Current balance"
                  value={brokerageBalance}
                  onChange={setBrokerageBalance}
                />

                <Slider
                  label="Annual return"
                  value={brokerageRate}
                  min={3}
                  max={12}
                  step={0.5}
                  onChange={setBrokerageRate}
                  display={brokerageRate + "%"}
                />

                <InfoBox variant="green">
                  No contribution limit. Capital gains taxes are not modeled.
                </InfoBox>
              </Card>
            </div>
          </>
        )}

        {/* OUTLOOK */}
        {tab === "outlook" && (
          <>
            {/* Unified snapshot card — current cashflow on top row, projected accounts below */}
            <div className="outlook-snapshot-card">
              {/* Row 1: current monthly cashflow */}
              <div className="outlook-snapshot-section-label">Monthly cashflow</div>
              <div className="outlook-snapshot-row">
                {[
                  { label: "Take-home / mo", value: fmt(calc.netMonthly), className: "u-text-green", tone: "green" },
                  { label: "Monthly expenses", value: fmt(calc.totalExpenses), className: "u-text-red", tone: "red" },
                  { label: "After expenses", value: fmt(calc.afterExpenses), className: calc.afterExpenses >= 0 ? "u-text-green" : "u-text-red", tone: calc.afterExpenses >= 0 ? "green" : "red" },
                  { label: "Investing / mo", value: fmt(calc.totalInvesting), className: "u-text-accent", tone: "accent" },
                  { label: "Cash surplus / mo", value: fmt(calc.leftoverMonthly), className: calc.leftoverMonthly >= 0 ? "u-text-green" : "u-text-red", tone: calc.leftoverMonthly >= 0 ? "green" : "red" },
                ].map((s) => (
                  <div key={s.label} className={`outlook-snapshot-cell tone-${s.tone}`}>
                    <div className="outlook-snapshot-label">{s.label}</div>
                    <div className={`outlook-snapshot-value ${s.className}`}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Row 2: projected account balances */}
              <div className="outlook-snapshot-section-label">Projected balances · age {finalAge}</div>
              <div className="outlook-snapshot-row">
                {[
                  { label: "Roth IRA", value: fmt(calc.proj.roth), sub: `${rothRate}%/yr`, className: "u-text-accent", tone: "accent" },
                  { label: "401k", value: fmt(calc.proj.k401), sub: "incl. match", className: "u-text-yellow", tone: "yellow" },
                  { label: "Brokerage", value: fmt(calc.proj.brokerage), sub: `${brokerageRate}%/yr`, className: "u-text-green", tone: "green" },
                  { label: "Cash Reserve", value: fmt(calc.proj.cash), sub: `${cashRate}% APY`, className: "u-text-green", tone: "green" },
                  { label: "Total", value: fmt(calc.proj.total), sub: `age ${finalAge}`, className: "u-text-accent", tone: "accent" },
                ].map((s) => (
                  <div key={s.label} className={`outlook-snapshot-cell tone-${s.tone}`}>
                    <div className="outlook-snapshot-label">{s.label}</div>
                    <div className={`outlook-snapshot-value ${s.className}`}>{s.value}</div>
                    {s.sub && <div className="outlook-snapshot-sub">{s.sub}</div>}
                  </div>
                ))}
              </div>
            </div>

            <div>

              {/* NET WORTH BENCHMARK + MILESTONES side by side — after stat grid */}
              <div className="two-col">
                <Card title="Net Worth vs. Age Benchmark" accent>
                  {/* Current vs Projected in a compact 2-col header */}
                  <div className="benchmark-header-row">
                    <div className="benchmark-col">
                      <div className="benchmark-col-label">Now · Age {age}</div>
                      <div className="benchmark-col-value">{fmt(currentNetWorth)}</div>
                      <div
                        className={statusClass(netWorthStatusBucket(currentNetWorthStatus))}
                        style={{ color: "var(--status-color)", fontWeight: 700, fontSize: 12 }}
                      >
                        {currentNetWorthStatus}
                      </div>
                    </div>
                    <div className="benchmark-col">
                      <div className="benchmark-col-label">Projected · Age {finalAge}</div>
                      <div className="benchmark-col-value u-text-accent">{fmt(calc.proj.total)}</div>
                      <div
                        className={statusClass(netWorthStatusBucket(finalStatus))}
                        style={{ color: "var(--status-color)", fontWeight: 700, fontSize: 12 }}
                      >
                        {finalStatus}
                      </div>
                    </div>
                  </div>

                  {/* Compact percentile table */}
                  <div className="benchmark-pct-table">
                    <div className="benchmark-pct-head">
                      <span>Percentile</span>
                      <span>Age {age}</span>
                      <span>Age {finalAge}</span>
                    </div>
                    {[
                      { label: "25th", curr: currentBenchmark.p25, proj: finalBenchmark.p25 },
                      { label: "50th", curr: currentBenchmark.p50, proj: finalBenchmark.p50 },
                      { label: "75th", curr: currentBenchmark.p75, proj: finalBenchmark.p75 },
                      { label: "90th", curr: currentBenchmark.p90, proj: finalBenchmark.p90 },
                      { label: "99th", curr: currentBenchmark.p99, proj: finalBenchmark.p99, isTop: true },
                    ].map((row) => (
                      <div key={row.label} className={`benchmark-pct-row${row.isTop ? " is-p99" : ""}`}>
                        <span className={row.isTop ? "u-text-accent" : "u-text-muted"}>{row.label}</span>
                        <span className={row.isTop ? "u-text-accent" : ""}>{fmt(row.curr)}</span>
                        <span className={row.isTop ? "u-text-accent" : ""}>{fmt(row.proj)}</span>
                      </div>
                    ))}
                  </div>

                  <InfoBox variant="muted">
                    Approximate U.S. household net-worth reference points — directional context only.
                  </InfoBox>
                </Card>

                {/* MILESTONES */}
                <Card title="Financial Milestones">
                  <div className="milestone-stack">
                    {milestones.map((m) => (
                      <div
                        key={m.target}
                        className={`milestone-row-item${m.reached || m.hit ? " is-reached" : ""}`}
                      >
                        <div className="milestone-row-value">{fmt(m.target)}</div>
                        <div className={`milestone-row-status${m.reached || m.hit ? " is-reached" : ""}`}>
                          {m.reached
                            ? "✓ Already reached"
                            : m.hit
                              ? `✓ Yr ${m.hit.year} · Age ${age + m.hit.year}`
                              : "Beyond projection"}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              {/* YEAR BY YEAR */}
              <CollapsibleYearTable
                snapshots={calc.proj.snapshots}
                projYears={projYears}
                age={age}
                finalAge={finalAge}
                salaryGrowth={salaryGrowth}
                cashRate={cashRate}
              />

              <Card title="Annual Contributions">
                <Row label="Roth IRA / yr" value={fmt(calc.rothAnnual)} />

                <Row
                  label={`401k your contribution (${k401Pct}%)`}
                  value={fmt(calc.k401Annual)}
                />

                <Row
                  label="401k employer match"
                  value={fmt(calc.employerMatchAmt)}
                />

                <Row
                  label="Taxable brokerage / yr"
                  value={fmt(calc.brokerageAnnual)}
                />

                <Row
                  label="Total invested / yr"
                  value={fmt(
                    calc.rothAnnual +
                      calc.k401Annual +
                      calc.employerMatchAmt +
                      calc.brokerageAnnual,
                  )}
                  highlight
                />

                <Row
                  label="Cash surplus / yr"
                  value={fmt(calc.leftoverAnnual)}
                  valueColor={boolStatusClass(calc.leftoverAnnual >= 0)}
                />
              </Card>

              <SuggestionsStrip calc={calc} pct={pct} />
            </div>
          </>
        )}
      </div>{/* ft-main */}
      {deleteConfirm && (
        <div className="modal-backdrop" onClick={() => setDeleteConfirm(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Delete simulation?</div>
            <div className="modal-body">
              <strong>{deleteConfirm.name || "This simulation"}</strong> will be permanently removed.
            </div>
            <div className="modal-actions">
              <button className="modal-btn is-cancel" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
              <button
                className="modal-btn is-delete"
                onClick={() => {
                  deleteSimulation(deleteConfirm.id);
                  setDeleteConfirm(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      </div>{/* ft-right-col */}
    </div>
  );
}
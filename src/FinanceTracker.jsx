import { useState, useMemo, useEffect, useRef } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
// Kept configurable so you can update these as tax/benchmark data changes.
const ROTH_LIMIT = 7500;
const K401_LIMIT = 23000;

const FEDERAL_BRACKETS = [
  { max: 11600, rate: 0.10 },
  { max: 47150, rate: 0.12 },
  { max: 100525, rate: 0.22 },
  { max: 191950, rate: 0.24 },
  { max: 243725, rate: 0.32 },
  { max: 609350, rate: 0.35 },
  { max: Infinity, rate: 0.37 },
];

// Approximate U.S. household net-worth reference points by age.
// These are intentionally kept in one place so they can be replaced with
// updated Federal Reserve SCF data later.
const NET_WORTH_BENCHMARKS = [
  { minAge: 18, maxAge: 29, p25: 1000, p50: 10200, p75: 54800, p90: 189000 },
  { minAge: 30, maxAge: 34, p25: 7000, p50: 35700, p75: 135000, p90: 350000 },
  { minAge: 35, maxAge: 39, p25: 12000, p50: 67000, p75: 250000, p90: 600000 },
  { minAge: 40, maxAge: 44, p25: 20000, p50: 134000, p75: 400000, p90: 950000 },
  { minAge: 45, maxAge: 49, p25: 25000, p50: 180000, p75: 500000, p90: 1200000 },
  { minAge: 50, maxAge: 54, p25: 30000, p50: 290000, p75: 750000, p90: 1600000 },
  { minAge: 55, maxAge: 59, p25: 45000, p50: 380000, p75: 1000000, p90: 2200000 },
  { minAge: 60, maxAge: 64, p25: 70000, p50: 490000, p75: 1300000, p90: 2800000 },
  { minAge: 65, maxAge: 74, p25: 100000, p50: 580000, p75: 1500000, p90: 3200000 },
  { minAge: 75, maxAge: 100, p25: 90000, p50: 550000, p75: 1400000, p90: 3000000 },
];

function estimateFederalTax(taxableIncome) {
  let tax = 0;
  let prev = 0;

  for (const { max, rate } of FEDERAL_BRACKETS) {
    if (taxableIncome <= prev) break;
    tax += (Math.min(taxableIncome, max) - prev) * rate;
    prev = max;
  }

  return tax;
}

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
    NET_WORTH_BENCHMARKS.find(
      (b) => age >= b.minAge && age <= b.maxAge
    ) || NET_WORTH_BENCHMARKS[NET_WORTH_BENCHMARKS.length - 1]
  );
}

function getNetWorthStatus(value, benchmark) {
  if (value >= benchmark.p90) return "90th+";
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

function statusColor(status) {
  if (status === "healthy") return "var(--green)";
  if (status === "watch") return "var(--yellow)";
  return "var(--red)";
}

function statusLabel(status) {
  if (status === "healthy") return "Healthy";
  if (status === "watch") return "Watch";
  return "Needs attention";
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
  incomeMode,
  stateRate,
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
    0
  );
  const snapshots = [];

  for (let y = 1; y <= years; y++) {
    gross *= 1 + salaryGrowth;

    let employee401k = Math.min((k401Pct / 100) * gross, K401_LIMIT);

    if (incomeMode === 'prefill') {
      takeHomeAnnual *= 1 + salaryGrowth;
    } else {
      const taxableIncome = Math.max(gross - employee401k, 0);
      const federalTax = estimateFederalTax(taxableIncome);
      const stateTax = taxableIncome * (stateRate / 100);
      const fica = gross * 0.0765;
      takeHomeAnnual = gross - employee401k - federalTax - stateTax - fica;
    }

    const growthFactor = contributionGrowth
      ? Math.pow(1 + salaryGrowth, y)
      : 1;

    const yearlyRoth = Math.min(Math.max(baseAnnualRoth * growthFactor, 0), ROTH_LIMIT);
    const yearlyBrokerage = Math.max(baseAnnualBrokerage * growthFactor, 0);
    const yearlyExpenses = startingExpensesAnnual * growthFactor;
    const yearlyLeftover = takeHomeAnnual - yearlyExpenses - yearlyRoth - yearlyBrokerage;
    const employerMatchAmount = gross * (Math.min(employerMatchPct, employerMatchMax) / 100);

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
const Label = ({ children }) => (
  <div
    style={{
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.06em",
      color: "var(--muted)",
      marginBottom: 4,
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);

const Row = ({ label, value, highlight, sub, valueColor }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      padding: "7px 0",
      borderBottom: "1px solid var(--border)",
      gap: 12,
    }}
  >
    <span
      style={{
        color: sub ? "var(--muted)" : "var(--text)",
        fontSize: sub ? 13 : 14,
      }}
    >
      {label}
    </span>
    <span
      style={{
        fontWeight: highlight ? 700 : 500,
        color:
          valueColor ||
          (highlight ? "var(--accent)" : "var(--text)"),
        fontSize: 14,
        textAlign: "right",
      }}
    >
      {value}
    </span>
  </div>
);

const Card = ({ title, badge, children, accent }) => (
  <div
    style={{
      background: "var(--card)",
      borderRadius: 12,
      border: `1px solid ${
        accent ? "var(--accent)" : "var(--border)"
      }`,
      padding: "20px 22px",
      marginBottom: 18,
      boxShadow: accent
        ? "0 0 0 1px var(--accent-dim)"
        : "none",
    }}
  >
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 14,
        gap: 10,
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: 15,
          fontWeight: 700,
          color: "var(--text)",
        }}
      >
        {title}
      </h3>

      {badge && (
        <span
          style={{
            fontSize: 11,
            background: "var(--accent-dim)",
            color: "var(--accent)",
            borderRadius: 99,
            padding: "2px 10px",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {badge}
        </span>
      )}
    </div>

    {children}
  </div>
);

const Slider = ({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}) => (
  <div style={{ marginBottom: 14 }}>
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 4,
      }}
    >
      <Label>{label}</Label>
      <span
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "var(--accent)",
        }}
      >
        {display}
      </span>
    </div>

    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        width: "100%",
        accentColor: "var(--accent)",
      }}
    />

    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 10,
        color: "var(--muted)",
      }}
    >
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
  <div style={{ marginBottom: 12 }}>
    <Label>{label}</Label>

    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: "var(--input-bg)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        overflow: "hidden",
      }}
    >
      {prefix && (
        <span
          style={{
            padding: "0 10px",
            color: "var(--muted)",
            fontSize: 14,
            borderRight: "1px solid var(--border)",
          }}
        >
          {prefix}
        </span>
      )}

      <input
        type="number"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          flex: 1,
          padding: "9px 10px",
          border: "none",
          background: "transparent",
          color: "var(--text)",
          fontSize: 14,
          outline: "none",
          minWidth: 0,
        }}
      />

      {suffix && (
        <span
          style={{
            padding: "0 10px",
            color: "var(--muted)",
            fontSize: 13,
          }}
        >
          {suffix}
        </span>
      )}
    </div>
  </div>
);

const Tab = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    style={{
      padding: "8px 18px",
      borderRadius: 8,
      border: "none",
      cursor: "pointer",
      fontSize: 13,
      fontWeight: 600,
      background: active
        ? "var(--accent)"
        : "transparent",
      color: active ? "#fff" : "var(--muted)",
      transition: "all 0.15s",
    }}
  >
    {label}
  </button>
);

const Progress = ({ value, max, color }) => (
  <div
    style={{
      background: "var(--border)",
      borderRadius: 99,
      height: 6,
      marginTop: 4,
    }}
  >
    <div
      style={{
        width: `${Math.min(
          Math.max(value / (max || 1), 0),
          1
        ) * 100}%`,
        background: color || "var(--accent)",
        borderRadius: 99,
        height: 6,
        transition: "width 0.3s",
      }}
    />
  </div>
);

const InfoBox = ({
  children,
  color = "var(--accent)",
  bg = "var(--accent-dim)",
}) => (
  <div
    style={{
      padding: "10px 14px",
      background: bg,
      borderRadius: 8,
      fontSize: 12,
      color,
      marginTop: 8,
      lineHeight: 1.5,
    }}
  >
    {children}
  </div>
);

const HealthMetric = ({
  label,
  value,
  target,
  status,
}) => (
  <div
    style={{
      padding: "7px 0",
      borderBottom: "1px solid var(--border)",
    }}
  >
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </div>

        <div
          style={{
            fontSize: 9,
            color: "var(--muted)",
            marginTop: 1,
          }}
        >
          Target {target}
        </div>
      </div>

      <div
        style={{
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 800,
            color: statusColor(status),
          }}
        >
          {value}
        </div>

        <div
          style={{
            fontSize: 9,
            color: statusColor(status),
            fontWeight: 700,
          }}
        >
          {statusLabel(status)}
        </div>
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
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 130px 110px 32px",
        gap: 8,
        alignItems: "center",
        marginBottom: 8,
      }}
    >
      <input
        value={item.name}
        onChange={(e) =>
          onChange({
            ...item,
            name: e.target.value,
          })
        }
        placeholder="Expense name"
        style={{
          padding: "7px 10px",
          borderRadius: 7,
          border: "1px solid var(--border)",
          background: "var(--input-bg)",
          color: "var(--text)",
          fontSize: 13,
          minWidth: 0,
        }}
      />

      <select
        value={item.category}
        onChange={(e) =>
          onChange({
            ...item,
            category: e.target.value,
          })
        }
        style={{
          padding: "7px 10px",
          borderRadius: 7,
          border: "1px solid var(--border)",
          background: "var(--input-bg)",
          color: "var(--text)",
          fontSize: 13,
        }}
      >
        {CATEGORIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "var(--input-bg)",
          border: "1px solid var(--border)",
          borderRadius: 7,
        }}
      >
        <span
          style={{
            padding: "0 8px",
            color: "var(--muted)",
            fontSize: 13,
          }}
        >
          $
        </span>

        <input
          type="number"
          value={item.amount}
          onChange={(e) =>
            onChange({
              ...item,
              amount: Number(e.target.value),
            })
          }
          style={{
            width: "100%",
            padding: "7px 4px",
            border: "none",
            background: "transparent",
            color: "var(--text)",
            fontSize: 13,
            outline: "none",
          }}
        />
      </div>

      <button
        onClick={onRemove}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--muted)",
          fontSize: 18,
          lineHeight: 1,
        }}
      >
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
    <div style={{ overflowX: "auto", marginTop: 10 }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12,
        }}
      >
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                style={{
                  textAlign: "right",
                  padding: "4px 8px",
                  color: "var(--muted)",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {snapshots.map((s) => (
            <tr
              key={s.year}
              style={{
                borderTop: "1px solid var(--border)",
              }}
            >
              <td
                style={{
                  padding: "6px 8px",
                  color: "var(--muted)",
                  textAlign: "right",
                }}
              >
                Yr {s.year}
              </td>

              <td
                style={{
                  padding: "6px 8px",
                  textAlign: "right",
                }}
              >
                {fmt(s.gross)}
              </td>

              <td
                style={{
                  padding: "6px 8px",
                  textAlign: "right",
                }}
              >
                {fmt(s.takeHome)}
              </td>

              <td
                style={{
                  padding: "6px 8px",
                  color: "var(--accent)",
                  fontWeight: 600,
                  textAlign: "right",
                }}
              >
                {fmt(s.roth)}
              </td>

              <td
                style={{
                  padding: "6px 8px",
                  color: "var(--accent)",
                  fontWeight: 600,
                  textAlign: "right",
                }}
              >
                {fmt(s.k401)}
              </td>

              <td
                style={{
                  padding: "6px 8px",
                  color: "var(--accent)",
                  fontWeight: 600,
                  textAlign: "right",
                }}
              >
                {fmt(s.brokerage)}
              </td>

              <td
                style={{
                  padding: "6px 8px",
                  color:
                    s.cash >= 0
                      ? "var(--green)"
                      : "var(--red)",
                  fontWeight: 600,
                  textAlign: "right",
                }}
              >
                {fmt(s.cash)}
              </td>

              <td
                style={{
                  padding: "6px 8px",
                  color: "var(--text)",
                  fontWeight: 700,
                  textAlign: "right",
                }}
              >
                {fmt(s.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildProjectionFromSimulation(sim) {
  const expenses = Array.isArray(sim.expenses) ? sim.expenses : [];
  const totalExpenses = expenses.reduce((sum, e) => sum + Math.max(Number(e.amount) || 0, 0), 0);
  const grossSalary = Number(sim.grossSalary) || 0;
  const k401Annual = Math.min((Number(sim.k401Pct) || 0) / 100 * grossSalary, K401_LIMIT);
  const taxableIncome = Math.max(grossSalary - k401Annual, 0);
  const federalTax = estimateFederalTax(taxableIncome);
  const stateTax = taxableIncome * ((Number(sim.stateRate) || 0) / 100);
  const fica = grossSalary * 0.0765;
  const calculatedNetMonthly = (grossSalary - k401Annual - federalTax - stateTax - fica) / 12;
  const netMonthly = sim.incomeMode === "prefill"
    ? Number(sim.actualTakeHome) || 0
    : calculatedNetMonthly;
  const netAnnual = netMonthly * 12;
  const matchPct = Math.min(Number(sim.employerMatch) || 0, Number(sim.employerMatchMax) || 0) / 100;
  const employerMatchAmt = grossSalary * matchPct;
  const rothMonthly = Math.min(Math.max(Number(sim.rothContrib) || 0, 0), ROTH_LIMIT / 12);
  const rothAnnual = rothMonthly * 12;
  const brokerageAnnual = Math.max(Number(sim.brokerageContrib) || 0, 0) * 12;
  const leftoverAnnual = (netMonthly - totalExpenses - rothMonthly - Math.max(Number(sim.brokerageContrib) || 0, 0)) * 12;

  return projectAll({
    annualRoth: rothAnnual,
    annualK401: k401Annual,
    annualBrokerage: brokerageAnnual,
    annualLeftover: leftoverAnnual,
    years: Number(sim.projYears) || 20,
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
    incomeMode: sim.incomeMode,
    stateRate: Number(sim.stateRate) || 0,
    k401Pct: Number(sim.k401Pct) || 0,
    employerMatch: Number(sim.employerMatch) || 0,
    employerMatchMax: Number(sim.employerMatchMax) || 0,
  });
}


function CollapsibleYearTable({ snapshots, projYears, age, finalAge, salaryGrowth, cashRate }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          background: "var(--card)",
          borderRadius: 12,
          border: "1px solid var(--accent)",
          boxShadow: "0 0 0 1px var(--accent-dim)",
          overflow: "hidden",
        }}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            width: "100%",
            padding: "16px 22px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            Year-by-year breakdown — {projYears} year projection
          </span>
          <span style={{ fontSize: 18, color: "var(--accent)", lineHeight: 1, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
            ▾
          </span>
        </button>
        {open && (
          <div style={{ padding: "0 22px 18px" }}>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
              Starting age: {age}. Final age: {finalAge}. Salary grows {salaryGrowth}% annually. Cash earns {cashRate}% APY.
            </div>
            <SnapshotTable snapshots={snapshots} />
          </div>
        )}
      </div>
    </div>
  );
}


// ─── FLOATING HEALTH PANEL ────────────────────────────────────────────────────
function FloatingHealthPanel({ calc, pct, getHealthStatus, statusColor, statusLabel }) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 860);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const score = calc.healthScore;
  const scoreColor = score >= 85 ? "var(--green)" : score >= 70 ? "var(--yellow)" : "var(--red)";

  const metrics = [
    {
      label: "Housing",
      value: pct(calc.housingTakeHomeRatio),
      target: "< 30%",
      status: getHealthStatus(calc.housingTakeHomeRatio, { good: 0.3, watch: 0.35 }, true),
    },
    {
      label: "Expenses",
      value: pct(calc.expenseRatio),
      target: "< 50%",
      status: getHealthStatus(calc.expenseRatio, { good: 0.5, watch: 0.6 }, true),
    },
    {
      label: "Investing",
      value: pct(calc.investmentGrossRatio),
      target: "≥ 15%",
      status: calc.investmentGrossRatio >= 0.15 ? "healthy" : calc.investmentGrossRatio >= 0.10 ? "watch" : "low",
    },
    {
      label: "Cash buffer",
      value: pct(calc.surplusRatio),
      target: "≥ 10%",
      status: calc.surplusRatio >= 0.1 ? "healthy" : calc.surplusRatio >= 0 ? "watch" : "low",
    },
    {
      label: "Debt",
      value: pct(calc.debtToIncome),
      target: "< 20%",
      status: getHealthStatus(calc.debtToIncome, { good: 0.2, watch: 0.36 }, true),
    },
    {
      label: "Emergency",
      value: `${Math.min(calc.emergencyFunding * 100, 999).toFixed(0)}%`,
      target: "6 months",
      status: calc.emergencyFunding >= 1 ? "healthy" : calc.emergencyFunding >= 0.5 ? "watch" : "low",
    },
  ];

  const panelContent = (
    <div style={{ padding: "0 16px 16px" }}>
      {/* Score row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--border)", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Overall score</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: scoreColor, lineHeight: 1.1, marginTop: 2 }}>
            {score}<span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>/100</span>
          </div>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: scoreColor }}>{calc.healthLabel}</div>
      </div>
      {metrics.map((m) => (
        <HealthMetric key={m.label} label={m.label} value={m.value} target={m.target} status={m.status} />
      ))}
    </div>
  );

  if (isMobile) {
    // Mobile: sticky button + slide-up drawer
    return (
      <>
        {/* Floating button */}
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 200,
            width: 52,
            height: 52,
            borderRadius: "50%",
            border: `2px solid ${scoreColor}`,
            background: "var(--card)",
            color: scoreColor,
            fontSize: 11,
            fontWeight: 800,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            boxShadow: `0 0 0 4px ${scoreColor}22, 0 4px 24px rgba(0,0,0,0.5)`,
            lineHeight: 1.1,
          }}
        >
          <span style={{ fontSize: 15 }}>❤</span>
          <span>{score}</span>
        </button>

        {/* Backdrop */}
        {open && (
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 199, background: "rgba(0,0,0,0.5)" }}
          />
        )}

        {/* Drawer */}
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 200,
            background: "var(--card)",
            borderTop: `2px solid ${scoreColor}`,
            borderRadius: "16px 16px 0 0",
            transform: open ? "translateY(0)" : "translateY(105%)",
            transition: "transform 0.28s cubic-bezier(0.32,0.72,0,1)",
            maxHeight: "80vh",
            overflowY: "auto",
          }}
        >
          <div style={{ padding: "12px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
              Financial Health <span style={{ fontSize: 11, background: "var(--accent-dim)", color: "var(--accent)", borderRadius: 99, padding: "1px 8px", marginLeft: 6 }}>{score}/100</span>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 22, cursor: "pointer", padding: "0 4px" }}>×</button>
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
          onClick={() => setOpen(true)}
          style={{
            position: "fixed",
            top: "50%",
            right: 0,
            zIndex: 200,
            transform: "translateY(-50%)",
            background: "var(--card)",
            border: `1px solid ${scoreColor}`,
            borderRight: "none",
            borderRadius: "10px 0 0 10px",
            padding: "12px 8px",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            boxShadow: `-2px 0 16px rgba(0,0,0,0.3)`,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 800, color: scoreColor }}>{score}</span>
          <span style={{ fontSize: 9, color: "var(--muted)", writingMode: "vertical-rl", textOrientation: "mixed", letterSpacing: "0.08em", textTransform: "uppercase" }}>Health</span>
          <span style={{ fontSize: 10, color: scoreColor }}>◂</span>
        </button>
      )}

      {/* Floating panel */}
      <div
        style={{
          position: "fixed",
          top: 70,
          right: open ? 0 : -320,
          width: 300,
          zIndex: 200,
          background: "var(--card)",
          border: `1px solid ${scoreColor}`,
          borderRight: "none",
          borderRadius: "12px 0 0 12px",
          boxShadow: "-4px 0 32px rgba(0,0,0,0.4)",
          transition: "right 0.25s cubic-bezier(0.32,0.72,0,1)",
          maxHeight: "calc(100vh - 90px)",
          overflowY: "auto",
        }}
      >
        <div style={{ padding: "12px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "var(--card)", zIndex: 1, borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
            Financial Health <span style={{ fontSize: 11, background: "var(--accent-dim)", color: "var(--accent)", borderRadius: 99, padding: "1px 8px", marginLeft: 6 }}>{score}/100</span>
          </div>
          <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 20, cursor: "pointer", padding: "0 2px" }}>×</button>
        </div>
        {panelContent}
      </div>
    </>
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
}) {
  const selectedIds = compareSimulationIds.length
    ? compareSimulationIds
    : simulations.map((s) => s.id);
  const selectedSims = simulations.filter((s) => selectedIds.includes(s.id));
  const metricMap = Object.fromEntries(compareMetrics.map((m) => [m.key, m]));

  const getSeriesValue = (snapshot, key) => snapshot?.[key] ?? 0;
  const snapshots = selectedSims.reduce((all, sim) => {
    (sim.projection?.snapshots || buildProjectionFromSimulation(sim).snapshots).forEach((snapshot) => {
      if (!all.some((x) => x.year === snapshot.year)) all.push({ year: snapshot.year });
    });
    return all;
  }, []).sort((a, b) => a.year - b.year);

  const finalYear = snapshots[snapshots.length - 1]?.year || 0;

  return (
    <div>
      <Card title="Compare simulations" accent>
        <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
          Compare saved scenarios side by side.
        </div>
        <div>
          <Label>Simulations</Label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              onClick={() => setCompareSimulationIds([])}
              style={{
                padding: "7px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: compareSimulationIds.length === 0 ? "var(--accent-dim)" : "var(--input-bg)",
                color: compareSimulationIds.length === 0 ? "var(--accent)" : "var(--muted)",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              All simulations
            </button>
            {simulations.map((sim) => {
              const active = selectedIds.includes(sim.id);
              return (
                <button
                  key={sim.id}
                  onClick={() => toggleCompareSimulation(sim.id)}
                  style={{
                    padding: "7px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: active ? "var(--accent-dim)" : "var(--input-bg)",
                    color: active ? "var(--accent)" : "var(--muted)",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  {active ? "✓ " : ""}{sim.name}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {selectedSims.length === 0 ? (
        <Card title="No simulations selected">
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Select at least one simulation to compare.</div>
        </Card>
      ) : (
        <>
          <Card title="Growth graph" accent>
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>
                Metric to graph — one metric keeps differences readable across simulations.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {compareMetrics.map((metric) => {
                  const active = graphMetricKey === metric.key;
                  return (
                    <button
                      key={`graph-${metric.key}`}
                      onClick={() => selectGraphMetric(metric.key)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: active ? "var(--accent-dim)" : "var(--input-bg)",
                        color: active ? "var(--text)" : "var(--muted)",
                        cursor: "pointer",
                        fontWeight: 700,
                        fontSize: 12,
                      }}
                    >
                      {active ? "● " : ""}{metric.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <ComparisonChart simulations={selectedSims} metricKey={graphMetricKey} metric={metricMap[graphMetricKey]} />
          </Card>

          <Card title={`Comparison table${finalYear ? ` — through year ${finalYear}` : ""}`}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>
                Table metrics — choose which columns appear in the table below.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {compareMetrics.map((metric) => {
                  const active = compareMetricKeys.includes(metric.key);
                  return (
                    <button
                      key={metric.key}
                      onClick={() => toggleCompareMetric(metric.key)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: active ? "var(--accent-dim)" : "var(--input-bg)",
                        color: active ? "var(--text)" : "var(--muted)",
                        cursor: "pointer",
                        fontWeight: 700,
                        fontSize: 12,
                      }}
                    >
                      {active ? "✓ " : ""}{metric.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 700 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "7px 8px", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>Year</th>
                    {selectedSims.flatMap((sim) => compareMetricKeys.map((key) => (
                      <th key={`${sim.id}-${key}`} style={{ textAlign: "right", padding: "7px 8px", color: metricMap[key].color, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                        {sim.name} · {metricMap[key].label}
                      </th>
                    )))}
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((row) => (
                    <tr key={row.year}>
                      <td style={{ padding: "7px 8px", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>Yr {row.year}</td>
                      {selectedSims.flatMap((sim) => compareMetricKeys.map((key) => {
                        const snapshot = (sim.projection?.snapshots || buildProjectionFromSimulation(sim).snapshots).find((s) => s.year === row.year);
                        return (
                          <td key={`${sim.id}-${key}-${row.year}`} style={{ textAlign: "right", padding: "7px 8px", borderBottom: "1px solid var(--border)", fontWeight: 650 }}>
                            {fmt(getSeriesValue(snapshot, key))}
                          </td>
                        );
                      }))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function fmtShort(n) {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return n.toFixed(0);
}

const SIM_COLORS = [
  "#6c8ef5", "#4ade80", "#fbbf24", "#f472b6", "#38bdf8", "#fb923c", "#a78bfa",
];

function ComparisonChart({ simulations, metricKey, metric }) {
  const width = 960;
  const height = 420;
  const pad = { left: 78, right: 24, top: 24, bottom: 42 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const getSnapshots = (sim) => sim.projection?.snapshots || buildProjectionFromSimulation(sim).snapshots;
  const maxYear = Math.max(1, ...simulations.flatMap((sim) => getSnapshots(sim).map((x) => x.year)));
  const points = simulations.flatMap((sim) => getSnapshots(sim).map((s) => Number(s[metricKey]) || 0));
  const maxValue = Math.max(1, ...points);
  const minValue = Math.min(0, ...points);
  const valueRange = Math.max(1, maxValue - minValue);
  const x = (year) => pad.left + (year / maxYear) * innerW;
  const y = (value) => pad.top + innerH - ((value - minValue) / valueRange) * innerH;
  const ticks = 5;
  const dash = ["0", "7 5", "2 4", "10 5 2 5", "14 5 2 5 2 5"];

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", minWidth: 680, height: "auto", display: "block" }} role="img" aria-label={`${metric?.label || metricKey} simulation comparison chart`}>
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const value = minValue + (valueRange / ticks) * i;
          const yy = y(value);
          return (
            <g key={i}>
              <line x1={pad.left} x2={width - pad.right} y1={yy} y2={yy} stroke="var(--border)" />
              <text x={pad.left - 8} y={yy + 4} textAnchor="end" fill="var(--muted)" fontSize="11">{fmtShort(value)}</text>
            </g>
          );
        })}
        <line x1={pad.left} x2={pad.left} y1={pad.top} y2={height - pad.bottom} stroke="var(--border)" />
        <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} stroke="var(--border)" />
        <text x={pad.left} y={height - 14} fill="var(--muted)" fontSize="10">Year 0</text>
        <text x={width - pad.right} y={height - 14} textAnchor="end" fill="var(--muted)" fontSize="10">Year {maxYear}</text>
        {simulations.map((sim, seriesIndex) => {
          const snapshots = getSnapshots(sim);
          const color = SIM_COLORS[seriesIndex % SIM_COLORS.length];
          const d = snapshots.map((s, i) => `${i === 0 ? "M" : "L"} ${x(s.year)} ${y(Number(s[metricKey]) || 0)}`).join(" ");
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
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 14px", padding: "8px 4px 0", fontSize: 12 }}>
        {simulations.map((sim, i) => (
          <div key={`${sim.id}-legend`} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text)" }}>
            <span style={{ width: 20, height: 3, display: "inline-block", background: SIM_COLORS[i % SIM_COLORS.length], borderRadius: 2 }} />
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

  const [incomeMode, setIncomeMode] = useState("prefill");
  const [actualTakeHome, setActualTakeHome] = useState(5200);
  const [grossSalary, setGrossSalary] = useState(85000);
  const [stateRate, setStateRate] = useState(5);

  // New: annual merit/raise assumption.
  const [salaryGrowth, setSalaryGrowth] = useState(3);

  // New: optionally grow contributions with salary.
  const [contributionGrowth, setContributionGrowth] =
    useState(true);

  const [age, setAge] = useState(30);

  const [k401Pct, setK401Pct] = useState(6);
  const [employerMatch, setEmployerMatch] = useState(3);
  const [employerMatchMax, setEmployerMatchMax] =
    useState(3);
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

  const [brokerageContrib, setBrokerageContrib] =
    useState(300);
  const [brokerageBalance, setBrokerageBalance] =
    useState(0);
  const [brokerageRate, setBrokerageRate] = useState(7);

  const [initCash, setInitCash] = useState(0);
  const [cashRate, setCashRate] = useState(4);

  const [projYears, setProjYears] = useState(20);

  const nextId = () => Date.now();

  // ─── SIMULATIONS ─────────────────────────────────────────────────────────────
  // Each simulation keeps a complete copy of its inputs, so scenarios can be
  // branched, switched, and referenced without overwriting one another.
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
  const [compareMetricKeys, setCompareMetricKeys] = useState(["total", "roth", "k401", "brokerage", "cash"]);
  const [graphMetricKey, setGraphMetricKey] = useState("total");
  const [compareSimulationIds, setCompareSimulationIds] = useState([]);

  const compareMetrics = [
    { key: "total", label: "Total net worth", color: "var(--accent)" },
    { key: "roth", label: "Roth IRA", color: "var(--green)" },
    { key: "k401", label: "401k", color: "var(--yellow)" },
    { key: "brokerage", label: "Brokerage", color: "#c084fc" },
    { key: "cash", label: "Cash", color: "#fb7185" },
    { key: "gross", label: "Gross income", color: "#38bdf8" },
    { key: "takeHome", label: "Take-home", color: "#a3e635" },
  ];

  const getCurrentSimulation = () => ({
    id: activeSimulationId,
    name: simulationName,
    tab,
    incomeMode,
    actualTakeHome,
    grossSalary,
    stateRate,
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
  });

  const applySimulation = (sim) => {
    setSimulationName(sim.name || "Untitled simulation");
    setTab(sim.tab || "income");
    setIncomeMode(sim.incomeMode ?? "prefill");
    setActualTakeHome(sim.actualTakeHome ?? 5200);
    setGrossSalary(sim.grossSalary ?? 85000);
    setStateRate(sim.stateRate ?? 5);
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
    setProjYears(sim.projYears ?? 20);
  };

  const freshSimulation = (id, name) => ({
    id,
    name,
    tab: "income",
    incomeMode: "prefill",
    actualTakeHome: 5200,
    grossSalary: 85000,
    stateRate: 5,
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
    projYears: 20,
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
            parsed.simulations.find((s) => s.id === parsed.activeSimulationId) ||
            parsed.simulations[0];

          setSimulations(parsed.simulations);
          setActiveSimulationId(active.id);
          applySimulation(active);
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
      };

      return next;
    });
  }, [
    activeSimulationId, simulationName, tab, incomeMode, actualTakeHome,
    grossSalary, stateRate, salaryGrowth, contributionGrowth, age, k401Pct,
    employerMatch, employerMatchMax, k401Balance, k401Rate, expenses,
    rothContrib, rothBalance, rothRate, brokerageContrib, brokerageBalance,
    brokerageRate, initCash, cashRate, projYears,
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
    const id = nextId();
    const current = getCurrentSimulation();
    // Copy all current values into the new sim, only override id and name
    const cloned = {
      ...current,
      id,
      name: `Simulation ${simulations.length + 1}`,
      expenses: (current.expenses || []).map(e => ({ ...e })),
    };

    setSimulations((prev) => {
      const saved = prev.map((s) =>
        s.id === activeSimulationId ? current : s
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
      prev.map((s) => (s.id === activeSimulationId ? current : s))
    );
    setActiveSimulationId(id);
    applySimulation(target);
  };

  const renameSimulation = (name) => setSimulationName(name);

  const deleteSimulation = (id) => {
    if (simulations.length <= 1) return;
    const target = simulations.find((s) => s.id === id);
    if (!target) return;
    if (window.confirm(`Delete “${target.name || "this simulation"}”? This cannot be undone.`) === false) return;
    const remaining = simulations.filter((s) => s.id !== id);
    const nextActiveId = id === activeSimulationId ? remaining[0].id : activeSimulationId;
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
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    );
  };

  const toggleCompareMetric = (key) => {
    setCompareMetricKeys((keys) =>
      keys.includes(key)
        ? keys.length === 1 ? keys : keys.filter((x) => x !== key)
        : [...keys, key]
    );
  };

  const selectGraphMetric = (key) => setGraphMetricKey(key);

  const calc = useMemo(() => {
    const k401Annual = Math.min(
      (k401Pct / 100) * grossSalary,
      K401_LIMIT
    );

    const k401Monthly = k401Annual / 12;

    const taxableIncome = Math.max(
      grossSalary - k401Annual,
      0
    );

    const federalTax =
      estimateFederalTax(taxableIncome);

    const stateTax =
      taxableIncome * (stateRate / 100);

    const fica = grossSalary * 0.0765;

    const totalTax =
      federalTax + stateTax + fica;

    const calcNetAnnual =
      grossSalary -
      k401Annual -
      totalTax;

    const calcNetMonthly =
      calcNetAnnual / 12;

    const netMonthly =
      incomeMode === "prefill"
        ? actualTakeHome
        : calcNetMonthly;

    const netAnnual = netMonthly * 12;

    const matchPct =
      Math.min(
        employerMatch,
        employerMatchMax
      ) / 100;

    const employerMatchAmt =
      grossSalary * matchPct;

    const taxWithout =
      estimateFederalTax(grossSalary) +
      grossSalary * (stateRate / 100);

    const taxSavings =
      taxWithout -
      federalTax -
      stateTax;

    let marginalRate = 0.37;

    for (const { max, rate } of FEDERAL_BRACKETS) {
      if (taxableIncome <= max) {
        marginalRate = rate;
        break;
      }
    }

    const totalExpenses =
      expenses.reduce(
        (s, e) => s + Math.max(e.amount, 0),
        0
      );

    const afterExpenses =
      netMonthly - totalExpenses;

    const rothMonthly = Math.min(
      Math.max(rothContrib, 0),
      ROTH_LIMIT / 12
    );

    const rothAnnual =
      rothMonthly * 12;

    const brokerageAnnual =
      Math.max(brokerageContrib, 0) * 12;

    const totalInvesting =
      rothMonthly +
      Math.max(k401Monthly, 0) +
      Math.max(brokerageContrib, 0);

    const postTaxInvesting =
      rothMonthly +
      Math.max(brokerageContrib, 0);

    const leftoverMonthly =
      afterExpenses -
      postTaxInvesting;

    const leftoverAnnual =
      leftoverMonthly * 12;

    const housingExpense =
      expenses
        .filter(
          (e) => e.category === "Housing"
        )
        .reduce(
          (s, e) => s + Math.max(e.amount, 0),
          0
        );

    const debtExpense =
      expenses
        .filter(
          (e) => e.category === "Debt"
        )
        .reduce(
          (s, e) => s + Math.max(e.amount, 0),
          0
        );

    const housingTakeHomeRatio =
      housingExpense / (netMonthly || 1);

    const housingGrossRatio =
      housingExpense / ((grossSalary / 12) || 1);

    const expenseRatio =
      totalExpenses / (netMonthly || 1);

    const investmentGrossRatio =
      ((k401Annual +
        employerMatchAmt +
        rothAnnual +
        brokerageAnnual) /
        (grossSalary || 1));

    const investmentTakeHomeRatio =
      ((postTaxInvesting * 12) +
        k401Annual +
        employerMatchAmt) /
      (netAnnual || 1);

    const surplusRatio =
      leftoverMonthly / (netMonthly || 1);

    const debtToIncome =
      debtExpense / ((grossSalary / 12) || 1);

    const emergencyTarget =
      totalExpenses * 6;

    const emergencyFunding =
      initCash /
      (emergencyTarget || 1);

    // Health score out of 100.
    const healthScores = [
      Math.min(
        housingTakeHomeRatio <= 0.3
          ? 20
          : housingTakeHomeRatio <= 0.35
          ? 13
          : 5,
        20
      ),
      Math.min(
        expenseRatio <= 0.5
          ? 20
          : expenseRatio <= 0.6
          ? 13
          : 5,
        20
      ),
      Math.min(
        investmentGrossRatio >= 0.2
          ? 25
          : investmentGrossRatio >= 0.15
          ? 21
          : investmentGrossRatio >= 0.1
          ? 14
          : 7,
        25
      ),
      Math.min(
        surplusRatio >= 0.1
          ? 15
          : surplusRatio >= 0
          ? 9
          : 2,
        15
      ),
      Math.min(
        debtToIncome <= 0.1
          ? 10
          : debtToIncome <= 0.2
          ? 7
          : debtToIncome <= 0.36
          ? 4
          : 1,
        10
      ),
    ];

    const healthScore = Math.round(
      healthScores.reduce((a, b) => a + b, 0)
    );

    let healthLabel = "Needs attention";

    if (healthScore >= 85)
      healthLabel = "Excellent";
    else if (healthScore >= 70)
      healthLabel = "Good";
    else if (healthScore >= 55)
      healthLabel = "Fair";

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
      incomeMode,
      stateRate,
      k401Pct,
      employerMatch,
      employerMatchMax,
    });

    return {
      k401Annual,
      k401Monthly,
      taxableIncome,
      federalTax,
      stateTax,
      fica,
      totalTax,
      calcNetMonthly,
      netMonthly,
      netAnnual,
      employerMatchAmt,
      taxSavings,
      marginalRate,
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
      emergencyFunding,
      healthScore,
      healthLabel,
      proj,
    };
  }, [
    incomeMode,
    actualTakeHome,
    grossSalary,
    stateRate,
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

  const currentBenchmark =
    getAgeBenchmark(age);

  const currentNetWorth =
    rothBalance +
    k401Balance +
    brokerageBalance +
    initCash;

  const currentNetWorthStatus =
    getNetWorthStatus(
      currentNetWorth,
      currentBenchmark
    );

  const finalAge =
    age + projYears;

  const finalBenchmark =
    getAgeBenchmark(finalAge);

  const finalStatus =
    getNetWorthStatus(
      calc.proj.total,
      finalBenchmark
    );

  const milestoneTargets = [
    100000,
    250000,
    500000,
    1000000,
  ];

  const milestones = milestoneTargets.map(
    (target) => {
      const hit = calc.proj.snapshots.find(
        (s) => s.total >= target
      );

      return {
        target,
        hit,
        reached:
          currentNetWorth >= target,
      };
    }
  );

  const styles = `
    :root {
      --bg: #0f1117;
      --card: #1a1d27;
      --border: #2a2d3a;
      --accent: #6c8ef5;
      --accent-dim: rgba(108,142,245,0.12);
      --text: #e8eaf0;
      --muted: #7b7f94;
      --input-bg: #12151e;
      --green: #4ade80;
      --red: #f87171;
      --yellow: #fbbf24;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: 'Inter', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
    }

    input[type=range] {
      height: 4px;
    }

    input, select, button {
      font-family: inherit;
    }

    table td, table th {
      font-variant-numeric: tabular-nums;
    }

    @media (max-width: 800px) {
      .two-col {
        grid-template-columns: 1fr !important;
      }

      .five-col {
        grid-template-columns: repeat(2, 1fr) !important;
      }

      .expense-row,
      .expense-header {
        grid-template-columns: 1fr 100px 90px 28px !important;
      }
    }

    @media (max-width: 520px) {
      .five-col {
        grid-template-columns: 1fr !important;
      }

      .expense-row,
      .expense-header {
        grid-template-columns: 1fr 90px 80px 24px !important;
      }
    }
  `;

  const toggleStyle = (active) => ({
    padding: "6px 14px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    background: active
      ? "var(--accent)"
      : "var(--input-bg)",
    color: active ? "#fff" : "var(--muted)",
  });

  return (
    <>
      <style>{styles}</style>

      <div
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          paddingBottom: 60,
        }}
      >
        <div
          style={{
            background: "var(--card)",
            borderBottom:
              "1px solid var(--border)",
            padding: "16px 24px",
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <div
            style={{
              maxWidth: 1020,
              margin: "0 auto",
              display: "flex",
              justifyContent:
                "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                }}
              >
                Allocator
              </div>

              <div
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                }}
              >
                Personal finance &
                investment tracker — local JSON storage
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                maxWidth: "100%",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color:
                    saveStatus === "error"
                      ? "var(--red)"
                      : saveStatus === "saving"
                        ? "var(--yellow)"
                        : saveStatus === "loading"
                          ? "var(--muted)"
                          : "var(--green)",
                  whiteSpace: "nowrap",
                }}
              >
                {saveStatus === "loading"
                  ? "Loading…"
                  : saveStatus === "saving"
                    ? "Saving…"
                    : saveStatus === "error"
                      ? "Save failed"
                      : "Saved"}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  maxWidth: "100%",
                  overflowX: "auto",
                  padding: "2px",
                }}
              >
              {simulations.map((sim, index) => (
                <button
                  key={sim.id}
                  onClick={() => switchSimulation(sim.id)}
                  title={sim.name}
                  style={{
                    padding: "7px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    cursor: "pointer",
                    background:
                      sim.id === activeSimulationId
                        ? "var(--accent-dim)"
                        : "var(--input-bg)",
                    color:
                      sim.id === activeSimulationId
                        ? "var(--accent)"
                        : "var(--muted)",
                    fontSize: 12,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span>{sim.name || `Simulation ${index + 1}`}</span>
                  {simulations.length > 1 && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSimulation(sim.id);
                      }}
                      role="button"
                      aria-label={`Delete ${sim.name || `Simulation ${index + 1}`}`}
                      title="Delete simulation"
                      style={{
                        marginLeft: 8,
                        color: "var(--muted)",
                        fontSize: 14,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </span>
                  )}
                </button>
              ))}
              <button
                onClick={createNewSimulation}
                aria-label="Create new simulation"
                title="New simulation"
                style={{
                  width: 34,
                  height: 34,
                  flex: "0 0 auto",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                  background: "var(--input-bg)",
                  color: "var(--accent)",
                  fontSize: 22,
                  fontWeight: 500,
                  lineHeight: 1,
                }}
              >
                +
              </button>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: 6,
                background:
                  "var(--input-bg)",
                padding: 4,
                borderRadius: 10,
                border:
                  "1px solid var(--border)",
              }}
            >
              {[
                "income",
                "expenses",
                "invest",
                "outlook",
                "compare",
              ].map((t) => (
                <Tab
                  key={t}
                  label={
                    {
                      income: "Income",
                      expenses: "Expenses",
                      invest: "Investments",
                      outlook: "Outlook",
                      compare: "Compare",
                    }[t]
                  }
                  active={tab === t}
                  onClick={() => setTab(t)}
                />
              ))}
            </div>
          </div>
        </div>

        <div
          style={{
            maxWidth: 1020,
            margin: "0 auto",
            padding: "24px 16px",
          }}
        >       

          {/* SUMMARY */}
          <div
            className="five-col"
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(5, 1fr)",
              gap: 12,
              marginBottom: 24,
            }}
          >
            {[
              {
                label: "Take-home / mo",
                value: fmt(calc.netMonthly),
                color: "var(--green)",
              },
              {
                label: "Monthly expenses",
                value: fmt(
                  calc.totalExpenses
                ),
                color: "var(--red)",
              },
              {
                label: "After expenses",
                value: fmt(
                  calc.afterExpenses
                ),
                color:
                  calc.afterExpenses >= 0
                    ? "var(--green)"
                    : "var(--red)",
              },
              {
                label: "Investing / mo",
                value: fmt(
                  calc.totalInvesting
                ),
                color: "var(--accent)",
              },
              {
                label: "Cash surplus / mo",
                value: fmt(
                  calc.leftoverMonthly
                ),
                color:
                  calc.leftoverMonthly >= 0
                    ? "var(--green)"
                    : "var(--red)",
              },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  background:
                    "var(--card)",
                  border:
                    "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "14px 16px",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    marginBottom: 4,
                    textTransform:
                      "uppercase",
                    letterSpacing:
                      "0.05em",
                  }}
                >
                  {s.label}
                </div>

                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: s.color,
                  }}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          {/* FINANCIAL HEALTH - floating panel */}
          <FloatingHealthPanel calc={calc} pct={pct} getHealthStatus={getHealthStatus} statusColor={statusColor} statusLabel={statusLabel} />

                    {/* INCOME */}
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
            />
          )}

          {tab === "income" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 18,
              }}
            >
              <Card title="Take-Home Pay">
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginBottom: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      style={toggleStyle(
                        incomeMode ===
                          "prefill"
                      )}
                      onClick={() =>
                        setIncomeMode(
                          "prefill"
                        )
                      }
                    >
                      Prefill actual
                      take-home
                    </button>

                    <button
                      style={toggleStyle(
                        incomeMode ===
                          "calculated"
                      )}
                      onClick={() =>
                        setIncomeMode(
                          "calculated"
                        )
                      }
                    >
                      Estimate from
                      gross
                    </button>
                  </div>

                  {incomeMode ===
                    "prefill" && (
                    <>
                      <NumInput
                        label="Actual monthly take-home"
                        value={
                          actualTakeHome
                        }
                        onChange={
                          setActualTakeHome
                        }
                      />

                      <InfoBox>
                        Your actual
                        paycheck after
                        taxes, 401k,
                        benefits and
                        other deductions.
                      </InfoBox>
                    </>
                  )}

                  {incomeMode ===
                    "calculated" && (
                    <InfoBox
                      color="var(--yellow)"
                      bg="rgba(251,191,36,0.08)"
                    >
                      Estimated from the
                      simplified tax
                      brackets below.
                      The projection
                      recalculates taxes
                      every year as gross
                      salary increases.
                    </InfoBox>
                  )}

                  <div
                    style={{
                      marginTop: 16,
                    }}
                  >
                    <NumInput
                      label="Gross annual salary"
                      value={grossSalary}
                      onChange={
                        setGrossSalary
                      }
                    />

                    <NumInput
                      label="Current age"
                      value={age}
                      onChange={setAge}
                      prefix=""
                    />

                    <Slider
                      label="Annual merit / salary increase"
                      value={salaryGrowth}
                      min={0}
                      max={10}
                      step={0.5}
                      onChange={
                        setSalaryGrowth
                      }
                      display={
                        salaryGrowth + "%"
                      }
                    />

                    <InfoBox>
                      {incomeMode ===
                      "prefill"
                        ? `Take-home also increases by ${salaryGrowth}%/yr. This is intentionally an approximation; actual raises may produce slightly different after-tax income.`
                        : `Gross salary increases ${salaryGrowth}%/yr and taxes are recalculated each year, including when you cross a federal bracket.`
                      }
                    </InfoBox>

                    <Slider
                      label="State income tax rate"
                      value={stateRate}
                      min={0}
                      max={13}
                      step={0.5}
                      onChange={
                        setStateRate
                      }
                      display={
                        stateRate + "%"
                      }
                    />

                    <Slider
                      label="401k contribution (% of gross)"
                      value={k401Pct}
                      min={0}
                      max={50}
                      step={0.5}
                      onChange={
                        setK401Pct
                      }
                      display={
                        k401Pct + "%"
                      }
                    />

                    <div
                      style={{
                        fontSize: 12,
                        color:
                          "var(--muted)",
                        marginTop: -8,
                        marginBottom: 10,
                      }}
                    >
                      ={" "}
                      {fmt(
                        calc.k401Annual
                      )}
                      /yr ·{" "}
                      {fmt(
                        calc.k401Monthly
                      )}
                      /mo · Limit:{" "}
                      {fmt(
                        K401_LIMIT
                      )}
                    </div>

                    <Progress
                      value={
                        calc.k401Annual
                      }
                      max={K401_LIMIT}
                    />

                    <div
                      style={{
                        marginTop: 16,
                      }}
                    >
                      <Label>
                        Employer match
                      </Label>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "1fr 1fr",
                          gap: 10,
                        }}
                      >
                        <NumInput
                          label="Match %"
                          value={
                            employerMatch
                          }
                          onChange={
                            setEmployerMatch
                          }
                          prefix="%"
                        />

                        <NumInput
                          label="Up to % of salary"
                          value={
                            employerMatchMax
                          }
                          onChange={
                            setEmployerMatchMax
                          }
                          prefix="%"
                        />
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems:
                          "center",
                        gap: 10,
                        marginTop: 4,
                      }}
                    >
                      <button
                        style={toggleStyle(
                          contributionGrowth
                        )}
                        onClick={() =>
                          setContributionGrowth(
                            !contributionGrowth
                          )
                        }
                      >
                        {contributionGrowth
                          ? "Contribution growth: ON"
                          : "Contribution growth: OFF"}
                      </button>
                    </div>

                    <InfoBox
                      color="var(--muted)"
                      bg="rgba(123,127,148,0.08)"
                    >
                      When ON, Roth and
                      brokerage
                      contributions grow
                      with your salary
                      assumption. Roth
                      remains capped at
                      the annual IRA
                      limit.
                    </InfoBox>
                  </div>
                </Card>

            </div>
          )}

          {/* EXPENSES */}
          {tab === "expenses" && (
            <div
              className="two-col"
              style={{
                display: "grid",
                gridTemplateColumns:
                  "1fr 1fr",
                gap: 18,
              }}
            >
              <Card
                title="Monthly Expenses"
                badge={`${expenses.length} items`}
              >
                <div
                  className="expense-header"
                  style={{
                    fontSize: 12,
                    color:
                      "var(--muted)",
                    marginBottom: 12,
                    display: "grid",
                    gridTemplateColumns:
                      "1fr 130px 110px 32px",
                    gap: 8,
                  }}
                >
                  <span>Name</span>
                  <span>Category</span>
                  <span>Amount/mo</span>
                  <span />
                </div>

                {expenses.map((item) => (
                  <div
                    className="expense-row"
                    key={item.id}
                  >
                    <ExpenseRow
                      item={item}
                      onChange={(u) =>
                        setExpenses(
                          expenses.map(
                            (e) =>
                              e.id ===
                              item.id
                                ? u
                                : e
                          )
                        )
                      }
                      onRemove={() =>
                        setExpenses(
                          expenses.filter(
                            (e) =>
                              e.id !==
                              item.id
                          )
                        )
                      }
                    />
                  </div>
                ))}

                <button
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
                  style={{
                    marginTop: 10,
                    padding:
                      "8px 16px",
                    borderRadius: 8,
                    border:
                      "1px dashed var(--border)",
                    background: "none",
                    color:
                      "var(--accent)",
                    cursor: "pointer",
                    fontSize: 13,
                    width: "100%",
                  }}
                >
                  + Add expense
                </button>
              </Card>

              <div>
                <Card title="Expense Summary">
                  {CATEGORIES.filter(
                    (cat) =>
                      expenses.some(
                        (e) =>
                          e.category ===
                          cat
                      )
                  ).map((cat) => {
                    const total =
                      expenses
                        .filter(
                          (e) =>
                            e.category ===
                            cat
                        )
                        .reduce(
                          (s, e) =>
                            s +
                            e.amount,
                          0
                        );

                    const ratio =
                      total /
                      (calc.netMonthly ||
                        1);

                    return (
                      <div
                        key={cat}
                        style={{
                          marginBottom: 10,
                        }}
                      >
                        <div
                          style={{
                            display:
                              "flex",
                            justifyContent:
                              "space-between",
                            fontSize: 13,
                            marginBottom: 2,
                          }}
                        >
                          <span>
                            {cat}
                          </span>

                          <span
                            style={{
                              color:
                                ratio >
                                0.35
                                  ? "var(--red)"
                                  : ratio >
                                    0.2
                                  ? "var(--yellow)"
                                  : "var(--green)",
                              fontWeight: 600,
                            }}
                          >
                            {fmt(total)}{" "}
                            <span
                              style={{
                                fontWeight: 400,
                                color:
                                  "var(--muted)",
                              }}
                            >
                              ({pct(
                                ratio
                              )})
                            </span>
                          </span>
                        </div>

                        <Progress
                          value={total}
                          max={
                            calc.netMonthly
                          }
                          color={
                            ratio > 0.35
                              ? "var(--red)"
                              : ratio >
                                0.2
                              ? "var(--yellow)"
                              : "var(--accent)"
                          }
                        />
                      </div>
                    );
                  })}

                  <div
                    style={{
                      marginTop: 12,
                    }}
                  >
                    <Row
                      label="Total expenses / mo"
                      value={fmt(
                        calc.totalExpenses
                      )}
                      highlight
                    />

                    <Row
                      label="Take-home / mo"
                      value={fmt(
                        calc.netMonthly
                      )}
                    />

                    <Row
                      label="Remaining after expenses"
                      value={fmt(
                        calc.afterExpenses
                      )}
                      highlight
                      valueColor={
                        calc.afterExpenses >=
                        0
                          ? "var(--green)"
                          : "var(--red)"
                      }
                    />

                    <Row
                      label="Housing / take-home"
                      value={pct(
                        calc.housingTakeHomeRatio
                      )}
                      valueColor={
                        statusColor(
                          getHealthStatus(
                            calc.housingTakeHomeRatio,
                            {
                              good: 0.3,
                              watch: 0.35,
                            },
                            true
                          )
                        )
                      }
                    />

                    <Row
                      label="Housing / gross"
                      value={pct(
                        calc.housingGrossRatio
                      )}
                    />
                  </div>

                  <InfoBox
                    color={
                      calc.afterExpenses <
                      0
                        ? "var(--red)"
                        : "var(--accent)"
                    }
                    bg={
                      calc.afterExpenses <
                      0
                        ? "rgba(248,113,113,0.1)"
                        : "var(--accent-dim)"
                    }
                  >
                    {calc.afterExpenses <
                    0
                      ? "Expenses exceed take-home. Reduce spending or increase income."
                      : `You have ${fmt(
                          calc.afterExpenses
                        )}/mo available after expenses.`}
                  </InfoBox>
                </Card>
              </div>
            </div>
          )}

          {/* INVESTMENTS */}
          {tab === "invest" && (
            <div
              className="two-col"
              style={{
                display: "grid",
                gridTemplateColumns:
                  "1fr 1fr",
                gap: 18,
              }}
            >
              <div>
                <Card
                  title="Roth IRA"
                  badge="Post-tax"
                  accent
                >
                  <NumInput
                    label="Monthly contribution"
                    value={rothContrib}
                    onChange={
                      setRothContrib
                    }
                  />

                  <div
                    style={{
                      fontSize: 12,
                      color:
                        "var(--muted)",
                      marginBottom: 6,
                    }}
                  >
                    Annual:{" "}
                    {fmt(
                      calc.rothAnnual
                    )}{" "}
                    · Limit:{" "}
                    {fmt(ROTH_LIMIT)}{" "}
                    ·{" "}
                    {pct(
                      calc.rothAnnual /
                        ROTH_LIMIT
                    )}{" "}
                    used
                  </div>

                  <Progress
                    value={
                      calc.rothAnnual
                    }
                    max={ROTH_LIMIT}
                  />

                  <div
                    style={{
                      marginTop: 14,
                    }}
                  >
                    <NumInput
                      label="Current Roth IRA balance"
                      value={rothBalance}
                      onChange={
                        setRothBalance
                      }
                    />

                    <Slider
                      label="Expected annual return"
                      value={rothRate}
                      min={3}
                      max={12}
                      step={0.5}
                      onChange={
                        setRothRate
                      }
                      display={
                        rothRate + "%"
                      }
                    />
                  </div>

                  <InfoBox>
                    Tax-free growth
                    assuming Roth rules
                    are satisfied.
                  </InfoBox>
                </Card>

                <Card title="Taxable Brokerage">
                  <NumInput
                    label="Monthly contribution"
                    value={
                      brokerageContrib
                    }
                    onChange={
                      setBrokerageContrib
                    }
                  />

                  <NumInput
                    label="Current balance"
                    value={
                      brokerageBalance
                    }
                    onChange={
                      setBrokerageBalance
                    }
                  />

                  <Slider
                    label="Expected annual return"
                    value={brokerageRate}
                    min={3}
                    max={12}
                    step={0.5}
                    onChange={
                      setBrokerageRate
                    }
                    display={
                      brokerageRate +
                      "%"
                    }
                  />

                  <InfoBox
                    color="var(--green)"
                    bg="rgba(74,222,128,0.06)"
                  >
                    No contribution
                    limit. Capital
                    gains/dividend
                    taxes are not modeled
                    in the projection.
                  </InfoBox>
                </Card>
              </div>

              <div>
                <Card
                  title="401k"
                  badge="Pre-tax"
                >
                  <Row
                    label={`Your contribution (${k401Pct}%)`}
                    value={`${fmt(
                      calc.k401Annual
                    )}/yr`}
                  />

                  <Row
                    label="Employer match"
                    value={`${fmt(
                      calc.employerMatchAmt
                    )}/yr`}
                  />

                  <Row
                    label="Total to 401k / yr"
                    value={fmt(
                      calc.k401Annual +
                        calc.employerMatchAmt
                    )}
                    highlight
                  />

                  <Row
                    label="Tax savings this year"
                    value={fmt(
                      calc.taxSavings
                    )}
                  />

                  <NumInput
                    label="Current 401k balance"
                    value={k401Balance}
                    onChange={
                      setK401Balance
                    }
                  />

                  <Slider
                    label="Expected annual return"
                    value={k401Rate}
                    min={3}
                    max={12}
                    step={0.5}
                    onChange={
                      setK401Rate
                    }
                    display={
                      k401Rate + "%"
                    }
                  />

                  <InfoBox>
                    Tax-deferred growth.
                    Retirement
                    withdrawals are not
                    modeled for taxes here.
                  </InfoBox>
                </Card>

                <Card title="Monthly Cash Flow Waterfall">
                  {[
                    {
                      label: "Take-home",
                      value:
                        calc.netMonthly,
                      color:
                        "var(--text)",
                    },
                    {
                      label:
                        "– Expenses",
                      value:
                        calc.totalExpenses,
                      color:
                        "var(--red)",
                    },
                    {
                      label:
                        "– Roth IRA",
                      value:
                        calc.rothMonthly,
                      color:
                        "var(--accent)",
                    },
                    {
                      label:
                        "– Brokerage",
                      value:
                        brokerageContrib,
                      color:
                        "var(--accent)",
                    },
                    {
                      label:
                        "= Cash surplus/mo",
                      value:
                        calc.leftoverMonthly,
                      color:
                        calc.leftoverMonthly >=
                        0
                          ? "var(--green)"
                          : "var(--red)",
                    },
                  ].map((r) => (
                    <Row
                      key={r.label}
                      label={r.label}
                      value={
                        <span
                          style={{
                            color:
                              r.color,
                          }}
                        >
                          {fmt(r.value)}
                        </span>
                      }
                    />
                  ))}

                  <InfoBox
                    color="var(--muted)"
                    bg="rgba(123,127,148,0.08)"
                  >
                    401k contributions are
                    treated as already
                    reflected in take-home.
                  </InfoBox>
                </Card>

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
                    display={
                      cashRate + "%"
                    }
                  />

                  <InfoBox>
                    Cash earns the
                    assumed APY in the
                    projection instead of
                    simply sitting at 0%.
                  </InfoBox>
                </Card>

                <Card title="Projection Settings">
                  <Slider
                    label="Years to project"
                    value={projYears}
                    min={1}
                    max={40}
                    step={1}
                    onChange={
                      setProjYears
                    }
                    display={
                      projYears + " yrs"
                    }
                  />

                  <InfoBox
                    color="var(--muted)"
                    bg="rgba(123,127,148,0.08)"
                  >
                    Current age:{" "}
                    {age}. Projected age:{" "}
                    {finalAge}.
                  </InfoBox>
                </Card>
              </div>
            </div>
          )}

          {/* OUTLOOK */}
          {tab === "outlook" && (
            <div>
              <div
                className="five-col"
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(5, 1fr)",
                  gap: 12,
                  marginBottom: 18,
                }}
              >
                {[
                  {
                    label: "Roth IRA",
                    value:
                      calc.proj.roth,
                    sub: `${rothRate}%/yr`,
                  },
                  {
                    label: "401k",
                    value:
                      calc.proj.k401,
                    sub: "incl. match",
                  },
                  {
                    label: "Brokerage",
                    value:
                      calc.proj
                        .brokerage,
                    sub: `${brokerageRate}%/yr`,
                  },
                  {
                    label: "Cash Reserve",
                    value:
                      calc.proj.cash,
                    sub: `${cashRate}% APY`,
                    green: true,
                  },
                  {
                    label: "Total",
                    value:
                      calc.proj.total,
                    sub: `age ${finalAge}`,
                    accent: true,
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    style={{
                      background:
                        "var(--card)",
                      border: `1px solid ${
                        s.accent
                          ? "var(--accent)"
                          : "var(--border)"
                      }`,
                      borderRadius: 10,
                      padding: 16,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        color:
                          "var(--muted)",
                        textTransform:
                          "uppercase",
                        letterSpacing:
                          "0.05em",
                        marginBottom: 4,
                      }}
                    >
                      {s.label}
                    </div>

                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 800,
                        color:
                          s.accent
                            ? "var(--accent)"
                            : s.green
                            ? "var(--green)"
                            : "var(--text)",
                      }}
                    >
                      {fmt(s.value)}
                    </div>

                    <div
                      style={{
                        fontSize: 11,
                        color:
                          "var(--muted)",
                        marginTop: 2,
                      }}
                    >
                      {s.sub}
                    </div>
                  </div>
                ))}
              </div>

              {/* NET WORTH BENCHMARK */}
              <Card
                title="Net Worth vs. Age Benchmark"
                accent
              >
                <div
                  className="two-col"
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "1fr 1fr",
                    gap: 24,
                  }}
                >
                  <div>
                    <Label>
                      Current position
                    </Label>

                    <div
                      style={{
                        fontSize: 30,
                        fontWeight: 800,
                        margin:
                          "6px 0",
                      }}
                    >
                      {fmt(
                        currentNetWorth
                      )}
                    </div>

                    <div
                      style={{
                        color:
                          statusColor(
                            currentNetWorthStatus ===
                              "90th+"
                              ? "healthy"
                              : currentNetWorthStatus ===
                                "75th–90th"
                              ? "healthy"
                              : currentNetWorthStatus ===
                                "50th–75th"
                              ? "watch"
                              : "low"
                          ),
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      {currentNetWorthStatus}
                    </div>

                    <div
                      style={{
                        marginTop: 14,
                      }}
                    >
                      <Row
                        label="25th percentile"
                        value={fmt(
                          currentBenchmark.p25
                        )}
                      />
                      <Row
                        label="50th percentile"
                        value={fmt(
                          currentBenchmark.p50
                        )}
                      />
                      <Row
                        label="75th percentile"
                        value={fmt(
                          currentBenchmark.p75
                        )}
                      />
                      <Row
                        label="90th percentile"
                        value={fmt(
                          currentBenchmark.p90
                        )}
                      />
                    </div>
                  </div>

                  <div>
                    <Label>
                      Projected position
                    </Label>

                    <div
                      style={{
                        fontSize: 30,
                        fontWeight: 800,
                        margin:
                          "6px 0",
                        color:
                          "var(--accent)",
                      }}
                    >
                      {fmt(
                        calc.proj.total
                      )}
                    </div>

                    <div
                      style={{
                        color:
                          finalStatus ===
                            "90th+" ||
                          finalStatus ===
                            "75th–90th"
                            ? "var(--green)"
                            : finalStatus ===
                              "50th–75th"
                            ? "var(--yellow)"
                            : "var(--red)",
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      {finalStatus} at
                      age {finalAge}
                    </div>

                    <div
                      style={{
                        marginTop: 14,
                      }}
                    >
                      <Row
                        label="25th percentile"
                        value={fmt(
                          finalBenchmark.p25
                        )}
                      />
                      <Row
                        label="50th percentile"
                        value={fmt(
                          finalBenchmark.p50
                        )}
                      />
                      <Row
                        label="75th percentile"
                        value={fmt(
                          finalBenchmark.p75
                        )}
                      />
                      <Row
                        label="90th percentile"
                        value={fmt(
                          finalBenchmark.p90
                        )}
                      />
                    </div>
                  </div>
                </div>

                <InfoBox
                  color="var(--muted)"
                  bg="rgba(123,127,148,0.08)"
                >
                  Benchmark figures are
                  approximate U.S. household
                  net-worth reference points,
                  not a precise individual
                  ranking. They should be
                  treated as directional
                  context.
                </InfoBox>
              </Card>

              {/* MILESTONES */}
              <Card title="Financial Milestones">
                <div
                  className="five-col"
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(4, 1fr)",
                    gap: 10,
                  }}
                >
                  {milestones.map((m) => (
                    <div
                      key={m.target}
                      style={{
                        padding: 14,
                        background: m.reached
                          ? "rgba(74,222,128,0.07)"
                          : m.hit
                          ? "var(--accent-dim)"
                          : "var(--input-bg)",
                        border: m.reached
                          ? "1px solid var(--green)"
                          : m.hit
                          ? "1px solid var(--accent)"
                          : "1px solid var(--border)",
                        borderRadius: 9,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          color:
                            "var(--muted)",
                          textTransform:
                            "uppercase",
                        }}
                      >
                        Net worth
                      </div>

                      <div
                        style={{
                          fontSize: 19,
                          fontWeight: 800,
                          marginTop: 4,
                        }}
                      >
                        {fmt(m.target)}
                      </div>

                      <div
                        style={{
                          marginTop: 7,
                          fontSize: 12,
                          color:
                            m.reached
                              ? "var(--green)"
                              : m.hit
                              ? "var(--accent)"
                              : "var(--muted)",
                          fontWeight: 700,
                        }}
                      >
                        {m.reached
                          ? "✓ Already reached"
                          : m.hit
                          ? `Projected year ${m.hit.year}`
                          : "Beyond projection"}
                      </div>

                      {m.hit &&
                        !m.reached && (
                          <div
                            style={{
                              fontSize: 11,
                              color:
                                "var(--muted)",
                              marginTop: 3,
                            }}
                          >
                            Age{" "}
                            {age +
                              m.hit.year}
                          </div>
                        )}
                    </div>
                  ))}
                </div>
              </Card>

              {/* YEAR BY YEAR */}
              <CollapsibleYearTable
                snapshots={calc.proj.snapshots}
                projYears={projYears}
                age={age}
                finalAge={finalAge}
                salaryGrowth={salaryGrowth}
                cashRate={cashRate}
              />

              <div
                className="two-col"
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "1fr 1fr",
                  gap: 16,
                }}
              >
                <Card title="Annual Contributions">
                  <Row
                    label="Roth IRA / yr"
                    value={fmt(
                      calc.rothAnnual
                    )}
                  />

                  <Row
                    label={`401k your contribution (${k401Pct}%)`}
                    value={fmt(
                      calc.k401Annual
                    )}
                  />

                  <Row
                    label="401k employer match"
                    value={fmt(
                      calc.employerMatchAmt
                    )}
                  />

                  <Row
                    label="Taxable brokerage / yr"
                    value={fmt(
                      calc.brokerageAnnual
                    )}
                  />

                  <Row
                    label="Total invested / yr"
                    value={fmt(
                      calc.rothAnnual +
                        calc.k401Annual +
                        calc.employerMatchAmt +
                        calc.brokerageAnnual
                    )}
                    highlight
                  />

                  <Row
                    label="Cash surplus / yr"
                    value={fmt(
                      calc.leftoverAnnual
                    )}
                    valueColor={
                      calc.leftoverAnnual >=
                      0
                        ? "var(--green)"
                        : "var(--red)"
                    }
                  />

                  <InfoBox>
                    Current investment
                    rate:{" "}
                    {pct(
                      calc.investmentGrossRatio
                    )}
                    of gross income.{" "}
                    {calc.investmentGrossRatio >=
                    0.15
                      ? "You're at or above the common 15% target."
                      : `You're about ${fmt(
                          (0.15 *
                            grossSalary -
                            (calc.k401Annual +
                              calc.employerMatchAmt +
                              calc.rothAnnual +
                              calc.brokerageAnnual)) /
                            12
                        )}/mo below a 15% gross-income investment rate.`}
                  </InfoBox>
                </Card>

                <Card title="What Should I Change?">
                  {calc.housingTakeHomeRatio >
                    0.3 && (
                    <InfoBox
                      color="var(--yellow)"
                      bg="rgba(251,191,36,0.08)"
                    >
                      🏠 Housing is{" "}
                      {pct(
                        calc.housingTakeHomeRatio
                      )}{" "}
                      of take-home. Getting
                      below 30% would create
                      more flexibility.
                    </InfoBox>
                  )}

                  {calc.investmentGrossRatio <
                    0.15 && (
                    <InfoBox
                      color="var(--yellow)"
                      bg="rgba(251,191,36,0.08)"
                    >
                      📈 Increasing investments
                      toward 15% of gross would
                      put you closer to the common
                      long-term target.
                    </InfoBox>
                  )}

                  {calc.expenseRatio >
                    0.5 && (
                    <InfoBox
                      color="var(--yellow)"
                      bg="rgba(251,191,36,0.08)"
                    >
                      💰 Expenses consume{" "}
                      {pct(
                        calc.expenseRatio
                      )}{" "}
                      of take-home. Cutting
                      recurring expenses has a
                      direct effect on your
                      investable surplus.
                    </InfoBox>
                  )}

                  {calc.emergencyFunding <
                    1 && (
                    <InfoBox
                      color="var(--accent)"
                      bg="var(--accent-dim)"
                    >
                      🛟 Your six-month emergency
                      target is{" "}
                      {fmt(
                        calc.emergencyTarget
                      )}
                      . You currently have{" "}
                      {fmt(initCash)}.
                    </InfoBox>
                  )}

                  {calc.healthScore >=
                    85 && (
                    <InfoBox
                      color="var(--green)"
                      bg="rgba(74,222,128,0.08)"
                    >
                      ✓ Your current plan is
                      strong across the major
                      ratios. The biggest lever
                      now is continuing to grow
                      income and investments.
                    </InfoBox>
                  )}
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
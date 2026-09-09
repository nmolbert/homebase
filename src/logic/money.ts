// Budget math: the paycheck plan (Alex's model), monthly envelopes (Nick's
// model), goals and account roll-ups.
import { Db } from "../db.ts";

export interface IncomeSource {
  id: string; person_id: string; name: string; kind: "w2" | "1099";
  gross_annual: number; tax_rate: number; deferrals: string | { name: string; amount: number }[];
  active: number; notes: string;
}

export function parseDeferrals(d: IncomeSource["deferrals"]): { name: string; amount: number }[] {
  if (Array.isArray(d)) return d;
  try { return JSON.parse(d || "[]"); } catch { return []; }
}

// Replicates the Salary tab: gross − pre-tax deferrals, then a flat estimated
// tax rate on what is left. 1099 sources have no deferrals here; their tax
// share is what gets swept to the tax HYSA.
export function incomeMath(src: IncomeSource) {
  const deferrals = parseDeferrals(src.deferrals);
  const deferred = deferrals.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const taxable = Math.max(0, (Number(src.gross_annual) || 0) - deferred);
  const tax = taxable * (Number(src.tax_rate) || 0);
  const net = taxable - tax;
  return {
    gross_annual: Number(src.gross_annual) || 0,
    deferred_annual: deferred,
    tax_annual: tax,
    net_annual: net,
    net_monthly: net / 12,
    tax_monthly: tax / 12,
    reserve_monthly: src.kind === "1099" ? tax / 12 : 0,
  };
}

export function paycheckPlan(db: Db) {
  const sources = db.all<IncomeSource>("SELECT * FROM income_sources WHERE active = 1 ORDER BY sort");
  const people = db.all<{ id: string; name: string }>("SELECT id, name FROM people ORDER BY sort");
  const rows = sources.map((s) => ({ ...s, deferrals: parseDeferrals(s.deferrals), ...incomeMath(s) }));
  const byPerson = people.map((p) => {
    const mine = rows.filter((r) => r.person_id === p.id);
    return {
      person: p,
      gross_annual: sum(mine, "gross_annual"),
      net_annual: sum(mine, "net_annual"),
      net_monthly: sum(mine, "net_monthly"),
      reserve_monthly: sum(mine, "reserve_monthly"),
    };
  });
  const net_monthly = sum(rows, "net_monthly");
  const reserve_monthly = sum(rows, "reserve_monthly");
  const allocations = db.all<any>("SELECT * FROM allocations ORDER BY sort");
  // The tax reserve is NOT subtracted from net: every source's estimated tax
  // is already removed when computing net (as in Alex's sheet). The reserve
  // line only says how much of that withheld money must physically be moved
  // to the Tax HYSA each month.
  let fixed = 0, transfers = 0;
  const allocRows = allocations.map((a) => {
    let amount = Number(a.amount) || 0;
    if (a.kind === "tax_reserve") amount = reserve_monthly;
    if (a.kind === "fixed") fixed += amount;
    if (a.kind === "transfer") transfers += amount;
    return { ...a, amount };
  });
  const spending_available = net_monthly - fixed - transfers;
  const budgeted = db.one<{ t: number }>("SELECT COALESCE(SUM(monthly_budget),0) t FROM categories WHERE kind='expense' AND archived=0")?.t ?? 0;
  return {
    sources: rows, byPerson, net_monthly, reserve_monthly, allocations: allocRows,
    fixed_monthly: fixed, transfers_monthly: transfers, spending_available,
    envelopes_budgeted: budgeted, unbudgeted: spending_available - budgeted,
    gross_annual: sum(rows, "gross_annual"), net_annual: sum(rows, "net_annual"),
  };
}

function sum<T>(rows: T[], k: keyof T) { return rows.reduce((s, r) => s + (Number(r[k]) || 0), 0); }

// ---- monthly envelopes ------------------------------------------------------
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const endDate = new Date(Date.UTC(y, m, 0)); // last day of month
  const end = endDate.toISOString().slice(0, 10);
  return { start, end };
}

export function budgetForMonth(db: Db, month: string) {
  const { start, end } = monthRange(month);
  const cats = db.all<any>("SELECT * FROM categories WHERE archived = 0 ORDER BY sort");
  const overrides = new Map(db.all<any>("SELECT category_id, amount FROM budget_overrides WHERE month = ?", month).map((o) => [o.category_id, o.amount]));
  const actuals = new Map(
    db.all<any>(
      `SELECT category_id, SUM(amount) total, COUNT(*) n FROM transactions
       WHERE date >= ? AND date <= ? GROUP BY category_id`, start, end,
    ).map((r) => [r.category_id, r]),
  );
  const rows = cats.map((c) => {
    const a = actuals.get(c.id);
    const actual = a ? Number(a.total) : 0;
    // Expenses are stored negative; show them positive on the budget page.
    const spent = c.kind === "expense" ? -actual : actual;
    const budget = overrides.has(c.id) ? Number(overrides.get(c.id)) : Number(c.monthly_budget) || 0;
    return {
      ...c, budget, actual: spent, count: a ? Number(a.n) : 0,
      remaining: budget - spent, pct: budget > 0 ? spent / budget : (spent > 0 ? 1 : 0),
      overridden: overrides.has(c.id),
    };
  });
  const uncategorized = db.one<any>(
    `SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM transactions
     WHERE date >= ? AND date <= ? AND (category_id IS NULL OR category_id = '')`, start, end,
  );
  const income = rows.filter((r) => r.kind === "income").reduce((s, r) => s + r.actual, 0);
  const expenses = rows.filter((r) => r.kind === "expense").reduce((s, r) => s + r.actual, 0);
  const budgeted = rows.filter((r) => r.kind === "expense").reduce((s, r) => s + r.budget, 0);
  return {
    month, rows, income, expenses, budgeted, net: income - expenses,
    savings_rate: income > 0 ? (income - expenses) / income : 0,
    uncategorized: { total: Number(uncategorized?.total || 0), count: Number(uncategorized?.n || 0) },
  };
}

// Twelve-month grid like Nick's spreadsheet: category × month actuals.
export function yearGrid(db: Db, year: number) {
  const cats = db.all<any>("SELECT * FROM categories WHERE archived = 0 ORDER BY sort");
  const rows = db.all<any>(
    `SELECT category_id, substr(date,1,7) month, SUM(amount) total FROM transactions
     WHERE date >= ? AND date <= ? GROUP BY category_id, month`, `${year}-01-01`, `${year}-12-31`,
  );
  const map = new Map<string, Record<string, number>>();
  for (const r of rows) {
    if (!map.has(r.category_id)) map.set(r.category_id, {});
    map.get(r.category_id)![r.month] = Number(r.total);
  }
  return cats.map((c) => {
    const months: number[] = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, "0")}`;
      const v = map.get(c.id)?.[key] ?? 0;
      months.push(c.kind === "expense" ? -v : v);
    }
    return { ...c, months, total: months.reduce((a, b) => a + b, 0), annual_budget: (Number(c.monthly_budget) || 0) * 12 };
  });
}

export function goalsWithProgress(db: Db) {
  const goals = db.all<any>("SELECT * FROM goals ORDER BY done, sort");
  const accounts = new Map(db.all<any>("SELECT id, balance, name FROM accounts").map((a) => [a.id, a]));
  const today = new Date();
  return goals.map((g) => {
    const acct = g.account_id ? accounts.get(g.account_id) : null;
    const saved = acct ? Number(acct.balance) || 0 : Number(g.saved) || 0;
    const target = Number(g.target) || 0;
    const remaining = Math.max(target - saved, 0);
    let months = 0;
    if (g.target_date) {
      const d = new Date(g.target_date + "T00:00:00");
      months = Math.max(0, (d.getFullYear() - today.getFullYear()) * 12 + d.getMonth() - today.getMonth());
    }
    return {
      ...g, saved, remaining, months_left: months,
      monthly_needed: months > 0 ? remaining / months : remaining,
      pct: target > 0 ? Math.min(saved / target, 1) : 0,
      linked_account: acct ? acct.name : null,
    };
  });
}

export function netWorth(db: Db) {
  const accounts = db.all<any>("SELECT * FROM accounts WHERE archived = 0 ORDER BY sort");
  const assetsTotal = accounts.filter((a) => !["credit", "loan"].includes(a.type)).reduce((s, a) => s + (Number(a.balance) || 0), 0);
  const debtTotal = accounts.filter((a) => ["credit", "loan"].includes(a.type)).reduce((s, a) => s + Math.abs(Number(a.balance) || 0), 0);
  return { accounts, assets: assetsTotal, debts: debtTotal, net: assetsTotal - debtTotal };
}

// ---- auto-categorisation ----------------------------------------------------
export function applyRules(db: Db, payee: string, memo = ""): string | null {
  const rules = db.all<any>("SELECT pattern, category_id FROM category_rules ORDER BY sort");
  const hay = `${payee || ""} ${memo || ""}`.toLowerCase();
  for (const r of rules) {
    const p = String(r.pattern || "").toLowerCase().trim();
    if (!p) continue;
    if (hay.includes(p)) return r.category_id;
  }
  return null;
}

export async function dedupeHash(date: string, amount: number, payee: string, account_id: string | null) {
  const s = `${date}|${Number(amount).toFixed(2)}|${(payee || "").trim().toLowerCase()}|${account_id || ""}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

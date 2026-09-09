import { html, useState, useEffect } from "../vendor/preact-htm.js";
import { api, useApp, toast } from "../app.js";
import { Bar, Stat, SubNav, PageHead, money, pct, thisMonth, monthLabel, shiftMonth, useAsync, Loading, ErrorBox, EditSheet, Seg } from "../ui.js";
import Transactions from "./transactions.js";
import Paycheck from "./paycheck.js";
import Accounts from "./accounts.js";
import Goals from "./goals.js";

const TABS = [["", "Envelopes", "#/budget"], ["transactions", "Transactions", "#/budget/transactions"], ["paycheck", "Paycheck plan", "#/budget/paycheck"], ["accounts", "Accounts", "#/budget/accounts"], ["goals", "Goals", "#/budget/goals"], ["year", "Year", "#/budget/year"]];

export default function Budget({ route }) {
  const sub = route.sub || "";
  let body;
  if (sub === "transactions") body = html`<${Transactions} route=${route} />`;
  else if (sub === "paycheck") body = html`<${Paycheck} />`;
  else if (sub === "accounts") body = html`<${Accounts} />`;
  else if (sub === "goals") body = html`<${Goals} />`;
  else if (sub === "year") body = html`<${YearGrid} />`;
  else body = html`<${Envelopes} route=${route} />`;
  return html`<div><${SubNav} items=${TABS} active=${sub} />${body}</div>`;
}

// ---- monthly envelopes -----------------------------------------------------------
function Envelopes({ route }) {
  const { boot, reload } = useApp();
  const [month, setMonth] = useState(route.query.month || thisMonth());
  const [mode, setMode] = useState("budget"); // budget | totals
  const [editCat, setEditCat] = useState(null);
  const q = useAsync(() => api(`/api/budget?month=${month}`), [month]);
  if (q.error) return html`<${ErrorBox} error=${q.error} reload=${q.reload} />`;
  if (!q.data) return html`<${Loading} />`;
  const b = q.data;
  const groups = [];
  for (const r of b.rows) { let g = groups.find((x) => x.name === r.group_name); if (!g) { g = { name: r.group_name, kind: r.kind, rows: [] }; groups.push(g); } g.rows.push(r); }

  const saveBudget = async (r, v) => {
    const amount = v === "" ? 0 : Number(v);
    try {
      if (r.overridden || month !== thisMonth()) await api("/api/budget/override", { method: "PUT", body: { category_id: r.id, month, amount } });
      else await api(`/api/t/categories/${r.id}`, { method: "PUT", body: { monthly_budget: amount } });
      q.reload();
    } catch (e) { toast(e.message, true); }
  };
  const saveTotal = async (r, v) => {
    try { await api("/api/transactions/monthly", { body: { month, category_id: r.id, amount: Number(v) || 0 } }); q.reload(); reload(); } catch (e) { toast(e.message, true); }
  };
  const clearOverride = async (r) => { await api("/api/budget/override", { method: "PUT", body: { category_id: r.id, month, amount: null } }); q.reload(); };

  return html`<div>
    <${PageHead} title="Budget" sub=${mode === "budget" ? "Planned vs. actual per category. Type a monthly amount to set the envelope." : "Type what you actually spent this month in each category."}>
      <div class="seg"><button onClick=${() => setMonth(shiftMonth(month, -1))}>‹</button><button class="active">${monthLabel(month)}</button><button onClick=${() => setMonth(shiftMonth(month, 1))}>›</button></div>
      <${Seg} options=${[["budget", "Set budgets"], ["totals", "Enter totals"]]} value=${mode} onChange=${setMode} />
    <//>
    <div class="grid c4 keep2" style="margin-bottom:14px">
      <${Stat} label="Income" value=${money(b.income)} />
      <${Stat} label="Spent" value=${money(b.expenses)} foot=${`of ${money(b.budgeted)} budgeted`} />
      <${Stat} label="Left in budget" value=${money(b.budgeted - b.expenses)} tone=${b.budgeted - b.expenses < 0 ? "bad" : ""} />
      <${Stat} label="Net" value=${money(b.net)} tone=${b.net < 0 ? "bad" : "good"} foot=${b.income ? `${pct(b.savings_rate)} savings rate` : ""} />
    </div>
    ${b.uncategorized.count ? html`<a class="alert medium" style="margin-bottom:14px" href=${`#/budget/transactions?category=none&month=${month}`}><div class="grow"><div class="t">${b.uncategorized.count} transactions have no category</div><div class="b">${money(-b.uncategorized.total)} not counted in any envelope. Tap to sort them.</div></div>›</a>` : null}
    <div class="card pad0"><div class="tablewrap"><table>
      <thead><tr><th>Category</th><th class="num">${mode === "budget" ? "Budget" : "This month"}</th><th class="num">Spent</th><th class="num">Left</th><th style="width:26%">Progress</th></tr></thead>
      <tbody>
        ${groups.map((g) => {
          const gb = g.rows.reduce((s, r) => s + r.budget, 0), ga = g.rows.reduce((s, r) => s + r.actual, 0);
          return html`<tr class="grouphead"><td>${g.name}</td><td class="num">${money(gb)}</td><td class="num">${money(ga)}</td><td class="num">${g.kind === "expense" ? money(gb - ga) : ""}</td><td></td></tr>
          ${g.rows.map((r) => html`<tr>
            <td><a href=${`#/budget/transactions?category=${r.id}&month=${month}`}>${r.name}</a>${r.overridden ? html` <span class="badge warn" title="Custom amount this month only" onClick=${(e) => { e.preventDefault(); clearOverride(r); }}>this month ✕</span>` : null}${r.home_link ? html` <span class="badge ok">house</span>` : null}</td>
            <td class="num">${mode === "budget"
              ? html`<input class="inline" type="number" inputmode="decimal" step="1" value=${r.budget || ""} placeholder="0" onChange=${(e) => saveBudget(r, e.target.value)} />`
              : html`<input class="inline" type="number" inputmode="decimal" step="0.01" value=${r.actual || ""} placeholder="0" onChange=${(e) => saveTotal(r, e.target.value)} title=${r.count > 1 ? "Adds to what is already logged" : ""} />`}</td>
            <td class="num">${money(r.actual)}${r.count ? html`<div class="tiny muted">${r.count} ${r.count === 1 ? "item" : "items"}</div>` : null}</td>
            <td class=${"num " + (r.kind === "expense" && r.remaining < 0 ? "bad" : "")}>${r.kind === "expense" ? money(r.remaining) : ""}</td>
            <td>${r.kind === "expense" && (r.budget > 0 || r.actual > 0) ? html`<${Bar} value=${r.budget ? r.pct : 1} />` : null}</td>
          </tr>`)}`;
        })}
      </tbody>
    </table></div></div>
    <div class="row wrap" style="margin-top:12px"><button class="btn sm" onClick=${() => setEditCat({})}>+ Add category</button><span class="tiny muted">Tip: when "Enter totals" is on, typing a number logs it as one transaction on the 1st of the month. Bank-synced and manual items add on top.</span></div>
    ${editCat ? html`<${EditSheet} table="categories" title="Add category" fields=${CAT_FIELDS} row=${null} ctx=${{ boot }} onClose=${() => setEditCat(null)} onSaved=${() => { q.reload(); reload(); }} />` : null}
  </div>`;
}
export const CAT_FIELDS = [
  { key: "name", label: "Name", full: true },
  { key: "group_name", label: "Group", placeholder: "e.g. Housing" },
  { key: "kind", label: "Type", type: "select", options: [["expense", "Expense"], ["income", "Income"], ["transfer", "Transfer"]], allowEmpty: false, default: "expense" },
  { key: "monthly_budget", label: "Monthly budget", type: "money" },
  { key: "sort", label: "Sort order", type: "number", default: 50 },
];

// ---- year grid ---------------------------------------------------------------------
function YearGrid() {
  const [year, setYear] = useState(Number(thisMonth().slice(0, 4)));
  const q = useAsync(() => api(`/api/budget/year?year=${year}`), [year]);
  if (!q.data) return html`<${Loading} />`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const exp = q.data.filter((r) => r.kind === "expense"), inc = q.data.filter((r) => r.kind === "income");
  const totals = (rows) => months.map((_, i) => rows.reduce((s, r) => s + r.months[i], 0));
  const te = totals(exp), ti = totals(inc);
  const line = (label, vals, cls = "") => html`<tr class="grouphead"><td>${label}</td>${vals.map((v) => html`<td class=${"num " + cls}>${v ? money(v, { cents: false }) : "·"}</td>`)}<td class="num">${money(vals.reduce((a, b) => a + b, 0), { cents: false })}</td><td></td></tr>`;
  return html`<div>
    <${PageHead} title="Year view" sub="The 12-month grid from the spreadsheet — every category by month.">
      <div class="seg"><button onClick=${() => setYear(year - 1)}>‹</button><button class="active">${year}</button><button onClick=${() => setYear(year + 1)}>›</button></div>
    <//>
    <div class="card pad0"><div class="tablewrap"><table class="monthgrid">
      <thead><tr><th>Category</th>${months.map((m) => html`<th class="num">${m}</th>`)}<th class="num">Total</th><th class="num">Annual budget</th></tr></thead>
      <tbody>
        ${line("Income", ti, "good")}
        ${inc.map((r) => row(r, months))}
        ${line("Expenses", te)}
        ${exp.map((r) => row(r, months))}
        ${line("Net", months.map((_, i) => ti[i] - te[i]))}
      </tbody>
    </table></div></div>
  </div>`;
  function row(r, months) {
    return html`<tr><td>${r.name}</td>${months.map((_, i) => html`<td class="num">${r.months[i] ? money(r.months[i], { cents: false }) : html`<span class="muted">·</span>`}</td>`)}<td class="num strong">${money(r.total, { cents: false })}</td><td class="num muted">${r.annual_budget ? money(r.annual_budget, { cents: false }) : ""}</td></tr>`;
  }
}

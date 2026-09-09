import { html, useState } from "../vendor/preact-htm.js";
import { api, useApp } from "../app.js";
import { Bar, Empty, Stat, money, pct, thisMonth, monthLabel, fmtDate, useAsync, Loading } from "../ui.js";
import { QuickAdd } from "./transactions.js";
import { DoneSheet } from "./home.js";

export default function Dashboard() {
  const { boot, reload } = useApp();
  const month = thisMonth();
  const q = useAsync(() => Promise.all([api(`/api/budget?month=${month}`), api("/api/goals"), api("/api/home/overview"), api("/api/paycheck")]), [boot?.today]);
  const [adding, setAdding] = useState(false);
  const [doneTask, setDoneTask] = useState(null);
  if (q.loading && !q.data) return html`<${Loading} />`;
  const [budget, goals, home, plan] = q.data || [null, [], null, null];
  const owner = boot.settings.mode === "owner";
  const alerts = boot.alerts || [];
  const who = boot.people.find((p) => p.id === localStorage.getItem("hb_who"));
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const top = budget ? budget.rows.filter((r) => r.kind === "expense" && (r.budget > 0 || r.actual > 0)).sort((a, b) => b.pct - a.pct).slice(0, 6) : [];
  const tasks = home ? home.tasks.filter((t) => t.status !== "unscheduled").slice(0, 5) : [];

  return html`<div>
    <div class="pagehead"><div><h1>${greet}${who ? `, ${who.name}` : ""}</h1><div class="sub">${monthLabel(month)} · ${owner ? (boot.settings.home?.address || "Your home") : "House hunting"}</div></div>
      <div class="row wrap"><button class="btn" onClick=${() => setAdding(true)}>+ Transaction</button><a class="btn" href="#/home/maintenance">Log a task</a></div></div>

    ${alerts.length ? html`<div class="stack" style="margin-bottom:16px">${alerts.map((a) => html`<a class=${"alert " + a.severity} href=${a.link}><div class="grow"><div class="t">${a.title}</div><div class="b">${a.body}</div></div><span class="muted">›</span></a>`)}</div>` : null}

    <div class="grid c4 keep2" style="margin-bottom:14px">
      <${Stat} label="Income" value=${money(budget?.income || 0)} foot=${plan ? `plan ${money(plan.net_monthly)}` : ""} />
      <${Stat} label="Spent" value=${money(budget?.expenses || 0)} foot=${budget ? `of ${money(budget.budgeted)} budgeted` : ""} />
      <${Stat} label="Net" value=${money(budget?.net || 0)} tone=${(budget?.net || 0) < 0 ? "bad" : "good"} foot=${budget?.income ? `${pct(budget.savings_rate)} saved` : "no income logged yet"} />
      <${Stat} label="Spending room" value=${money(plan?.spending_available || 0)} foot="after fixed bills & savings" />
    </div>

    <div class="grid c2">
      <div class="card">
        <div class="between"><h2>Envelopes</h2><a class="small" href="#/budget">All →</a></div>
        ${top.length ? top.map((r) => html`<div style="margin-bottom:10px"><div class="between small"><span class="strong">${r.name}</span><span class="mono">${money(r.actual)} <span class="muted">/ ${money(r.budget)}</span></span></div><${Bar} value=${r.budget ? r.pct : 1} /></div>`)
          : html`<${Empty} title="No budgets set yet" body="Open Budget and type a monthly amount next to each category." />`}
        ${budget?.uncategorized.count ? html`<a class="pill" href="#/budget/transactions?category=none">${budget.uncategorized.count} uncategorized →</a>` : null}
      </div>

      <div class="card">
        <div class="between"><h2>${owner ? "House" : "Buying a house"}</h2><a class="small" href="#/home">Open →</a></div>
        ${owner ? html`
          <div class="row gap" style="margin-bottom:10px">
            <span class=${"badge " + (home.overdue ? "bad" : "ok")}>${home.overdue} overdue</span>
            <span class=${"badge " + (home.due_soon ? "warn" : "")}>${home.due_soon} due soon</span>
            <span class="badge">${home.warranties_expiring} warranties ending</span>
          </div>
          <div class="list">${tasks.length ? tasks.map((t) => html`<div class="item"><div class="grow"><div class="t">${t.name}</div><div class="s">${t.status === "overdue" ? "Overdue · " : ""}${fmtDate(t.next_due)}</div></div><button class="btn sm" onClick=${() => setDoneTask(t)}>Done</button></div>`)
            : html`<${Empty} title="No tasks scheduled" body="Set a 'last done' date on each maintenance task to start the clock." />`}</div>`
        : html`
          ${goals.filter((g) => /down payment/i.test(g.name)).map((g) => html`<div style="margin-bottom:12px"><div class="between"><span class="strong">${g.name}</span><span class="mono">${money(g.saved)} <span class="muted">/ ${money(g.target)}</span></span></div><${Bar} value=${g.pct} tone="" /><div class="tiny muted" style="margin-top:4px">${g.months_left} months left · needs ${money(g.monthly_needed)}/mo</div></div>`)}
          <div class="kv">
            ${[["escrow", "During escrow"], ["questions", "Questions for the builder"], ["first30", "First 30 days"]].map(([k, l]) => html`<span class="k">${l}</span><span class="v">${home.checklists[k]?.done || 0} / ${home.checklists[k]?.total || 0}</span>`)}
          </div>
          <a class="btn sm" style="margin-top:12px" href="#/home/checklists">Open checklists</a>`}
      </div>

      <div class="card">
        <div class="between"><h2>Goals</h2><a class="small" href="#/budget/goals">All →</a></div>
        ${goals.filter((g) => !g.done && g.target > 0).slice(0, 4).map((g) => html`<div style="margin-bottom:10px"><div class="between small"><span class="strong">${g.name}</span><span class="mono">${pct(g.pct)}</span></div><${Bar} value=${g.pct} tone="" /></div>`)}
      </div>

      <div class="card">
        <h2>Paycheck plan</h2>
        ${plan ? html`<div class="kv">
          <span class="k">Net income / month</span><span class="v">${money(plan.net_monthly)}</span>
          <span class="k">Fixed (mortgage, loans)</span><span class="v">− ${money(plan.fixed_monthly)}</span>
          <span class="k">Savings transfers</span><span class="v">− ${money(plan.transfers_monthly)}</span>
          <span class="k strong">Spending available</span><span class="v">${money(plan.spending_available)}</span>
          <span class="k">Envelopes budgeted</span><span class="v">${money(plan.envelopes_budgeted)}</span>
          <span class="k">${plan.unbudgeted >= 0 ? "Unassigned" : "Over-assigned"}</span><span class=${"v " + (plan.unbudgeted < 0 ? "bad" : "good")}>${money(Math.abs(plan.unbudgeted))}</span>
        </div><a class="btn sm" style="margin-top:12px" href="#/budget/paycheck">Adjust plan</a>` : null}
      </div>
    </div>
    ${adding ? html`<${QuickAdd} onClose=${() => setAdding(false)} onSaved=${() => { q.reload(); reload(); }} />` : null}
    ${doneTask ? html`<${DoneSheet} task=${doneTask} onClose=${() => setDoneTask(null)} onSaved=${() => { q.reload(); reload(); }} />` : null}
  </div>`;
}

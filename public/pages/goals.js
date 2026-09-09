import { html, useState } from "../vendor/preact-htm.js";
import { api, useApp } from "../app.js";
import { Bar, PageHead, money, pct, fmtDate, useAsync, Loading, ErrorBox, EditSheet, Empty } from "../ui.js";

export default function Goals() {
  const { boot, reload } = useApp();
  const q = useAsync(() => api("/api/goals"), []);
  const [edit, setEdit] = useState(null);
  if (q.error) return html`<${ErrorBox} error=${q.error} reload=${q.reload} />`;
  if (!q.data) return html`<${Loading} />`;
  const goals = q.data;
  return html`<div>
    <${PageHead} title="Savings goals" sub="Link a goal to an account and its balance becomes the progress. Otherwise update 'saved so far' by hand.">
      <button class="btn primary sm" onClick=${() => setEdit({})}>+ Goal</button>
    <//>
    ${goals.length === 0 ? html`<${Empty} title="No goals yet" />` : null}
    <div class="grid c2">
      ${goals.map((g) => html`<div class=${"card" + (g.done ? " soft" : "")} style="cursor:pointer" onClick=${() => setEdit(g)}>
        <div class="between"><h2>${g.name}</h2>${g.done ? html`<span class="badge ok">Done</span>` : html`<span class="strong mono">${pct(g.pct)}</span>`}</div>
        <${Bar} value=${g.pct} tone="" />
        <div class="kv" style="margin-top:10px">
          <span class="k">Saved</span><span class="v">${money(g.saved)}${g.linked_account ? html`<div class="tiny muted">from ${g.linked_account}</div>` : null}</span>
          <span class="k">Target</span><span class="v">${money(g.target)}${g.target_date ? html`<div class="tiny muted">by ${fmtDate(g.target_date)}</div>` : null}</span>
          ${!g.done && g.target > 0 ? html`<span class="k">Still needed</span><span class="v">${money(g.remaining)}</span>
          <span class="k">Per month</span><span class="v">${g.months_left > 0 ? html`${money(g.monthly_needed)} <span class="tiny muted">× ${g.months_left} mo</span>` : "now"}</span>` : null}
        </div>
        ${g.notes ? html`<div class="small muted" style="margin-top:8px">${g.notes}</div>` : null}
      </div>`)}
    </div>
    ${edit ? html`<${EditSheet} table="goals" title=${edit.id ? "Edit goal" : "Add goal"} fields=${FIELDS} ctx=${{ boot }} row=${edit.id ? edit : null} onClose=${() => setEdit(null)} onSaved=${() => { q.reload(); reload(); }} />` : null}
  </div>`;
}
const FIELDS = [
  { key: "name", label: "Goal", full: true },
  { key: "target", label: "Target amount", type: "money" },
  { key: "target_date", label: "Target date", type: "date" },
  { key: "account_id", label: "Linked account (optional)", type: "select", options: (ctx) => ctx.boot.accounts.map((a) => [a.id, a.name]), hint: "Progress = that account's balance" },
  { key: "saved", label: "Saved so far (if not linked)", type: "money" },
  { key: "done", label: "Status", type: "check", checkLabel: "Reached", default: 0 },
  { key: "notes", label: "Notes", type: "textarea", full: true },
];

import { html, useState } from "../vendor/preact-htm.js";
import { api, useApp, toast } from "../app.js";
import { Stat, PageHead, money, pct, useAsync, Loading, ErrorBox, EditSheet, Field } from "../ui.js";

export default function Paycheck() {
  const { boot, reload } = useApp();
  const q = useAsync(() => api("/api/paycheck"), []);
  const [editSrc, setEditSrc] = useState(null);
  const [editAlloc, setEditAlloc] = useState(null);
  if (q.error) return html`<${ErrorBox} error=${q.error} reload=${q.reload} />`;
  if (!q.data) return html`<${Loading} />`;
  const p = q.data;
  const ctx = { boot };
  const refresh = () => { q.reload(); reload(); };

  return html`<div>
    <${PageHead} title="Paycheck plan" sub="Alex's model: every income source with its own tax rate and deferrals, then where each month's net goes.">
      <button class="btn primary sm" onClick=${() => setEditSrc({})}>+ Income source</button>
    <//>
    <div class="grid c4 keep2" style="margin-bottom:14px">
      <${Stat} label="Gross / year" value=${money(p.gross_annual, { cents: false })} />
      <${Stat} label="Net / year" value=${money(p.net_annual, { cents: false })} />
      <${Stat} label="Net / month" value=${money(p.net_monthly)} tone="good" />
      <${Stat} label="Tax reserve / month" value=${money(p.reserve_monthly)} foot="1099 income × its tax rate" />
    </div>

    <div class="grid c2">
      ${p.byPerson.map((bp) => html`<div class="card">
        <div class="between"><h2>${bp.person.name}</h2><span class="muted small">${money(bp.net_monthly)}/mo net</span></div>
        <div class="list">
          ${p.sources.filter((s) => s.person_id === bp.person.id).map((s) => html`<div class="item click" onClick=${() => setEditSrc(s)}>
            <div class="grow"><div class="t">${s.name} <span class="badge">${s.kind === "1099" ? "1099" : "W-2"}</span></div>
              <div class="s">${money(s.gross_annual, { cents: false })} gross${s.deferred_annual ? ` − ${money(s.deferred_annual, { cents: false })} pre-tax` : ""} · ${pct(s.tax_rate)} tax${s.kind === "1099" ? ` → ${money(s.reserve_monthly)}/mo reserved` : ""}</div></div>
            <div class="amt">${money(s.net_monthly)}<div class="tiny muted right">/ mo</div></div>
          </div>`)}
          ${p.sources.filter((s) => s.person_id === bp.person.id).length === 0 ? html`<div class="empty">No income sources yet.</div>` : null}
        </div>
      </div>`)}
    </div>

    <div class="section-title"><h2>Where the net goes each month</h2><button class="btn sm" onClick=${() => setEditAlloc({})}>+ Add line</button></div>
    <div class="card pad0"><table>
      <tbody>
        <tr><td class="strong">Net household income</td><td></td><td class="num strong">${money(p.net_monthly)}</td></tr>
        ${p.allocations.filter((a) => a.kind !== "tax_reserve").map((a) => html`<tr class="click" onClick=${() => setEditAlloc(a)}>
          <td>${a.name}${a.notes ? html`<div class="tiny muted">${a.notes}</div>` : null}</td>
          <td><span class="badge">${{ fixed: "fixed bill", transfer: "to savings", tax_reserve: "tax reserve", spending: "spending" }[a.kind] || a.kind}</span>${a.account_id ? html` <span class="tiny muted">→ ${boot.accounts.find((x) => x.id === a.account_id)?.name || ""}</span>` : null}</td>
          <td class="num">− ${money(a.amount)}</td></tr>`)}
        <tr class="grouphead"><td>Spending available</td><td></td><td class=${"num " + (p.spending_available < 0 ? "bad" : "")}>${money(p.spending_available)}</td></tr>
        <tr><td>Envelopes budgeted (Budget page)</td><td></td><td class="num">− ${money(p.envelopes_budgeted)}</td></tr>
        <tr class="grouphead"><td>${p.unbudgeted >= 0 ? "Not yet assigned" : "Over-assigned"}</td><td></td><td class=${"num " + (p.unbudgeted < 0 ? "bad" : "good")}>${money(p.unbudgeted)}</td></tr>
        ${p.allocations.filter((a) => a.kind === "tax_reserve").map((a) => html`<tr class="click" onClick=${() => setEditAlloc(a)}>
          <td>${a.name}<div class="tiny muted">Already taken out of net above — this is what to physically move each month so it is there at tax time.</div></td>
          <td><span class="badge">from gross</span>${a.account_id ? html` <span class="tiny muted">→ ${boot.accounts.find((x) => x.id === a.account_id)?.name || ""}</span>` : null}</td>
          <td class="num">${money(a.amount)}</td></tr>`)}
      </tbody>
    </table></div>
    <p class="tiny muted">Annual: ${money(p.transfers_monthly * 12, { cents: false })} to savings · ${money(p.reserve_monthly * 12, { cents: false })} to the 1099 tax reserve.</p>

    ${editSrc ? html`<${EditSheet} table="income_sources" title=${editSrc.id ? "Edit income source" : "Add income source"} fields=${SRC_FIELDS} ctx=${ctx}
      row=${editSrc.id ? { ...editSrc, deferrals: JSON.stringify(editSrc.deferrals || []) } : null} onClose=${() => setEditSrc(null)} onSaved=${refresh} extra=${(v, setV) => html`<${Deferrals} value=${v} setValue=${setV} />`} />` : null}
    ${editAlloc ? html`<${EditSheet} table="allocations" title=${editAlloc.id ? "Edit line" : "Add line"} fields=${ALLOC_FIELDS} ctx=${ctx} row=${editAlloc.id ? editAlloc : null} onClose=${() => setEditAlloc(null)} onSaved=${refresh} />` : null}
  </div>`;
}

const SRC_FIELDS = [
  { key: "name", label: "Name", full: true, placeholder: "e.g. UCLA — base salary" },
  { key: "person_id", label: "Whose", type: "select", options: (ctx) => ctx.boot.people.map((p) => [p.id, p.name]), allowEmpty: false, default: (ctx) => ctx.boot.people[0]?.id },
  { key: "kind", label: "Type", type: "select", options: [["w2", "W-2 (taxes withheld)"], ["1099", "1099 (set tax aside)"]], allowEmpty: false, default: "w2" },
  { key: "gross_annual", label: "Gross per year", type: "money" },
  { key: "tax_rate", label: "Estimated tax rate", type: "percent", hint: "Flat estimate, like the spreadsheet (e.g. 40)", default: 0.35 },
  { key: "active", label: "Active", type: "check", default: 1, checkLabel: "Counts toward the plan" },
  { key: "notes", label: "Notes", type: "textarea", full: true },
];
function Deferrals({ value, setValue }) {
  let list = [];
  try { list = JSON.parse(value.deferrals || "[]"); } catch {}
  const set = (l) => setValue({ ...value, deferrals: JSON.stringify(l) });
  return html`<div style="margin-top:12px"><${Field} label="Pre-tax deferrals per year (401k, 457(b), DCP…)">
    ${list.map((d, i) => html`<div class="row" style="margin-bottom:6px"><input type="text" value=${d.name} placeholder="Name" onInput=${(e) => set(list.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /><input type="number" style="max-width:140px" value=${d.amount} placeholder="$/yr" onInput=${(e) => set(list.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x))} /><button class="iconbtn" onClick=${() => set(list.filter((_, j) => j !== i))}>✕</button></div>`)}
    <button class="btn sm" onClick=${() => set([...list, { name: "", amount: 0 }])}>+ Deferral</button>
  <//></div>`;
}
const ALLOC_FIELDS = [
  { key: "name", label: "Name", full: true },
  { key: "kind", label: "Kind", type: "select", options: [["fixed", "Fixed bill (mortgage, loan)"], ["transfer", "Transfer to savings"], ["tax_reserve", "1099 tax reserve (auto-computed)"]], allowEmpty: false, default: "fixed" },
  { key: "amount", label: "Amount / month", type: "money", hint: "Ignored for the tax reserve line" },
  { key: "account_id", label: "Goes to account", type: "select", options: (ctx) => ctx.boot.accounts.map((a) => [a.id, a.name]) },
  { key: "category_id", label: "Budget category", type: "select", options: (ctx) => ctx.boot.categories.filter((c) => c.kind === "expense").map((c) => [c.id, c.name]), hint: "Optional — links a fixed bill to its envelope" },
  { key: "notes", label: "Notes", type: "textarea", full: true },
  { key: "sort", label: "Order", type: "number", default: 10 },
];

import { html, useState } from "../vendor/preact-htm.js";
import { api, useApp, toast } from "../app.js";
import { Stat, SubNav, PageHead, Sheet, Form, Field, Photos, Seg, Bar, money, fmtDate, todayStr, useAsync, Loading, ErrorBox, EditSheet, Empty } from "../ui.js";
import { CrudList, yesNo, stars } from "./crud.js";

const TABS = [["", "Overview", "#/home"], ["maintenance", "Maintenance", "#/home/maintenance"], ["systems", "Systems & appliances", "#/home/systems"], ["warranties", "Warranties", "#/home/warranties"], ["projects", "Projects", "#/home/projects"], ["vendors", "Vendors", "#/home/vendors"], ["records", "Records", "#/home/records"], ["checklists", "Checklists", "#/home/checklists"], ["lifespans", "Lifespans", "#/home/lifespans"]];

export default function Home({ route }) {
  const sub = route.sub || "";
  const map = { maintenance: Maintenance, systems: Systems, warranties: Warranties, projects: Projects, vendors: Vendors, records: Records, checklists: Checklists, lifespans: Lifespans };
  const C = map[sub] || Overview;
  return html`<div><${SubNav} items=${TABS} active=${sub} /><${C} route=${route} /></div>`;
}

// ---- overview ----------------------------------------------------------------------
function Overview() {
  const { boot } = useApp();
  const q = useAsync(() => api("/api/home/overview"), [boot?.today]);
  const [doneTask, setDoneTask] = useState(null);
  if (q.error) return html`<${ErrorBox} error=${q.error} reload=${q.reload} />`;
  if (!q.data) return html`<${Loading} />`;
  const o = q.data, home = boot.settings.home || {}, owner = boot.settings.mode === "owner";
  const upcoming = o.tasks.filter((t) => t.status !== "unscheduled").slice(0, 6);
  const unscheduled = o.tasks.filter((t) => t.status === "unscheduled").length;
  return html`<div>
    <${PageHead} title=${home.address || (owner ? "Our home" : "The house we'll buy")} sub=${owner ? [home.beds_baths, home.sqft ? `${home.sqft} sq ft` : "", home.year_built ? `built ${home.year_built}` : ""].filter(Boolean).join(" · ") : "Everything is ready for move-in day. Until then: the escrow list, the builder questions and the down-payment goal."}>
      <a class="btn sm" href="#/settings">Edit details</a>
    <//>
    ${!owner ? html`<div class="alert" style="margin-bottom:14px"><div class="grow"><div class="t">House-hunting mode</div><div class="b">Maintenance reminders and warranty clocks start when you set the stage to “We own it” and enter a close date in Settings. Everything else works now.</div></div></div>` : null}
    <div class="grid c4 keep2" style="margin-bottom:14px">
      <${Stat} label="Overdue tasks" value=${o.overdue} tone=${o.overdue ? "bad" : ""} foot=${unscheduled ? `${unscheduled} not scheduled yet` : ""} />
      <${Stat} label="Due soon" value=${o.due_soon} tone=${o.due_soon ? "warn" : ""} />
      <${Stat} label="Warranties" value=${o.warranties_active} foot=${o.warranties_expiring ? `${o.warranties_expiring} ending within ${boot.settings.notify?.warranty_days || 90} days` : "active"} />
      <${Stat} label="Inventory value" value=${money(o.inventory.total, { cents: false })} foot=${`${o.inventory.count} items · for insurance`} />
    </div>
    <div class="grid c2">
      <div class="card">
        <div class="between"><h2>Up next</h2><a class="small" href="#/home/maintenance">All tasks →</a></div>
        <div class="list">${upcoming.length ? upcoming.map((t) => html`<div class="item"><div class="grow"><div class="t">${t.name}</div><div class="s">${statusLabel(t)}</div></div><button class="btn sm" onClick=${() => setDoneTask(t)}>Done</button></div>`)
          : html`<${Empty} title="Nothing scheduled yet" body="Open Maintenance and enter when each task was last done — the next date and the reminders follow." />`}</div>
      </div>
      <div class="card">
        <h2>Money in the house</h2>
        <div class="kv">
          <span class="k">Purchase price</span><span class="v">${o.basis.purchase_price ? money(o.basis.purchase_price, { cents: false }) : "—"}</span>
          <span class="k">Improvements to date</span><span class="v">${money(o.basis.improvements_total, { cents: false })}</span>
          <span class="k">…adding to cost basis</span><span class="v">${money(o.basis.basis_adding, { cents: false })}</span>
          <span class="k">Adjusted cost basis</span><span class="v">${o.basis.adjusted_basis ? money(o.basis.adjusted_basis, { cents: false }) : "—"}</span>
          <span class="k">Projects planned</span><span class="v">${money(o.projects_planned, { cents: false })}</span>
          ${o.walkthrough ? html`<span class="k">11-month walkthrough by</span><span class="v">${fmtDate(o.walkthrough)}</span>` : null}
        </div>
        <p class="tiny muted" style="margin-top:8px">Improvements (roof, remodel, HVAC) raise your basis and shrink the taxable gain at sale; repairs usually don't. Confirm with a tax pro before selling.</p>
      </div>
      <div class="card">
        <div class="between"><h2>Replacement forecast</h2><a class="small" href="#/home/systems">Systems →</a></div>
        ${o.forecast.filter((f) => f.replace_year).length ? html`<div class="list">${o.forecast.filter((f) => f.replace_year).slice(0, 6).map((f) => html`<div class="item"><div class="grow"><div class="t">${f.name}</div><div class="s">~${f.replace_year}${f.replace_cost ? ` · est. ${money(f.replace_cost, { cents: false })}` : ""}</div></div>${f.monthly_set_aside ? html`<div class="amt small">${money(f.monthly_set_aside)}/mo</div>` : null}</div>`)}</div>`
          : html`<${Empty} title="Set the year built" body="Enter it in Settings (or an install date per system) and each system's likely replacement year appears here." />`}
      </div>
      <div class="card">
        <div class="between"><h2>Checklists</h2><a class="small" href="#/home/checklists">Open →</a></div>
        <div class="stack">${Object.entries(LISTS).map(([k, l]) => { const c = o.checklists[k] || { done: 0, total: 0 }; return html`<div><div class="between small"><span>${l}</span><span class="muted">${c.done}/${c.total}</span></div><${Bar} value=${c.total ? c.done / c.total : 0} tone="" /></div>`; })}</div>
      </div>
    </div>
    ${doneTask ? html`<${DoneSheet} task=${doneTask} onClose=${() => setDoneTask(null)} onSaved=${q.reload} />` : null}
  </div>`;
}
const LISTS = { escrow: "During escrow", questions: "Questions for builder / seller", first30: "First 30 days", closing: "Closing-day punch list", walkthrough11: "11-month walkthrough", seasonal_spring: "Spring", seasonal_fall: "Fall" };
function statusLabel(t) {
  if (t.status === "overdue") return `Overdue · was due ${fmtDate(t.next_due)}`;
  if (t.status === "due") return "Due today";
  if (t.status === "soon") return `Due ${fmtDate(t.next_due)} · in ${t.days_until} days`;
  if (t.status === "ok") return `Next ${fmtDate(t.next_due)}`;
  return "Not scheduled";
}

// ---- maintenance --------------------------------------------------------------------
function Maintenance() {
  const { boot, reload } = useApp();
  const q = useAsync(() => api("/api/home/overview"), []);
  const [edit, setEdit] = useState(null);
  const [done, setDone] = useState(null);
  const [showLog, setShowLog] = useState(false);
  if (q.error) return html`<${ErrorBox} error=${q.error} reload=${q.reload} />`;
  if (!q.data) return html`<${Loading} />`;
  const tasks = q.data.tasks;
  const buckets = [["overdue", "Overdue"], ["due", "Due today"], ["soon", "Coming up"], ["ok", "Scheduled"], ["unscheduled", "Not scheduled yet"]];
  const refresh = () => { q.reload(); reload(); };
  return html`<div>
    <${PageHead} title="Maintenance" sub="Mark a task done and the next date rolls forward by its interval. Reminders and the calendar feed follow automatically.">
      <button class="btn" onClick=${() => setShowLog(true)}>History</button><button class="btn primary sm" onClick=${() => setEdit({})}>+ Task</button>
    <//>
    ${buckets.map(([k, label]) => { const list = tasks.filter((t) => t.status === k); return list.length ? html`
      <h2 style="margin:16px 0 8px">${label} <span class="muted small">${list.length}</span></h2>
      <div class="card pad0"><div class="list">${list.map((t) => html`<div class="item">
        <div class="grow click" onClick=${() => setEdit(t)}><div class="t">${t.name}</div><div class="s">${t.area}${t.asset_name ? ` · ${t.asset_name}` : ""} · every ${intervalLabel(t.interval_months)}${k === "unscheduled" ? "" : ` · ${statusLabel(t)}`}${t.last_done ? html`<span class="tiny"> · last ${fmtDate(t.last_done)}</span>` : ""}</div></div>
        <button class=${"btn sm" + (k === "overdue" || k === "due" ? " primary" : "")} onClick=${() => setDone(t)}>${k === "unscheduled" ? "Log it" : "Done"}</button>
      </div>`)}</div></div>` : null; })}
    ${edit ? html`<${EditSheet} table="maintenance_tasks" title=${edit.id ? "Edit task" : "Add task"} fields=${TASK_FIELDS} ctx=${{ boot }} row=${edit.id ? edit : null} onClose=${() => setEdit(null)} onSaved=${refresh}
      extra=${(v) => v.id ? html`<${TaskLog} taskId=${v.id} />` : null} />` : null}
    ${done ? html`<${DoneSheet} task=${done} onClose=${() => setDone(null)} onSaved=${refresh} />` : null}
    ${showLog ? html`<${Sheet} title="Maintenance history" onClose=${() => setShowLog(false)}><${TaskLog} /><//>` : null}
  </div>`;
}
const intervalLabel = (m) => { m = Number(m); if (m === 1) return "month"; if (m < 12) return `${m} months`; if (m === 12) return "year"; if (m % 12 === 0) return `${m / 12} years`; return `${m} months`; };
const TASK_FIELDS = [
  { key: "name", label: "Task", full: true },
  { key: "area", label: "Area", placeholder: "HVAC, Plumbing, Exterior…" },
  { key: "interval_months", label: "Every (months)", type: "number", step: "1", default: 12 },
  { key: "last_done", label: "Last done", type: "date", hint: "Sets the next due date" },
  { key: "asset_id", label: "System / appliance", type: "select", options: (ctx) => ctx.boot.assets.map((a) => [a.id, a.name]) },
  { key: "est_cost", label: "Typical cost", type: "money" },
  { key: "remind_days", label: "Remind days before", type: "number", step: "1", default: 7 },
  { key: "active", label: "Active", type: "check", default: 1, checkLabel: "Track this task" },
  { key: "notes", label: "Notes", type: "textarea", full: true },
];
function TaskLog({ taskId }) {
  const q = useAsync(() => api(`/api/maintenance/log${taskId ? `?task_id=${taskId}` : ""}`), [taskId]);
  if (!q.data) return html`<${Loading} />`;
  return html`<div style="margin-top:12px"><${Field} label="History"><//>
    ${q.data.length ? html`<div class="list card pad0">${q.data.map((l) => html`<div class="item"><div class="grow small">${taskId ? "" : html`<b>${l.task_name}</b> · `}${fmtDate(l.done_on)}${l.person_name ? ` · ${l.person_name}` : ""}${l.vendor ? ` · ${l.vendor}` : ""}${l.notes ? html`<div class="tiny muted">${l.notes}</div>` : null}</div>${l.cost ? html`<span class="amt small">${money(l.cost)}</span>` : null}</div>`)}</div>` : html`<div class="muted small">No entries yet.</div>`}
  </div>`;
}

export function DoneSheet({ task, onClose, onSaved }) {
  const { boot, who } = useApp();
  const [v, setV] = useState({ done_on: todayStr(), cost: "", person_id: who || "", vendor_id: "", notes: "", post_to_budget: 1, account_id: boot.accounts[0]?.id || "" });
  const [busy, setBusy] = useState(false);
  const fields = [
    { key: "done_on", label: "Done on", type: "date" },
    { key: "person_id", label: "Who did it", type: "select", options: boot.people.map((p) => [p.id, p.name]) },
    { key: "cost", label: "Cost", type: "money" },
    { key: "vendor_id", label: "Vendor", type: "select", options: boot.vendors.filter((x) => x.company).map((x) => [x.id, `${x.company} (${x.trade})`]), placeholder: "DIY" },
    { key: "post_to_budget", label: "Budget", type: "check", checkLabel: "Post the cost to Home Maintenance & Repairs", hidden: (val) => !Number(val.cost) },
    { key: "account_id", label: "Paid from", type: "select", options: boot.accounts.map((a) => [a.id, a.name]), hidden: (val) => !Number(val.cost) || !Number(val.post_to_budget) },
    { key: "notes", label: "Notes", type: "textarea", full: true },
  ];
  const save = async () => {
    setBusy(true);
    try {
      const vendor = boot.vendors.find((x) => x.id === v.vendor_id);
      await api(`/api/maintenance/${task.id}/done`, { body: { ...v, cost: Number(v.cost) || 0, vendor_name: vendor?.company } });
      toast(`${task.name} — done`); onSaved(); onClose();
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  return html`<${Sheet} title=${task.name} onClose=${onClose} actions=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy} onClick=${save}>Mark done</button>`}>
    <p class="small muted">${task.notes || ""} Next due will move to ${fmtDate(addMonthsStr(v.done_on || todayStr(), task.interval_months))}.</p>
    <${Form} fields=${fields} value=${v} onChange=${setV} />
  <//>`;
}
function addMonthsStr(d, months) { const dt = new Date(d + "T00:00:00"); dt.setMonth(dt.getMonth() + Math.floor(Number(months) || 0)); return dt.toLocaleDateString("en-CA"); }

// ---- systems & appliances -----------------------------------------------------------
function Systems() {
  const { boot, reload } = useApp();
  const home = boot.settings.home || {};
  const spec = {
    table: "assets", singular: "item", addLabel: "System or appliance", photos: true, onSaved: (ctx) => ctx.reload?.(),
    groupBy: (r) => r.category === "appliance" ? "Appliances" : "Systems",
    sub: "Make, model, serial, install date and warranty for everything that runs the house. Add a photo of each serial plate.",
    columns: [
      { key: "name", label: "Item", render: (r) => html`<b>${r.name}</b>${r.location ? html`<div class="tiny muted">${r.location}</div>` : null}` },
      { key: "make", label: "Make / model", render: (r) => [r.make, r.model].filter(Boolean).join(" ") || html`<span class="muted">—</span>` },
      { key: "serial", label: "Serial" },
      { key: "install_date", label: "Installed", render: (r) => r.install_date ? fmtDate(r.install_date) : "" },
      { key: "warranty_until", label: "Warranty until", render: (r) => r.warranty_until ? fmtDate(r.warranty_until) : "" },
      { key: "life", label: "Replace ~", render: (r) => { const y = r.install_date ? Number(String(r.install_date).slice(0, 4)) : Number(home.year_built); return y && r.lifespan_years ? y + Number(r.lifespan_years) : ""; } },
      { key: "registered", label: "Registered", render: (r) => r.category === "appliance" ? yesNo(r.registered) : "" },
    ],
    fields: [
      { key: "name", label: "Name", full: true },
      { key: "category", label: "Kind", type: "select", options: [["system", "System"], ["appliance", "Appliance"]], allowEmpty: false, default: "system" },
      { key: "location", label: "Location", placeholder: "Garage, attic, hall closet…" },
      { key: "make", label: "Make / brand" }, { key: "model", label: "Model #" }, { key: "serial", label: "Serial #" },
      { key: "install_date", label: "Install / purchase date", type: "date" }, { key: "capacity", label: "Capacity / size", placeholder: "3 ton, 50 gal, 200A…" },
      { key: "warranty_until", label: "Warranty until", type: "date" }, { key: "registered", label: "Registered with maker", type: "check", checkLabel: "Yes" },
      { key: "lifespan_years", label: "Expected life (years)", type: "number", step: "1" }, { key: "replace_cost", label: "Replacement cost (est.)", type: "money" },
      { key: "manual_url", label: "Manual link", type: "url", full: true }, { key: "support_phone", label: "Support phone", type: "tel" },
      { key: "notes", label: "Notes (filter size, quirks…)", type: "textarea", full: true },
    ],
  };
  return html`<div><${PageHead} title="Systems & appliances" /><${CrudList} spec=${{ ...spec, onSaved: () => reload() }} /></div>`;
}

// ---- warranties ----------------------------------------------------------------------
function Warranties() {
  const { boot } = useApp();
  const q = useAsync(() => api("/api/home/overview"), []);
  const view = q.data ? Object.fromEntries(q.data.warranties.map((w) => [w.id, w])) : {};
  const spec = {
    table: "warranties", singular: "warranty", addLabel: "Warranty", groupBy: "group_name",
    sub: "Enter the start date (usually the close date) and the length; expiry and status fill in. Reminders fire before each one closes.",
    columns: [
      { key: "name", label: "Coverage", render: (r) => html`<b>${r.name}</b>${r.covers ? html`<div class="tiny muted">${r.covers}</div>` : null}` },
      { key: "provider", label: "Who to call" },
      { key: "start_date", label: "Start", render: (r) => r.start_date ? fmtDate(r.start_date) : html`<span class="muted">—</span>` },
      { key: "length_months", label: "Length", render: (r) => r.length_months ? intervalLabel(r.length_months) : "" },
      { key: "expires", label: "Expires", render: (r) => view[r.id]?.expires ? fmtDate(view[r.id].expires) : "" },
      { key: "status", label: "Status", render: (r) => { const s = view[r.id]?.status; return s === "active" ? html`<span class="badge ok">Active</span>` : s === "expiring" ? html`<span class="badge warn">${view[r.id].days_until} days left</span>` : s === "expired" ? html`<span class="badge bad">Expired</span>` : html`<span class="badge">Fill in dates</span>`; } },
    ],
    fields: [
      { key: "name", label: "Coverage / item", full: true },
      { key: "group_name", label: "Group", type: "select", options: ["Builder", "Systems & exterior", "Appliances", "Other"], default: "Other" },
      { key: "provider", label: "Provider — who to call" },
      { key: "covers", label: "What's covered", full: true },
      { key: "start_date", label: "Start date", type: "date", hint: "Usually the close date" },
      { key: "length_months", label: "Length (months)", type: "number", step: "1" },
      { key: "asset_id", label: "Linked system / appliance", type: "select", options: (ctx) => ctx.boot.assets.map((a) => [a.id, a.name]) },
      { key: "doc_location", label: "Document location", placeholder: "Drive › Home › Warranties" },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ],
    onSaved: () => q.reload(),
  };
  const fillAll = async () => {
    const d = boot.settings.home?.close_date;
    if (!d) return toast("Set the close date in Settings first.", true);
    if (!confirm(`Set the start date to ${fmtDate(d)} on every warranty that has none?`)) return;
    const rows = await api("/api/t/warranties");
    for (const r of rows) if (!r.start_date) await api(`/api/t/warranties/${r.id}`, { method: "PUT", body: { start_date: d } });
    toast("Start dates filled"); q.reload(); location.reload();
  };
  return html`<div><${PageHead} title="Warranties"><button class="btn sm" onClick=${fillAll}>Use close date for all</button><//><${CrudList} spec=${spec} /></div>`;
}

// ---- projects: improvements log + wishlist -------------------------------------------
function Projects() {
  const { boot, reload } = useApp();
  const [view, setView] = useState("done");
  const q = useAsync(() => api("/api/home/overview"), []);
  const basis = q.data?.basis;
  const specDone = {
    table: "projects", singular: "project", addLabel: "Project", photos: true,
    sub: "Everything done to the house, with cost and whether it adds to the tax cost basis. Keep the receipt either way.",
    sortRows: (a, b) => String(b.date || "").localeCompare(String(a.date || "")),
    columns: [
      { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
      { key: "name", label: "Project", render: (r) => html`<b>${r.name}</b>${r.notes ? html`<div class="tiny muted">${r.notes}</div>` : null}` },
      { key: "type", label: "Type", render: (r) => html`<span class=${"badge " + (r.type === "improvement" ? "ok" : "")}>${r.type}</span>` },
      { key: "vendor", label: "Vendor", render: (r) => boot.vendors.find((v) => v.id === r.vendor_id)?.company || "DIY" },
      { key: "cost", label: "Cost", num: true, render: (r) => money(r.cost || 0, { cents: false }) },
      { key: "adds_basis", label: "Basis", render: (r) => yesNo(r.adds_basis) },
      { key: "receipt", label: "Receipt", render: (r) => yesNo(r.receipt) },
      { key: "posted", label: "Budget", render: (r) => r.transaction_id ? html`<span class="badge ok">posted</span>` : html`<button class="btn sm" onClick=${async (e) => { e.stopPropagation(); if (!Number(r.cost)) return toast("Add a cost first.", true); await api(`/api/projects/${r.id}/post`, { body: { account_id: boot.accounts[0]?.id } }); toast("Posted to budget"); location.reload(); }}>Post cost</button>` },
    ],
    fields: PROJECT_FIELDS,
    onSaved: () => { q.reload(); reload(); },
  };
  const specIdeas = {
    table: "projects", singular: "idea", addLabel: "Idea", sub: "Future projects with rough budgets and priorities. Move one to 'Done' when it happens.",
    columns: [
      { key: "name", label: "Project", render: (r) => html`<b>${r.name}</b>${r.notes ? html`<div class="tiny muted">${r.notes}</div>` : null}` },
      { key: "priority", label: "Priority", render: (r) => r.priority ? html`<span class=${"badge " + (r.priority === "High" ? "bad" : r.priority === "Medium" ? "warn" : "")}>${r.priority}</span>` : "" },
      { key: "est_cost", label: "Est. cost", num: true, render: (r) => r.est_cost ? money(r.est_cost, { cents: false }) : "" },
      { key: "timing", label: "Timing" }, { key: "status", label: "Status" },
    ],
    fields: PROJECT_FIELDS, onSaved: () => q.reload(),
  };
  return html`<div>
    <${PageHead} title="Projects" sub=""><${Seg} options=${[["done", "Improvements & repairs"], ["ideas", "Wishlist"]]} value=${view} onChange=${setView} /><//>
    ${basis ? html`<div class="grid c3" style="margin-bottom:14px"><${Stat} label="Spent on the house" value=${money(basis.improvements_total, { cents: false })} /><${Stat} label="Adds to cost basis" value=${money(basis.basis_adding, { cents: false })} /><${Stat} label="Adjusted basis" value=${basis.adjusted_basis ? money(basis.adjusted_basis, { cents: false }) : "—"} foot=${basis.purchase_price ? "" : "set purchase price in Settings"} /></div>` : null}
    <${CrudList} spec=${view === "done" ? specDone : specIdeas} filter=${(r) => view === "done" ? r.status === "done" : r.status !== "done"} key=${view} />
  </div>`;
}
const PROJECT_FIELDS = [
  { key: "name", label: "Project / repair", full: true },
  { key: "status", label: "Status", type: "select", options: [["idea", "Idea"], ["quoting", "Getting quotes"], ["planned", "Planned"], ["done", "Done"]], allowEmpty: false, default: "done" },
  { key: "type", label: "Type", type: "select", options: [["improvement", "Improvement (adds value)"], ["repair", "Repair (fixes something)"]], allowEmpty: false, default: "improvement" },
  { key: "date", label: "Date done", type: "date" },
  { key: "cost", label: "Actual cost", type: "money" },
  { key: "est_cost", label: "Estimated cost", type: "money" },
  { key: "vendor_id", label: "Vendor", type: "select", options: (ctx) => ctx.boot.vendors.filter((v) => v.company).map((v) => [v.id, v.company]), placeholder: "DIY" },
  { key: "permit", label: "Permit #" },
  { key: "priority", label: "Priority", type: "select", options: ["High", "Medium", "Low"] },
  { key: "timing", label: "Target timing", placeholder: "Year 1, Spring 2028…" },
  { key: "adds_basis", label: "Cost basis", type: "check", checkLabel: "Adds to cost basis" },
  { key: "receipt", label: "Receipt", type: "check", checkLabel: "Receipt saved" },
  { key: "notes", label: "Notes", type: "textarea", full: true },
];

// ---- vendors -------------------------------------------------------------------------
function Vendors() {
  const { reload } = useApp();
  const spec = {
    table: "vendors", singular: "vendor", addLabel: "Vendor", sub: "Your rolodex of trusted trades. Rate them so you remember who to call back.",
    columns: [
      { key: "trade", label: "Trade", render: (r) => html`<b>${r.trade}</b>` },
      { key: "company", label: "Company", render: (r) => r.company || html`<span class="muted">— add one —</span>` },
      { key: "contact", label: "Contact" },
      { key: "phone", label: "Phone", render: (r) => r.phone ? html`<a href=${"tel:" + r.phone} onClick=${(e) => e.stopPropagation()}>${r.phone}</a>` : "" },
      { key: "rating", label: "Rating", render: (r) => stars(r.rating) },
      { key: "last_used", label: "Last used", render: (r) => r.last_used ? fmtDate(r.last_used) : "" },
      { key: "notes", label: "Notes", render: (r) => html`<span class="small muted">${r.notes || ""}</span>` },
    ],
    fields: [
      { key: "trade", label: "Trade / service" }, { key: "company", label: "Company" }, { key: "contact", label: "Contact name" },
      { key: "phone", label: "Phone", type: "tel" }, { key: "email", label: "Email", type: "email" },
      { key: "rating", label: "Rating (1–5)", type: "select", options: ["5", "4", "3", "2", "1"] }, { key: "last_used", label: "Last used", type: "date" },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ],
    onSaved: () => reload(),
  };
  return html`<div><${PageHead} title="Vendors" /><${CrudList} spec=${spec} /></div>`;
}

// ---- records: paint, documents, inventory, utilities, emergency ------------------------
function Records({ route }) {
  const [view, setView] = useState(route.query.tab || "emergency");
  const specs = {
    emergency: {
      table: "emergency", singular: "entry", addLabel: "Entry", groupBy: "section", sub: "The break-glass page. Where every shutoff is and who to call. Safe to show a house-sitter.",
      columns: [{ key: "label", label: "Item", render: (r) => html`<b>${r.label}</b>` }, { key: "value", label: "Location / number / what to do", render: (r) => r.value || html`<span class="muted">${r.note || "fill in"}</span>` }, { key: "note", label: "Note", render: (r) => r.value ? html`<span class="small muted">${r.note || ""}</span>` : "" }],
      fields: [{ key: "section", label: "Section", type: "select", options: ["Shutoffs", "Contacts", "If this happens…"], allowEmpty: false, default: "Contacts" }, { key: "label", label: "Item" }, { key: "value", label: "Location / number / steps", full: true }, { key: "note", label: "Note", full: true }],
      photos: true,
    },
    finishes: {
      table: "finishes", singular: "finish", addLabel: "Finish", groupBy: "room", sub: "Paint brand, color, code and sheen per room; flooring, tile, grout. Everyone forgets these and everyone needs them later.",
      columns: [{ key: "surface", label: "Surface" }, { key: "brand", label: "Brand" }, { key: "color_name", label: "Color", render: (r) => html`${r.color_name || ""}${r.color_code ? html` <span class="muted">${r.color_code}</span>` : null}` }, { key: "sheen", label: "Sheen" }, { key: "material", label: "Material / spec" }, { key: "notes", label: "Notes", render: (r) => html`<span class="small muted">${r.notes || ""}</span>` }],
      fields: [{ key: "room", label: "Room / area" }, { key: "surface", label: "Surface", placeholder: "Walls, trim, floor, tile…" }, { key: "brand", label: "Brand" }, { key: "color_name", label: "Color name" }, { key: "color_code", label: "Color code" }, { key: "sheen", label: "Sheen / finish" }, { key: "material", label: "Material / spec", full: true }, { key: "notes", label: "Notes", type: "textarea", full: true }],
      photos: true, emptyTitle: "No finishes recorded", emptyBody: "Add paint colors as you learn them — photograph the can label.",
    },
    documents: {
      table: "documents", singular: "document", addLabel: "Document", sub: "Not the files — a map of where each important document lives and whether it's backed up.",
      columns: [{ key: "name", label: "Document", render: (r) => html`<b>${r.name}</b>` }, { key: "have", label: "Have it?", render: (r) => yesNo(r.have) }, { key: "location", label: "Where it lives", render: (r) => r.location || html`<span class="muted">—</span>` }, { key: "backed_up", label: "Cloud backup", render: (r) => yesNo(r.backed_up) }, { key: "notes", label: "Notes", render: (r) => html`<span class="small muted">${r.notes || ""}</span>` }],
      fields: [{ key: "name", label: "Document", full: true }, { key: "have", label: "Have it", type: "check", checkLabel: "Yes" }, { key: "backed_up", label: "Backed up to cloud", type: "check", checkLabel: "Yes" }, { key: "location", label: "Where it lives (folder / binder / link)", full: true }, { key: "notes", label: "Notes", full: true }],
    },
    inventory: {
      table: "inventory", singular: "item", addLabel: "Item", groupBy: "room", photos: true, sub: "Room-by-room belongings for insurance. Also film a slow phone video of each room and save it to the cloud.",
      columns: [{ key: "item", label: "Item", render: (r) => html`<b>${r.item}</b>` }, { key: "brand_model", label: "Brand / model" }, { key: "serial", label: "Serial" }, { key: "purchase_date", label: "Bought", render: (r) => r.purchase_date ? fmtDate(r.purchase_date) : "" }, { key: "value", label: "Est. value", num: true, render: (r) => money(r.value || 0, { cents: false }) }, { key: "has_photo", label: "Photo / receipt", render: (r) => yesNo(r.has_photo) }],
      fields: [{ key: "room", label: "Room" }, { key: "item", label: "Item" }, { key: "brand_model", label: "Brand / model" }, { key: "serial", label: "Serial #" }, { key: "purchase_date", label: "Purchase date", type: "date" }, { key: "value", label: "Estimated value", type: "money" }, { key: "has_photo", label: "Photo / receipt saved elsewhere", type: "check", checkLabel: "Yes" }, { key: "notes", label: "Notes", full: true }],
      emptyTitle: "No inventory yet", emptyBody: "Start with the expensive things: TVs, computers, furniture, bikes, jewelry.",
    },
    utilities: {
      table: "utilities", singular: "utility", addLabel: "Utility", sub: "Providers, account numbers and typical monthly cost. A water bill that jumps often means a hidden leak. No passwords here.",
      columns: [{ key: "service", label: "Service", render: (r) => html`<b>${r.service}</b>` }, { key: "provider", label: "Provider" }, { key: "account_no", label: "Account #" }, { key: "contact", label: "Phone / login URL" }, { key: "location", label: "Meter / shutoff" }, { key: "typical_monthly", label: "Typical / mo", num: true, render: (r) => r.typical_monthly ? money(r.typical_monthly, { cents: false }) : "" }],
      fields: [{ key: "service", label: "Service" }, { key: "provider", label: "Provider" }, { key: "account_no", label: "Account #" }, { key: "contact", label: "Phone / login URL" }, { key: "location", label: "Meter / shutoff location" }, { key: "typical_monthly", label: "Typical monthly cost", type: "money" }, { key: "notes", label: "Notes", full: true }],
    },
  };
  const totals = { inventory: "value", utilities: "typical_monthly" };
  return html`<div>
    <${PageHead} title="Records" />
    <div class="subnav">${[["emergency", "🚨 Emergency"], ["utilities", "Utilities & accounts"], ["documents", "Documents"], ["finishes", "Paint & finishes"], ["inventory", "Home inventory"]].map(([k, l]) => html`<a class=${view === k ? "active" : ""} href="#" onClick=${(e) => { e.preventDefault(); setView(k); }}>${l}</a>`)}</div>
    <${CrudList} spec=${specs[view]} key=${view} />
    ${totals[view] ? html`<${Total} table=${view} col=${totals[view]} />` : null}
  </div>`;
}
function Total({ table, col }) {
  const q = useAsync(() => api(`/api/t/${table}`), [table]);
  const t = (q.data || []).reduce((s, r) => s + (Number(r[col]) || 0), 0);
  return html`<div class="right strong" style="margin-top:8px">Total ${money(t, { cents: false })}${col === "typical_monthly" ? " / month" : ""}</div>`;
}

// ---- checklists -------------------------------------------------------------------------
function Checklists({ route }) {
  const { boot } = useApp();
  const [list, setList] = useState(route.query.list || (boot.settings.mode === "owner" ? "first30" : "escrow"));
  const q = useAsync(() => api(`/api/t/checklist_items?list=${list}`), [list]);
  const [edit, setEdit] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const toggle = async (r) => { await api(`/api/t/checklist_items/${r.id}`, { method: "PUT", body: { done: r.done ? 0 : 1 } }); q.reload(); };
  const answer = async (r, a) => { await api(`/api/t/checklist_items/${r.id}`, { method: "PUT", body: { answer: a } }); };
  const rows = (q.data || []).filter((r) => showAll || list !== "questions" || !r.applies_to || r.applies_to === "Both" || (boot.settings.home?.build_type === "resale" ? r.applies_to === "Resale" : r.applies_to === "New"));
  const sections = [];
  for (const r of rows) { let s = sections.find((x) => x.name === (r.section || "")); if (!s) { s = { name: r.section || "", rows: [] }; sections.push(s); } s.rows.push(r); }
  const done = rows.filter((r) => r.done).length;
  const resetAll = async () => { if (!confirm("Uncheck everything on this list?")) return; for (const r of rows) if (r.done) await api(`/api/t/checklist_items/${r.id}`, { method: "PUT", body: { done: 0 } }); q.reload(); };
  return html`<div>
    <${PageHead} title="Checklists" sub=${list === "seasonal_spring" || list === "seasonal_fall" ? "Reset it each year. Edit freely once you know your climate." : list === "questions" ? "Tick each as you ask; jot the answer. 'Fills' tells you which page the answer belongs on." : ""}>
      ${list === "questions" ? html`<label class="check small"><input type="checkbox" checked=${showAll} onChange=${(e) => setShowAll(e.target.checked)} /> Show resale + new-build questions</label>` : null}
      <button class="btn sm" onClick=${resetAll}>Reset</button><button class="btn primary sm" onClick=${() => setEdit({})}>+ Item</button>
    <//>
    <div class="subnav">${Object.entries(LISTS).map(([k, l]) => html`<a class=${list === k ? "active" : ""} href="#" onClick=${(e) => { e.preventDefault(); setList(k); }}>${l}</a>`)}</div>
    <div class="row" style="margin-bottom:10px"><div class="grow"><${Bar} value=${rows.length ? done / rows.length : 0} tone="" /></div><span class="small muted">${done} / ${rows.length}</span></div>
    ${q.data ? sections.map((s) => html`
      ${s.name ? html`<h3 style="margin:14px 0 6px">${s.name}</h3>` : null}
      <div class="card pad0"><div class="list">${s.rows.map((r) => html`<div class=${"checkrow" + (r.done ? " done" : "")}>
        <input type="checkbox" checked=${!!r.done} onChange=${() => toggle(r)} />
        <div class="grow">
          <div class="t click" onClick=${() => setEdit(r)}>${r.text}${r.priority ? html` <span class=${"badge " + (r.priority === "High" ? "bad" : r.priority === "Medium" ? "warn" : "")}>${r.priority}</span>` : null}${r.fills ? html` <span class="badge">→ ${r.fills}</span>` : null}</div>
          ${r.detail ? html`<div class="s small muted">${r.detail}</div>` : null}
          ${list === "questions" ? html`<input type="text" style="margin-top:6px;min-height:36px" placeholder="Answer…" value=${r.answer || ""} onChange=${(e) => answer(r, e.target.value)} />` : null}
          ${r.done_on ? html`<div class="tiny muted">done ${fmtDate(r.done_on)}</div>` : null}
        </div>
      </div>`)}</div></div>`) : html`<${Loading} />`}
    ${edit ? html`<${EditSheet} table="checklist_items" title=${edit.id ? "Edit item" : "Add item"} ctx=${{ boot }} row=${edit.id ? edit : null} onClose=${() => setEdit(null)} onSaved=${q.reload}
      fields=${[{ key: "text", label: "Item", full: true }, { key: "list", label: "List", type: "select", options: Object.entries(LISTS), allowEmpty: false, default: list }, { key: "section", label: "Section" }, { key: "detail", label: "What to look for / notes", full: true }, { key: "priority", label: "Priority", type: "select", options: ["High", "Medium", "Low"] }, { key: "sort", label: "Order", type: "number", default: 500 }]} />` : null}
  </div>`;
}

// ---- lifespans reference ---------------------------------------------------------------
function Lifespans() {
  const { boot } = useApp();
  const yb = Number(boot.settings.home?.year_built) || null;
  const spec = {
    table: "lifespans", singular: "row", addLabel: "Row", groupBy: "section",
    sub: yb ? `Typical service intervals and lifespans. Replacement years count from ${yb} (year built in Settings).` : "Typical service intervals and lifespans. Set the year built in Settings to see estimated replacement years.",
    columns: [
      { key: "item", label: "Item", render: (r) => html`<span class=${Number(r.keep) ? "" : "muted"}>${r.item}</span>${r.variant ? html`<div class="tiny muted">${r.variant}</div>` : null}` },
      { key: "care", label: "Routine care" }, { key: "interval", label: "Service" }, { key: "lifespan", label: "Typical life" },
      { key: "plan_years", label: "Replace ~", render: (r) => yb && r.plan_years ? yb + Number(r.plan_years) : (r.plan_years ? `${r.plan_years} yrs` : "") },
      { key: "notes", label: "Notes", render: (r) => html`<span class="small muted">${r.notes || ""}</span>` },
    ],
    fields: [{ key: "section", label: "Section" }, { key: "item", label: "Item" }, { key: "variant", label: "Type / variant" }, { key: "care", label: "Routine care" }, { key: "interval", label: "Service interval" }, { key: "lifespan", label: "Typical lifespan" }, { key: "plan_years", label: "Plan for (years)", type: "number", step: "1" }, { key: "keep", label: "Applies to our house", type: "check", checkLabel: "Yes (uncheck roof / water-heater types you don't have)", default: 1 }, { key: "notes", label: "Notes", type: "textarea", full: true }],
  };
  return html`<div><${PageHead} title="Lifespans & service" /><${CrudList} spec=${spec} /></div>`;
}

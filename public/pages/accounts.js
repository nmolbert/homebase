import { html, useState } from "../vendor/preact-htm.js";
import { api, useApp, toast } from "../app.js";
import { Stat, PageHead, Sheet, money, fmtDate, useAsync, Loading, ErrorBox, EditSheet, Empty } from "../ui.js";

const TYPES = [["checking", "Checking"], ["savings", "Savings / HYSA"], ["credit", "Credit card"], ["investment", "Investment / retirement"], ["loan", "Loan / mortgage"], ["cash", "Cash / other"]];

export default function Accounts() {
  const { boot, reload } = useApp();
  const q = useAsync(() => api("/api/networth"), []);
  const [edit, setEdit] = useState(null);
  const [sf, setSf] = useState(false);
  const [syncing, setSyncing] = useState(false);
  if (q.error) return html`<${ErrorBox} error=${q.error} reload=${q.reload} />`;
  if (!q.data) return html`<${Loading} />`;
  const nw = q.data;
  const status = boot.settings.simplefin_status;
  const refresh = () => { q.reload(); reload(); };
  const sync = async () => {
    setSyncing(true);
    try { const r = await api("/api/simplefin/sync", { method: "POST" }); toast(`Synced: ${r.new_transactions} new transactions${r.errors ? " · " + r.errors : ""}`); refresh(); }
    catch (e) { toast(e.message, true); } finally { setSyncing(false); }
  };
  const groups = [["Joint", nw.accounts.filter((a) => !a.owner_id)], ...boot.people.map((p) => [p.name, nw.accounts.filter((a) => a.owner_id === p.id)])];

  return html`<div>
    <${PageHead} title="Accounts" sub="Joint and individual. Balances update from the bank feed, or type them in.">
      ${boot.simplefin_connected ? html`<button class="btn" disabled=${syncing} onClick=${sync}>${syncing ? "Syncing…" : "Sync now"}</button>` : html`<button class="btn" onClick=${() => setSf(true)}>Connect bank (SimpleFIN)</button>`}
      <button class="btn primary sm" onClick=${() => setEdit({})}>+ Account</button>
    <//>
    <div class="grid c3" style="margin-bottom:14px">
      <${Stat} label="Assets" value=${money(nw.assets, { cents: false })} />
      <${Stat} label="Debts" value=${money(nw.debts, { cents: false })} />
      <${Stat} label="Net" value=${money(nw.net, { cents: false })} tone=${nw.net < 0 ? "bad" : "good"} />
    </div>
    ${boot.simplefin_connected ? html`<div class=${"alert " + (status?.error ? "medium" : "")} style="margin-bottom:14px"><div class="grow"><div class="t">Bank feed ${status?.error ? "needs attention" : "connected"}</div><div class="b">${status?.error ? status.error : status?.last_sync ? `Last sync ${new Date(status.last_sync).toLocaleString()} · ${status.new_transactions} new` : "Syncs every morning at 5am."}</div></div><button class="btn sm" onClick=${() => setSf(true)}>Manage</button></div>` : null}
    ${groups.map(([label, list]) => list.length ? html`<h2 style="margin:16px 0 8px">${label}</h2>
      <div class="card pad0"><div class="list">${list.map((a) => html`<div class="item click" onClick=${() => setEdit(a)}>
        <div class="grow"><div class="t">${a.name} ${a.simplefin_id ? html`<span class="badge ok">bank feed</span>` : null}${a.on_budget ? null : html` <span class="badge">off-budget</span>`}</div><div class="s">${TYPES.find((t) => t[0] === a.type)?.[1] || a.type}${a.institution ? ` · ${a.institution}` : ""}${a.balance_date ? ` · as of ${fmtDate(a.balance_date)}` : ""}</div></div>
        <div class=${"amt " + (["credit", "loan"].includes(a.type) && a.balance ? "bad" : "")}>${money(a.balance)}</div>
      </div>`)}</div></div>` : null)}
    ${nw.accounts.length === 0 ? html`<${Empty} title="No accounts" />` : null}
    ${edit ? html`<${EditSheet} table="accounts" title=${edit.id ? "Edit account" : "Add account"} fields=${FIELDS} ctx=${{ boot }} row=${edit.id ? edit : null} onClose=${() => setEdit(null)} onSaved=${refresh}
      extra=${(v) => v.simplefin_id ? html`<p class="tiny muted" style="margin-top:10px">Balance and transactions come from the bank feed for this account.</p>` : null} />` : null}
    ${sf ? html`<${SimplefinSheet} onClose=${() => setSf(false)} onDone=${refresh} />` : null}
  </div>`;
}
const FIELDS = [
  { key: "name", label: "Name", full: true },
  { key: "type", label: "Type", type: "select", options: TYPES, allowEmpty: false, default: "checking" },
  { key: "owner_id", label: "Owner", type: "select", options: (ctx) => ctx.boot.people.map((p) => [p.id, p.name]), placeholder: "Joint" },
  { key: "institution", label: "Bank" },
  { key: "balance", label: "Balance", type: "money" },
  { key: "balance_date", label: "As of", type: "date" },
  { key: "on_budget", label: "Budget", type: "check", checkLabel: "Spending from here counts in the budget", default: 1 },
  { key: "archived", label: "Archive", type: "check", checkLabel: "Hide this account", default: 0 },
  { key: "notes", label: "Notes", type: "textarea", full: true },
];

function SimplefinSheet({ onClose, onDone }) {
  const { boot } = useApp();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    try { const r = await api("/api/simplefin/connect", { body: { setup_token: token } }); toast(r.sync?.error ? `Connected, but first sync failed: ${r.sync.error}` : `Connected · ${r.sync.accounts} accounts · ${r.sync.new_transactions} transactions`, !!r.sync?.error); onDone(); onClose(); }
    catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  const disconnect = async () => { if (!confirm("Disconnect the bank feed? Existing transactions stay.")) return; await api("/api/simplefin", { method: "DELETE" }); onDone(); onClose(); };
  return html`<${Sheet} title="Bank feed via SimpleFIN" onClose=${onClose} actions=${html`
    ${boot.simplefin_connected ? html`<button class="btn danger left" onClick=${disconnect}>Disconnect</button>` : null}
    <button class="btn" onClick=${onClose}>Close</button>${!boot.simplefin_connected ? html`<button class="btn primary" disabled=${!token || busy} onClick=${connect}>${busy ? "Connecting…" : "Connect"}</button>` : null}`}>
    ${boot.simplefin_connected ? html`<p class="small">Connected. Accounts and transactions refresh every morning; use <b>Sync now</b> on the Accounts page for an immediate pull. To add or remove banks, sign in at <a href="https://bridge.simplefin.org" target="_blank">bridge.simplefin.org</a>; no changes are needed here.</p>`
    : html`<ol class="small" style="padding-left:18px;line-height:1.7">
        <li>Go to <a href="https://bridge.simplefin.org" target="_blank">bridge.simplefin.org</a> and create an account ($15/year).</li>
        <li>Connect each bank there (joint checking, HYSAs, cards, personal accounts).</li>
        <li>Click <b>New App</b> → copy the <b>setup token</b> and paste it below. It can only be used once.</li>
      </ol>
      <textarea placeholder="Paste the setup token" value=${token} onInput=${(e) => setToken(e.target.value)} style="min-height:90px;font-family:monospace;font-size:12px" />
      <p class="tiny muted">Read-only. Home Base never sees your bank login; SimpleFIN only hands over balances and transactions.</p>`}
  <//>`;
}

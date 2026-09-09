import { html, useState, useEffect, useRef } from "../vendor/preact-htm.js";
import { api, useApp, toast, navigate } from "../app.js";
import { PageHead, Sheet, Form, Field, money, fmtDate, thisMonth, monthLabel, shiftMonth, todayStr, useAsync, Loading, ErrorBox, Empty, EditSheet } from "../ui.js";

export default function Transactions({ route }) {
  const { boot, reload } = useApp();
  const [month, setMonth] = useState(route.query.month || thisMonth());
  const [cat, setCat] = useState(route.query.category || "");
  const [acct, setAcct] = useState(route.query.account || "");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [rules, setRules] = useState(false);
  useEffect(() => { if (route.query.category !== undefined) setCat(route.query.category); if (route.query.month) setMonth(route.query.month); }, [route.query.category, route.query.month]);
  const params = new URLSearchParams({ month, ...(cat ? { category: cat } : {}), ...(acct ? { account: acct } : {}), ...(q ? { q } : {}) });
  const list = useAsync(() => api(`/api/transactions?${params}`), [month, cat, acct, q]);
  const refresh = () => { list.reload(); reload(); };
  const rows = list.data || [];
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  const setCategory = async (r, category_id) => {
    try { await api(`/api/t/transactions/${r.id}`, { method: "PUT", body: { category_id } }); refresh(); } catch (e) { toast(e.message, true); }
  };

  return html`<div>
    <${PageHead} title="Transactions" sub="Everything logged, imported or synced. Tap a row to edit; change the category right in the list.">
      <button class="btn" onClick=${() => setImporting(true)}>Import CSV</button>
      <button class="btn" onClick=${() => setRules(true)}>Rules</button>
      <button class="btn primary" onClick=${() => setEditing({})}>+ Add</button>
    <//>
    <div class="row wrap" style="margin-bottom:12px">
      <div class="seg"><button onClick=${() => setMonth(shiftMonth(month, -1))}>‹</button><button class="active">${monthLabel(month)}</button><button onClick=${() => setMonth(shiftMonth(month, 1))}>›</button></div>
      <select style="max-width:220px" value=${cat} onChange=${(e) => setCat(e.target.value)}>
        <option value="">All categories</option><option value="none">Uncategorized</option>
        ${boot.categories.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
      </select>
      <select style="max-width:200px" value=${acct} onChange=${(e) => setAcct(e.target.value)}>
        <option value="">All accounts</option>${boot.accounts.map((a) => html`<option value=${a.id}>${a.name}</option>`)}
      </select>
      <input type="text" style="max-width:200px" placeholder="Search payee…" value=${q} onInput=${(e) => setQ(e.target.value)} />
    </div>
    ${list.error ? html`<${ErrorBox} error=${list.error} reload=${list.reload} />` : !list.data ? html`<${Loading} />` : html`
    <div class="card pad0">
      ${rows.length === 0 ? html`<${Empty} title="No transactions" body="Add one, import a CSV from your bank, or connect SimpleFIN under Accounts." />` : html`
      <div class="tablewrap"><table>
        <thead><tr><th>Date</th><th>Payee</th><th>Category</th><th>Account</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${rows.map((r) => html`<tr>
            <td class="click" onClick=${() => setEditing(r)} style="white-space:nowrap">${fmtDate(r.date, { year: false })}${r.pending ? html` <span class="badge">pending</span>` : null}</td>
            <td class="click" onClick=${() => setEditing(r)}><div class="strong">${r.payee || html`<span class="muted">—</span>`}</div>${r.memo ? html`<div class="tiny muted">${r.memo}</div>` : null}</td>
            <td><select class=${r.category_id ? "" : "warn"} style="min-height:34px;padding:4px 8px;max-width:210px" value=${r.category_id || ""} onChange=${(e) => setCategory(r, e.target.value || null)}>
              <option value="">— uncategorized —</option>${boot.categories.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select></td>
            <td class="muted small">${r.account_name || ""}${r.source === "simplefin" ? " · bank" : r.source === "csv" ? " · csv" : ""}</td>
            <td class=${"num strong " + (r.amount > 0 ? "good" : "")}>${money(r.amount)}</td>
          </tr>`)}
          <tr class="grouphead"><td colspan="4">${rows.length} transactions</td><td class="num">${money(total)}</td></tr>
        </tbody>
      </table></div>`}
    </div>`}
    ${editing ? html`<${QuickAdd} row=${editing.id ? editing : null} onClose=${() => setEditing(null)} onSaved=${refresh} />` : null}
    ${importing ? html`<${ImportSheet} onClose=${() => setImporting(false)} onDone=${refresh} />` : null}
    ${rules ? html`<${RulesSheet} onClose=${() => setRules(false)} onDone=${refresh} />` : null}
  </div>`;
}

// Quick add / edit transaction. Amount typed as positive; "Spent" makes it negative.
export function QuickAdd({ row, onClose, onSaved }) {
  const { boot, who } = useApp();
  const [v, setV] = useState(row ? { ...row, kind: row.amount < 0 ? "out" : "in", amount: Math.abs(row.amount) } : { date: todayStr(), kind: "out", amount: "", payee: "", category_id: "", account_id: boot.accounts[0]?.id || "", person_id: who || "", memo: "" });
  const [busy, setBusy] = useState(false);
  const fields = [
    { key: "kind", label: "Direction", type: "select", options: [["out", "Spent"], ["in", "Received"]], allowEmpty: false },
    { key: "amount", label: "Amount", type: "money" },
    { key: "date", label: "Date", type: "date" },
    { key: "payee", label: "Payee / description" },
    { key: "category_id", label: "Category", type: "select", options: boot.categories.filter((c) => v.kind === "in" ? c.kind !== "expense" : c.kind !== "income").map((c) => [c.id, c.name]), full: true },
    { key: "account_id", label: "Account", type: "select", options: boot.accounts.map((a) => [a.id, a.name]) },
    { key: "person_id", label: "Who", type: "select", options: boot.people.map((p) => [p.id, p.name]) },
    { key: "memo", label: "Memo", full: true },
  ];
  const save = async () => {
    const amount = (v.kind === "out" ? -1 : 1) * Math.abs(Number(v.amount) || 0);
    if (!amount) return toast("Enter an amount.", true);
    setBusy(true);
    try {
      const body = { date: v.date, amount, payee: v.payee, memo: v.memo, category_id: v.category_id || null, account_id: v.account_id || null, person_id: v.person_id || null };
      if (row) await api(`/api/t/transactions/${row.id}`, { method: "PUT", body });
      else await api("/api/transactions", { body: { ...body, dedupe: false } });
      toast(row ? "Saved" : "Added"); onSaved(); onClose();
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  const del = async () => { if (!confirm("Delete this transaction?")) return; await api(`/api/t/transactions/${row.id}`, { method: "DELETE" }); onSaved(); onClose(); };
  return html`<${Sheet} title=${row ? "Edit transaction" : "Add transaction"} onClose=${onClose} actions=${html`
    ${row ? html`<button class="btn danger left" onClick=${del}>Delete</button>` : null}
    <button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy} onClick=${save}>${row ? "Save" : "Add"}</button>`}>
    <${Form} fields=${fields} value=${v} onChange=${setV} />
  <//>`;
}

function ImportSheet({ onClose, onDone }) {
  const { boot } = useApp();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState(null);
  const [cols, setCols] = useState(null);
  const [acct, setAcct] = useState(boot.accounts[0]?.id || "");
  const [flip, setFlip] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const load = async (file) => {
    const text = await file.text();
    setCsv(text);
    try { const p = await api("/api/import/preview", { body: { csv: text } }); setPreview(p); setCols(p.columns); } catch (e) { toast(e.message, true); }
  };
  const commit = async () => {
    setBusy(true);
    try { const r = await api("/api/import/commit", { body: { csv, columns: cols, account_id: acct || null, flip_sign: flip } }); toast(`Imported ${r.inserted} (${r.skipped} duplicates skipped)`); onDone(); onClose(); }
    catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  const colSel = (key, label) => html`<${Field} label=${label}><select value=${cols[key]} onChange=${(e) => setCols({ ...cols, [key]: Number(e.target.value) })}><option value="-1">—</option>${preview.header.map((h, i) => html`<option value=${i}>${h || `column ${i + 1}`}</option>`)}</select><//>`;
  return html`<${Sheet} title="Import bank CSV" onClose=${onClose} actions=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${!preview || busy} onClick=${commit}>Import ${preview ? preview.total : ""} rows</button>`}>
    <p class="small muted">Download a CSV from your bank or card, pick it here, check the column mapping, import. Duplicates (same date, amount, payee) are skipped, so re-importing is safe.</p>
    <input type="file" accept=".csv,text/csv" ref=${fileRef} class="hide" onChange=${(e) => load(e.target.files[0])} />
    <button class="btn" onClick=${() => fileRef.current.click()}>${preview ? "Choose a different file" : "Choose CSV file"}</button>
    ${preview ? html`<div style="margin-top:14px">
      <div class="formgrid">
        ${colSel("date", "Date column")}${colSel("payee", "Payee column")}${colSel("amount", "Amount column (signed)")}${colSel("debit", "Debit column (if separate)")}${colSel("credit", "Credit column (if separate)")}${colSel("memo", "Memo column")}
        <${Field} label="Into account"><select value=${acct} onChange=${(e) => setAcct(e.target.value)}><option value="">—</option>${boot.accounts.map((a) => html`<option value=${a.id}>${a.name}</option>`)}</select><//>
        <${Field} label="Sign"><label class="check"><input type="checkbox" checked=${flip} onChange=${(e) => setFlip(e.target.checked)} /> Flip (spending shows as positive in this file)</label><//>
      </div>
      <div class="tablewrap" style="margin-top:12px"><table><thead><tr>${preview.header.map((h) => html`<th>${h}</th>`)}</tr></thead><tbody>${preview.sample.map((r) => html`<tr>${r.map((c) => html`<td class="small">${c}</td>`)}</tr>`)}</tbody></table></div>
    </div>` : null}
  <//>`;
}

function RulesSheet({ onClose, onDone }) {
  const { boot } = useApp();
  const q = useAsync(() => api("/api/t/category_rules"), []);
  const [pattern, setPattern] = useState("");
  const [cat, setCat] = useState("");
  const add = async () => {
    if (!pattern.trim() || !cat) return;
    await api("/api/t/category_rules", { body: { pattern: pattern.trim(), category_id: cat, sort: (q.data || []).length } });
    setPattern(""); q.reload();
  };
  const del = async (id) => { await api(`/api/t/category_rules/${id}`, { method: "DELETE" }); q.reload(); };
  const apply = async () => { const r = await api("/api/rules/apply", { method: "POST" }); toast(`Categorized ${r.categorized}`); onDone(); };
  const catName = (id) => boot.categories.find((c) => c.id === id)?.name || "?";
  return html`<${Sheet} title="Auto-categorize rules" onClose=${onClose} actions=${html`<button class="btn" onClick=${apply}>Apply to uncategorized</button><button class="btn primary" onClick=${onClose}>Done</button>`}>
    <p class="small muted">If a payee or memo contains the text, the category is set automatically on import and bank sync.</p>
    <div class="row"><input type="text" placeholder="contains… e.g. trader joe" value=${pattern} onInput=${(e) => setPattern(e.target.value)} /><select value=${cat} onChange=${(e) => setCat(e.target.value)}><option value="">Category…</option>${boot.categories.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select><button class="btn" onClick=${add}>Add</button></div>
    <div class="list" style="margin-top:12px">${(q.data || []).map((r) => html`<div class="item"><div class="grow"><span class="strong">“${r.pattern}”</span> <span class="muted">→ ${catName(r.category_id)}</span></div><button class="iconbtn" onClick=${() => del(r.id)}>✕</button></div>`)}
      ${q.data && q.data.length === 0 ? html`<div class="empty">No rules yet.</div>` : null}</div>
  <//>`;
}

// Generic "list of records with an edit sheet" page. Most of the home manual
// is this: vendors, paint & finishes, documents, inventory, utilities…
import { html, useState } from "../vendor/preact-htm.js";
import { api, useApp } from "../app.js";
import { EditSheet, Empty, Photos, useAsync, Loading, ErrorBox } from "../ui.js";

// spec: { table, title, sub, fields, columns: [{key,label,render,num}], groupBy, photos, addLabel, sortRows, extra(row) }
export function CrudList({ spec, filter, header }) {
  const ctx = useApp();
  const { data, loading, error, reload } = useAsync(() => api(`/api/t/${spec.table}`), [spec.table]);
  const [editing, setEditing] = useState(null); // null | {} (new) | row
  if (loading && !data) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} reload=${reload} />`;
  let rows = data || [];
  if (filter) rows = rows.filter(filter);
  if (spec.sortRows) rows = [...rows].sort(spec.sortRows);
  const groups = spec.groupBy ? groupRows(rows, spec.groupBy) : [[null, rows]];
  const cols = spec.columns;
  const cell = (c, r) => c.render ? c.render(r, ctx) : (r[c.key] ?? "");
  return html`<div>
    ${header ? header({ onAdd: () => setEditing({}) }) : html`<div class="between" style="margin-bottom:12px"><div class="muted small">${spec.sub || ""}</div><button class="btn primary sm" onClick=${() => setEditing({})}>+ ${spec.addLabel || "Add"}</button></div>`}
    <div class="card pad0">
      ${rows.length === 0 ? html`<${Empty} title=${spec.emptyTitle || "Nothing here yet"} body=${spec.emptyBody || ""} />` : html`
      <div class="tablewrap"><table>
        <thead><tr>${cols.map((c) => html`<th class=${c.num ? "num" : ""} style=${c.width ? `width:${c.width}` : ""}>${c.label}</th>`)}</tr></thead>
        <tbody>
          ${groups.map(([g, list]) => html`
            ${g !== null ? html`<tr class="grouphead"><td colspan=${cols.length}>${g}</td></tr>` : null}
            ${list.map((r) => html`<tr class="click" onClick=${() => setEditing(r)}>${cols.map((c) => html`<td class=${c.num ? "num" : ""}>${cell(c, r)}</td>`)}</tr>`)}`)}
        </tbody>
      </table></div>`}
    </div>
    ${editing ? html`<${EditSheet} table=${spec.table} title=${editing.id ? (spec.editTitle || `Edit ${spec.singular || "record"}`) : (spec.addTitle || `Add ${spec.singular || "record"}`)}
      fields=${spec.fields} row=${editing.id ? editing : null} ctx=${ctx} onClose=${() => setEditing(null)} onSaved=${() => { reload(); if (spec.onSaved) spec.onSaved(ctx); }}
      extra=${(v) => html`${spec.extra ? spec.extra(v, ctx) : null}${spec.photos && v.id ? html`<div style="margin-top:14px"><div class="field"><label>Photos</label></div><${Photos} entityType=${spec.table} entityId=${v.id} /></div>` : null}`} />` : null}
  </div>`;
}

function groupRows(rows, key) {
  const map = new Map();
  for (const r of rows) { const k = (typeof key === "function" ? key(r) : r[key]) || "Other"; if (!map.has(k)) map.set(k, []); map.get(k).push(r); }
  return [...map.entries()];
}

export const yesNo = (v) => Number(v) ? "Yes" : "—";
export const stars = (n) => n ? "★".repeat(Number(n)) + "☆".repeat(5 - Number(n)) : "";

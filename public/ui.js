// Shared UI pieces and formatting helpers.
import { html, useState, useEffect, useRef, useCallback } from "./vendor/preact-htm.js";
import { api, toast } from "./app.js";

export const money = (n, opts = {}) => {
  const v = Number(n) || 0;
  const cents = opts.cents ?? Math.abs(v) < 1000;
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return (v < 0 ? "−$" : "$") + s;
};
export const pct = (x) => `${Math.round((Number(x) || 0) * 100)}%`;
export const fmtDate = (d, o = {}) => {
  if (!d) return "";
  const dt = new Date(String(d).slice(0, 10) + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(o.year !== false ? { year: "numeric" } : {}) });
};
export const monthLabel = (m) => new Date(m + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
export const thisMonth = () => new Date().toISOString().slice(0, 7);
export const shiftMonth = (m, n) => { const [y, mm] = m.split("-").map(Number); const d = new Date(y, mm - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
export const todayStr = () => new Date().toLocaleDateString("en-CA");

export function useAsync(fn, deps = []) {
  const [state, set] = useState({ loading: true, data: null, error: null });
  const run = useCallback(async () => {
    set((s) => ({ ...s, loading: true }));
    try { set({ loading: false, data: await fn(), error: null }); }
    catch (e) { set({ loading: false, data: null, error: e.message }); }
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export const Stat = ({ label, value, foot, tone, small }) => html`<div class="card stat">
  <div class="lbl">${label}</div><div class=${"val" + (small ? " sm" : "") + (tone ? " " + tone : "")}>${value}</div>${foot ? html`<div class="foot">${foot}</div>` : null}
</div>`;

export const Bar = ({ value, tone }) => {
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  const t = tone || (v >= 1 ? "bad" : v >= 0.85 ? "warn" : "");
  return html`<div class="bar"><i class=${t} style=${`width:${v * 100}%`}></i></div>`;
};

export const Empty = ({ title, body, children }) => html`<div class="empty"><b>${title}</b>${body}${children}</div>`;

export const Seg = ({ options, value, onChange }) => html`<div class="seg">${options.map(([v, l]) => html`<button class=${v === value ? "active" : ""} onClick=${() => onChange(v)}>${l}</button>`)}</div>`;

export function Sheet({ title, onClose, children, actions }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, []);
  return html`<div class="overlay" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="sheet" role="dialog">
      <div class="between"><h2>${title}</h2><button class="iconbtn" onClick=${onClose} aria-label="Close">✕</button></div>
      ${children}
      ${actions ? html`<div class="actions">${actions}</div>` : null}
    </div>
  </div>`;
}

export const Field = ({ label, hint, children, full }) => html`<div class=${"field" + (full ? " full" : "")}>${label ? html`<label>${label}</label>` : null}${children}${hint ? html`<div class="hint">${hint}</div>` : null}</div>`;

// Generic form from a field spec: [{ key, label, type, options, hint, full, placeholder, step }]
export function Form({ fields, value, onChange, ctx }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return html`<div class="formgrid">${fields.filter((f) => !f.hidden || !f.hidden(value)).map((f) => {
    const v = value[f.key] ?? "";
    const type = f.type || "text";
    let input;
    if (type === "select") {
      const opts = typeof f.options === "function" ? f.options(ctx, value) : f.options;
      input = html`<select value=${v ?? ""} onChange=${(e) => set(f.key, e.target.value)}>
        ${f.allowEmpty !== false ? html`<option value="">${f.placeholder || "—"}</option>` : null}
        ${opts.map((o) => Array.isArray(o) ? html`<option value=${o[0]}>${o[1]}</option>` : html`<option value=${o}>${o}</option>`)}
      </select>`;
    } else if (type === "textarea") input = html`<textarea value=${v} placeholder=${f.placeholder || ""} onInput=${(e) => set(f.key, e.target.value)} />`;
    else if (type === "check") input = html`<label class="check"><input type="checkbox" checked=${!!Number(v)} onChange=${(e) => set(f.key, e.target.checked ? 1 : 0)} /> ${f.checkLabel || "Yes"}</label>`;
    else if (type === "money" || type === "number" || type === "percent") {
      input = html`<input type="number" inputmode="decimal" step=${f.step || (type === "percent" ? "0.5" : "0.01")} value=${type === "percent" ? (v === "" ? "" : Math.round(Number(v) * 1000) / 10) : v}
        placeholder=${f.placeholder || (type === "money" ? "0.00" : "")} onInput=${(e) => set(f.key, e.target.value === "" ? "" : (type === "percent" ? Number(e.target.value) / 100 : Number(e.target.value)))} />`;
    } else input = html`<input type=${type} value=${v} placeholder=${f.placeholder || ""} onInput=${(e) => set(f.key, e.target.value)} />`;
    return html`<${Field} key=${f.key} label=${f.label} hint=${f.hint} full=${f.full}>${input}<//>`;
  })}</div>`;
}

// Edit-or-create sheet backed by /api/t/<table>.
export function EditSheet({ table, title, fields, row, onClose, onSaved, ctx, extra, deletable = true }) {
  const [value, setValue] = useState(row ? { ...row } : Object.fromEntries(fields.filter((f) => f.default !== undefined).map((f) => [f.key, typeof f.default === "function" ? f.default(ctx) : f.default])));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const saved = row?.id ? await api(`/api/t/${table}/${row.id}`, { method: "PUT", body: value }) : await api(`/api/t/${table}`, { body: value });
      toast("Saved"); onSaved(saved); onClose();
    } catch (e) { toast(e.message, true); }
    finally { setBusy(false); }
  };
  const del = async () => {
    if (!confirm("Delete this? This cannot be undone.")) return;
    try { await api(`/api/t/${table}/${row.id}`, { method: "DELETE" }); toast("Deleted"); onSaved(null); onClose(); } catch (e) { toast(e.message, true); }
  };
  return html`<${Sheet} title=${title} onClose=${onClose} actions=${html`
    ${row?.id && deletable ? html`<button class="btn danger left" onClick=${del}>Delete</button>` : null}
    <button class="btn" onClick=${onClose}>Cancel</button>
    <button class="btn primary" disabled=${busy} onClick=${save}>${row?.id ? "Save" : "Add"}</button>`}>
    <${Form} fields=${fields} value=${value} onChange=${setValue} ctx=${ctx} />
    ${extra ? extra(value, setValue) : null}
  <//>`;
}

// Photos attached to any record. Resized on-device before upload.
export function Photos({ entityType, entityId }) {
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const load = () => api(`/api/photos?entity_type=${entityType}&entity_id=${entityId}`).then(setList).catch(() => {});
  useEffect(() => { if (entityId) load(); }, [entityId]);
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const data = await resizeImage(file, 1400, 0.82);
      await api("/api/photos", { body: { entity_type: entityType, entity_id: entityId, mime: "image/jpeg", data } });
      await load(); toast("Photo added");
    } catch (e) { toast(e.message, true); }
    finally { setBusy(false); }
  };
  const del = async (id) => { if (!confirm("Remove this photo?")) return; await api(`/api/photos/${id}`, { method: "DELETE" }); load(); };
  if (!entityId) return html`<div class="muted small">Save first, then add photos.</div>`;
  return html`<div>
    <div class="photos">
      ${list.map((p) => html`<a href=${`/api/photos/${p.id}`} target="_blank" onContextMenu=${(e) => { e.preventDefault(); del(p.id); }}><img src=${`/api/photos/${p.id}`} alt=${p.caption || ""} /></a>`)}
    </div>
    <div class="row" style="margin-top:8px">
      <input type="file" accept="image/*" ref=${fileRef} class="hide" onChange=${(e) => upload(e.target.files[0])} />
      <button class="btn sm" disabled=${busy} onClick=${() => fileRef.current.click()}>${busy ? "Uploading…" : "📷 Add photo"}</button>
      ${list.length ? html`<span class="tiny muted">Tap to open · right-click / long-press to remove</span>` : html`<span class="tiny muted">Serial plates, receipts, labels.</span>`}
    </div>
  </div>`;
}
function resizeImage(file, max, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", quality).split(",")[1]);
    };
    img.onerror = () => reject(new Error("Could not read that image."));
    img.src = url;
  });
}

export const PageHead = ({ title, sub, children }) => html`<div class="pagehead"><div><h1>${title}</h1>${sub ? html`<div class="sub">${sub}</div>` : null}</div><div class="row wrap">${children}</div></div>`;

export const SubNav = ({ items, active }) => html`<div class="subnav">${items.map(([key, label, href]) => html`<a class=${key === active ? "active" : ""} href=${href}>${label}</a>`)}</div>`;

export const Loading = () => html`<div class="boot">Loading…</div>`;
export const ErrorBox = ({ error, reload }) => html`<div class="card"><div class="bad">${error}</div>${reload ? html`<button class="btn sm" style="margin-top:8px" onClick=${reload}>Retry</button>` : null}</div>`;

export function dateInput(value, onChange) { return html`<input type="date" value=${value || ""} onInput=${(e) => onChange(e.target.value)} />`; }

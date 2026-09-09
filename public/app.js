// Home Base — app shell: API client, router, login, navigation.
import { html, render, useState, useEffect, useCallback, useMemo, createContext, useContext } from "./vendor/preact-htm.js";

// ---- API client ---------------------------------------------------------------
let onUnauthorized = () => {};
export async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body ? "POST" : "GET"), credentials: "same-origin", headers: {} };
  if (opts.body !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(opts.body); }
  const res = await fetch(path, init);
  if (res.status === 401 && !path.startsWith("/api/auth") && path !== "/api/status") onUnauthorized();
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}
export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// ---- routing ------------------------------------------------------------------
function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [pathPart, query = ""] = h.split("?");
  const parts = pathPart.split("/").filter(Boolean);
  return { parts, section: parts[0] || "", sub: parts[1] || "", id: parts[2] || "", query: Object.fromEntries(new URLSearchParams(query)) };
}
export function navigate(hash) { location.hash = hash.startsWith("#") ? hash : "#/" + hash.replace(/^\//, ""); }

const PAGES = {
  "": () => import("./pages/dashboard.js"),
  budget: () => import("./pages/budget.js"),
  home: () => import("./pages/home.js"),
  settings: () => import("./pages/settings.js"),
};

const NAV = [
  { sec: "", label: "Overview", icon: "🏡", href: "#/" },
  { head: "Money" },
  { sec: "budget", sub: "", label: "Budget", icon: "💵", href: "#/budget" },
  { sec: "budget", sub: "transactions", label: "Transactions", href: "#/budget/transactions" },
  { sec: "budget", sub: "paycheck", label: "Paycheck plan", href: "#/budget/paycheck" },
  { sec: "budget", sub: "accounts", label: "Accounts", href: "#/budget/accounts" },
  { sec: "budget", sub: "goals", label: "Goals", href: "#/budget/goals" },
  { sec: "budget", sub: "year", label: "Year view", href: "#/budget/year" },
  { head: "House" },
  { sec: "home", sub: "", label: "House", icon: "🏠", href: "#/home" },
  { sec: "home", sub: "maintenance", label: "Maintenance", href: "#/home/maintenance" },
  { sec: "home", sub: "systems", label: "Systems & appliances", href: "#/home/systems" },
  { sec: "home", sub: "warranties", label: "Warranties", href: "#/home/warranties" },
  { sec: "home", sub: "projects", label: "Projects", href: "#/home/projects" },
  { sec: "home", sub: "vendors", label: "Vendors", href: "#/home/vendors" },
  { sec: "home", sub: "records", label: "Records", href: "#/home/records" },
  { sec: "home", sub: "checklists", label: "Checklists", href: "#/home/checklists" },
  { sec: "home", sub: "lifespans", label: "Lifespans", href: "#/home/lifespans" },
  { head: "" },
  { sec: "settings", sub: "", label: "Settings", icon: "⚙️", href: "#/settings" },
];

// ---- toast ----------------------------------------------------------------------
let setToastGlobal = () => {};
export function toast(msg, isErr = false) { setToastGlobal({ msg, isErr, id: Date.now() }); }

// ---- root -----------------------------------------------------------------------
function App() {
  const [status, setStatus] = useState(null);
  const [boot, setBoot] = useState(null);
  const [route, setRoute] = useState(parseHash());
  const [Page, setPage] = useState(null);
  const [tst, setTst] = useState(null);
  const [who, setWhoState] = useState(localStorage.getItem("hb_who") || "");
  setToastGlobal = setTst;

  const loadStatus = useCallback(async () => {
    try { setStatus(await api("/api/status")); } catch (e) { setStatus({ error: e.message }); }
  }, []);
  const reload = useCallback(async () => {
    try { setBoot(await api("/api/bootstrap")); } catch (e) { if (!/signed in/.test(e.message)) toast(e.message, true); }
  }, []);
  useEffect(() => { loadStatus(); }, []);
  useEffect(() => { onUnauthorized = () => { setBoot(null); setStatus((s) => ({ ...(s || {}), authed: false })); }; }, []);
  useEffect(() => { if (status?.authed && !boot) reload(); }, [status]);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    const loader = PAGES[route.section] || PAGES[""];
    let alive = true;
    loader().then((m) => { if (alive) setPage(() => m.default); });
    scrollTo(0, 0);
    return () => { alive = false; };
  }, [route.section]);
  useEffect(() => { if (tst) { const t = setTimeout(() => setTst(null), 3200); return () => clearTimeout(t); } }, [tst]);
  useEffect(() => {
    // Refresh bootstrap when the app comes back to the foreground.
    const onVis = () => { if (document.visibilityState === "visible" && boot) reload(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [boot]);

  const setWho = (id) => { localStorage.setItem("hb_who", id); setWhoState(id); };
  const ctx = useMemo(() => ({ boot, reload, route, who, setWho, api, toast, navigate, status, loadStatus }), [boot, route, who, status]);

  const toastEl = tst ? html`<div class=${"toast" + (tst.isErr ? " err" : "")} key=${tst.id}>${tst.msg}</div>` : null;
  if (!status) return html`<div class="boot">Loading Home Base…</div>`;
  if (status.error) return html`<div class="boot">Could not reach Home Base: ${status.error} <br/><button class="btn" style="margin-top:12px" onClick=${loadStatus}>Retry</button></div>`;
  if (!status.setup_done) return html`<${AppCtx.Provider} value=${ctx}><${Setup} onDone=${async () => { await loadStatus(); }} />${toastEl}<//>`;
  if (!status.authed) return html`<${AppCtx.Provider} value=${ctx}><${Login} onDone=${async () => { await loadStatus(); }} />${toastEl}<//>`;
  if (!boot) return html`<div class="boot">Opening…</div>`;

  const alertsHigh = (boot.alerts || []).filter((a) => a.severity !== "low").length;
  return html`<${AppCtx.Provider} value=${ctx}>
    <div class="shell">
      <aside class="side">
        <a class="brand" href="#/"><img src="/icons/icon.svg" alt="" /><b>${boot.settings.household_name || "Home Base"}</b></a>
        ${NAV.map((n) => n.head !== undefined
          ? html`<div class="navsec">${n.head}</div>`
          : html`<a class=${"navlink" + (isActive(route, n) ? " active" : "")} href=${n.href}>${n.icon ? html`<span>${n.icon}</span>` : html`<span style="width:18px"></span>`}${n.label}${n.sec === "" && alertsHigh ? html`<span class="dot">${alertsHigh}</span>` : null}</a>`)}
        <div class="navsec">Who's using this</div>
        <div class="seg" style="margin:0 8px">${boot.people.map((p) => html`<button class=${who === p.id ? "active" : ""} onClick=${() => setWho(p.id)}>${p.name}</button>`)}</div>
      </aside>
      <main class="main">${Page ? html`<${Page} route=${route} />` : html`<div class="boot">Loading…</div>`}</main>
    </div>
    <nav class="tabbar">
      ${[["", "🏡", "Overview", "#/"], ["budget", "💵", "Budget", "#/budget"], ["home", "🏠", "House", "#/home"], ["settings", "⚙️", "Settings", "#/settings"]].map(([sec, ic, label, href]) =>
        html`<a class=${"tab" + (route.section === sec ? " active" : "")} href=${href}><span class="ic">${ic}</span>${label}${sec === "" && alertsHigh ? html`<span class="dot"></span>` : null}</a>`)}
    </nav>
    ${toastEl}
  <//>`;
}
function isActive(route, n) {
  if (n.sec !== route.section) return false;
  if (n.sub === undefined) return true;
  return n.sub === (route.sub || "");
}

// ---- login & setup ---------------------------------------------------------------
function Keypad({ pin, setPin, onSubmit }) {
  const press = (k) => {
    if (k === "⌫") return setPin((p) => p.slice(0, -1));
    if (k === "OK") return onSubmit();
    setPin((p) => (p.length < 8 ? p + k : p));
  };
  useEffect(() => {
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("⌫");
      else if (e.key === "Enter") press("OK");
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  return html`<div>
    <div class="pin">${Array.from({ length: Math.max(4, pin.length) }, (_, i) => html`<i class=${i < pin.length ? "on" : ""}></i>`)}</div>
    <div class="keypad">${["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"].map((k) => html`<button onClick=${() => press(k)}>${k}</button>`)}</div>
  </div>`;
}

function Login({ onDone }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (pin.length < 4 || busy) return;
    setBusy(true); setErr("");
    try { await api("/api/auth/login", { body: { pin } }); await onDone(); }
    catch (e) { setErr(e.message); setPin(""); }
    finally { setBusy(false); }
  };
  return html`<div class="login"><div class="card">
    <img src="/icons/icon.svg" alt="" />
    <h1>Home Base</h1>
    <div class="muted small">Enter the household PIN</div>
    <${Keypad} pin=${pin} setPin=${setPin} onSubmit=${submit} />
    ${err ? html`<div class="bad small" style="margin-top:10px">${err}</div>` : null}
  </div></div>`;
}

function Setup({ onDone }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [step, setStep] = useState(0);
  const [emails, setEmails] = useState({ Nick: "nicholasmolbert@gmail.com", Alex: "" });
  const [err, setErr] = useState("");
  const submit = async () => {
    if (step === 0) { if (pin.length < 4) return setErr("Use at least 4 digits."); setErr(""); return setStep(1); }
    if (step === 1) { if (confirm !== pin) { setConfirm(""); return setErr("PINs don't match — try again."); } setErr(""); return setStep(2); }
    try {
      // People rows exist after the server seeds; fetch them via setup response ordering: seed happens on first API call.
      await api("/api/auth/setup", { body: { pin, household_name: "Home Base" } });
      const b = await api("/api/bootstrap");
      for (const p of b.people) if (emails[p.name] !== undefined) await api(`/api/t/people/${p.id}`, { method: "PUT", body: { email: emails[p.name] } });
      await onDone();
    } catch (e) { setErr(e.message); }
  };
  return html`<div class="login"><div class="card">
    <img src="/icons/icon.svg" alt="" />
    <h1>Welcome to Home Base</h1>
    ${step < 2 ? html`
      <div class="muted small">${step === 0 ? "Choose a shared PIN (4–8 digits). You and Alex will both use it." : "Enter it once more to confirm."}</div>
      <${Keypad} pin=${step === 0 ? pin : confirm} setPin=${step === 0 ? setPin : setConfirm} onSubmit=${submit} />`
    : html`
      <div class="muted small" style="margin-bottom:12px">Email addresses for reminders (optional — you can add these later in Settings).</div>
      <div class="stack" style="text-align:left">
        ${Object.keys(emails).map((n) => html`<div class="field"><label>${n}</label><input type="email" value=${emails[n]} onInput=${(e) => setEmails({ ...emails, [n]: e.target.value })} placeholder="name@example.com" /></div>`)}
        <button class="btn primary block" onClick=${submit}>Open Home Base</button>
      </div>`}
    ${err ? html`<div class="bad small" style="margin-top:10px">${err}</div>` : null}
  </div></div>`;
}

render(html`<${App} />`, document.getElementById("app"));

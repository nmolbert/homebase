import { html, useState, useEffect } from "../vendor/preact-htm.js";
import { api, useApp, toast } from "../app.js";
import { PageHead, Field, Sheet, useAsync, fmtDate } from "../ui.js";

export default function Settings() {
  const { boot, reload, who, setWho } = useApp();
  const s = boot.settings;
  const [home, setHome] = useState({ ...(s.home || {}) });
  const [notify, setNotify] = useState({ ...(s.notify || {}) });
  const [name, setName] = useState(s.household_name || "Home Base");
  const [tz, setTz] = useState(s.timezone || "America/Los_Angeles");
  const [mode, setMode] = useState(s.mode || "prepurchase");
  const [people, setPeople] = useState(boot.people.map((p) => ({ ...p })));
  const [pin, setPin] = useState(null);
  const [pushState, setPushState] = useState("checking");
  const [busy, setBusy] = useState("");
  const [log, setLog] = useState(null);

  useEffect(() => { checkPush().then(setPushState); }, []);

  const save = async () => {
    setBusy("save");
    try {
      await api("/api/settings", { method: "PUT", body: { household_name: name, timezone: tz, mode, home, notify } });
      for (const p of people) await api(`/api/t/people/${p.id}`, { method: "PUT", body: { name: p.name, email: p.email || "" } });
      await reload(); toast("Saved");
    } catch (e) { toast(e.message, true); } finally { setBusy(""); }
  };
  const run = async (label, fn) => { setBusy(label); try { await fn(); } catch (e) { toast(e.message, true); } finally { setBusy(""); } };

  return html`<div>
    <${PageHead} title="Settings"><button class="btn primary" disabled=${busy === "save"} onClick=${save}>Save changes</button><//>
    <div class="grid c2">
      <div class="card">
        <h2>Household</h2>
        <div class="stack">
          <${Field} label="Name"><input type="text" value=${name} onInput=${(e) => setName(e.target.value)} /><//>
          ${people.map((p, i) => html`<div class="formgrid"><${Field} label="Person"><input type="text" value=${p.name} onInput=${(e) => setPeople(people.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /><//><${Field} label="Email for reminders"><input type="email" value=${p.email || ""} onInput=${(e) => setPeople(people.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} /><//></div>`)}
          <${Field} label="This device belongs to" hint="Used to attribute things you log."><select value=${who} onChange=${(e) => setWho(e.target.value)}><option value="">—</option>${boot.people.map((p) => html`<option value=${p.id}>${p.name}</option>`)}</select><//>
          <${Field} label="Time zone"><select value=${tz} onChange=${(e) => setTz(e.target.value)}>${["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Phoenix"].map((z) => html`<option value=${z}>${z}</option>`)}</select><//>
        </div>
      </div>

      <div class="card">
        <h2>The house</h2>
        <div class="stack">
          <${Field} label="Stage"><select value=${mode} onChange=${(e) => setMode(e.target.value)}><option value="prepurchase">Still looking / in escrow</option><option value="owner">We own it — turn on maintenance reminders</option></select><//>
          <div class="formgrid">
            <${Field} label="Address" full><input type="text" value=${home.address || ""} onInput=${(e) => setHome({ ...home, address: e.target.value })} /><//>
            <${Field} label="Close date" hint="Starts the warranty clocks and the 11-month walkthrough"><input type="date" value=${home.close_date || ""} onInput=${(e) => setHome({ ...home, close_date: e.target.value })} /><//>
            <${Field} label="Purchase price"><input type="number" value=${home.purchase_price || ""} onInput=${(e) => setHome({ ...home, purchase_price: e.target.value })} /><//>
            <${Field} label="Year built" hint="Used for replacement forecasts"><input type="number" value=${home.year_built || ""} onInput=${(e) => setHome({ ...home, year_built: e.target.value })} /><//>
            <${Field} label="Square feet"><input type="text" value=${home.sqft || ""} onInput=${(e) => setHome({ ...home, sqft: e.target.value })} /><//>
            <${Field} label="Beds / baths"><input type="text" value=${home.beds_baths || ""} onInput=${(e) => setHome({ ...home, beds_baths: e.target.value })} /><//>
            <${Field} label="New build or resale"><select value=${home.build_type || "new"} onChange=${(e) => setHome({ ...home, build_type: e.target.value })}><option value="new">New build</option><option value="resale">Resale</option></select><//>
          </div>
          <${Field} label="Climate / location notes" hint="The seasonal checklists assume a mild, freeze-free climate until you edit them."><textarea value=${home.climate_note || ""} onInput=${(e) => setHome({ ...home, climate_note: e.target.value })} /><//>
        </div>
      </div>

      <div class="card">
        <h2>Reminders</h2>
        <div class="stack">
          <div class="formgrid">
            <${Field} label="Daily reminder hour"><select value=${notify.daily_hour ?? 8} onChange=${(e) => setNotify({ ...notify, daily_hour: Number(e.target.value) })}>${Array.from({ length: 24 }, (_, h) => html`<option value=${h}>${hourLabel(h)}</option>`)}</select><//>
            <${Field} label="Weekly digest"><div class="row"><select value=${notify.digest_day ?? 0} onChange=${(e) => setNotify({ ...notify, digest_day: Number(e.target.value) })}>${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => html`<option value=${i}>${d}</option>`)}</select><select value=${notify.digest_hour ?? 8} onChange=${(e) => setNotify({ ...notify, digest_hour: Number(e.target.value) })}>${Array.from({ length: 24 }, (_, h) => html`<option value=${h}>${hourLabel(h)}</option>`)}</select></div><//>
            <${Field} label="Warranty warning" hint="Days before expiry"><input type="number" value=${notify.warranty_days ?? 90} onInput=${(e) => setNotify({ ...notify, warranty_days: Number(e.target.value) })} /><//>
            <${Field} label="Channels"><label class="check"><input type="checkbox" checked=${notify.push !== false} onChange=${(e) => setNotify({ ...notify, push: e.target.checked })} /> Push</label><label class="check"><input type="checkbox" checked=${notify.email !== false} onChange=${(e) => setNotify({ ...notify, email: e.target.checked })} /> Email</label><label class="check"><input type="checkbox" checked=${notify.budget_alerts !== false} onChange=${(e) => setNotify({ ...notify, budget_alerts: e.target.checked })} /> Budget alerts</label><//>
          </div>
          <div class="card soft">
            <h3>Push notifications on this device</h3>
            ${pushState === "unsupported" ? html`<p class="small muted">Not available here. On iPhone: open this site in Safari → Share → <b>Add to Home Screen</b>, then open Home Base from the home screen and come back to this page.</p>`
            : pushState === "denied" ? html`<p class="small bad">Blocked in the browser settings for this site.</p>`
            : pushState === "subscribed" ? html`<div class="row wrap"><span class="badge ok">On</span><button class="btn sm" onClick=${() => run("push", async () => { const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); const r = await api("/api/push/test", { body: { endpoint: sub.endpoint } }); toast(r.ok ? "Test sent" : `Failed (${r.status || r.error})`, !r.ok); })}>Send test</button><button class="btn sm" onClick=${() => run("push", async () => { await unsubscribePush(); setPushState(await checkPush()); reload(); })}>Turn off</button></div>`
            : html`<button class="btn primary sm" disabled=${busy === "push"} onClick=${() => run("push", async () => { await subscribePush(boot, who, people); setPushState(await checkPush()); reload(); toast("Push enabled on this device"); })}>Turn on push here</button>`}
            ${boot.push_subscriptions.length ? html`<div class="list" style="margin-top:10px">${boot.push_subscriptions.map((p) => html`<div class="item"><div class="grow small">${p.label}${p.failures ? html` <span class="badge warn">${p.failures} failures</span>` : null}<div class="tiny muted">added ${fmtDate(p.created_at)}</div></div><button class="iconbtn" title="Remove" onClick=${() => run("rm", async () => { await api(`/api/push/${p.id}`, { method: "DELETE" }); reload(); })}>✕</button></div>`)}</div>` : html`<p class="tiny muted" style="margin-top:8px">No devices subscribed yet.</p>`}
          </div>
          <div class="card soft">
            <h3>Email</h3>
            ${boot.email_configured ? html`<div class="row wrap"><span class="badge ok">Configured</span><button class="btn sm" onClick=${() => run("email", async () => { const r = await api("/api/email/test", { method: "POST" }); toast(r.ok ? "Test email sent" : `Email failed: ${r.body || r.reason}`, !r.ok); })}>Send test</button></div>`
            : html`<p class="small muted">Not set up yet. Add a <code>RESEND_API_KEY</code> secret to the Worker in Cloudflare and emails switch on; push notifications work without it.</p>`}
          </div>
          <div class="card soft">
            <h3>Calendar feed</h3>
            <p class="small muted">Subscribe once and every maintenance date, warranty expiry and goal date appears in your calendar. <b>Apple Calendar:</b> File → New Calendar Subscription. <b>Google Calendar:</b> Other calendars → + → From URL.</p>
            <code>${boot.ics_url}</code>
            <div class="row wrap" style="margin-top:8px"><button class="btn sm" onClick=${() => { navigator.clipboard?.writeText(boot.ics_url); toast("Copied"); }}>Copy link</button><a class="btn sm" href=${boot.ics_url.replace(/^https?:/, "webcal:")}>Open in Apple Calendar</a><button class="btn sm ghost" onClick=${() => run("rot", async () => { if (!confirm("Old subscriptions will stop working. Continue?")) return; await api("/api/calendar/rotate", { method: "POST" }); reload(); })}>Reset link</button></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Security & data</h2>
        <div class="stack">
          <div class="row wrap"><button class="btn" onClick=${() => setPin({})}>Change PIN</button><button class="btn" onClick=${() => run("out", async () => { await api("/api/auth/logout", { method: "POST" }); location.reload(); })}>Sign out on this device</button></div>
          <div class="row wrap"><a class="btn" href="/api/export" download>Download backup (JSON)</a><button class="btn" onClick=${() => run("cron", async () => { const r = await api("/api/notify/run", { body: { daily: true } }); toast(`Reminder check ran · ${r.daily ?? 0} sent`); setLog(await api("/api/notifications")); })}>Run reminder check now</button><button class="btn ghost sm" onClick=${() => run("log", async () => setLog(await api("/api/notifications")))}>Show sent log</button></div>
          ${s.last_cron ? html`<div class="tiny muted">Last automatic check: ${new Date(s.last_cron.at).toLocaleString()}</div>` : null}
          ${log ? html`<div class="list card pad0" style="max-height:260px;overflow:auto">${log.length ? log.map((n) => html`<div class="item"><div class="grow small"><b>${n.title || n.kind}</b> <span class="muted">· ${n.channel}</span><div class="tiny muted">${new Date(n.sent_at).toLocaleString()}</div></div></div>`) : html`<div class="empty">Nothing sent yet.</div>`}</div>` : null}
        </div>
      </div>
    </div>
    ${pin ? html`<${PinSheet} onClose=${() => setPin(null)} />` : null}
  </div>`;
}
const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;

function PinSheet({ onClose }) {
  const [v, setV] = useState({ current: "", next: "", again: "" });
  const save = async () => {
    if (v.next !== v.again) return toast("New PINs don't match.", true);
    try { await api("/api/auth/change-pin", { body: { current: v.current, next: v.next } }); toast("PIN changed — other devices will need to sign in again."); onClose(); } catch (e) { toast(e.message, true); }
  };
  return html`<${Sheet} title="Change PIN" onClose=${onClose} actions=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${save}>Change</button>`}>
    <div class="stack">${[["current", "Current PIN"], ["next", "New PIN (4–8 digits)"], ["again", "New PIN again"]].map(([k, l]) => html`<${Field} label=${l}><input type="password" inputmode="numeric" value=${v[k]} onInput=${(e) => setV({ ...v, [k]: e.target.value })} /><//>`)}</div>
  <//>`;
}

// ---- push helpers ---------------------------------------------------------------
async function checkPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); return sub ? "subscribed" : "off"; } catch { return "off"; }
}
function urlB64ToU8(s) { const pad = "=".repeat((4 - (s.length % 4)) % 4); const b = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
async function subscribePush(boot, who, people) {
  const perm = await Notification.requestPermission();
  if (perm === "denied") throw new Error("Notifications are blocked for this site in the browser's settings. Allow them there, reload, and try again.");
  if (perm !== "granted") throw new Error("The permission prompt was dismissed. Tap the button again and choose Allow.");
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(boot.vapid_public) });
  const person = people.find((p) => p.id === who);
  const label = `${person ? person.name + "’s " : ""}${/iPhone/.test(navigator.userAgent) ? "iPhone" : /iPad/.test(navigator.userAgent) ? "iPad" : /Android/.test(navigator.userAgent) ? "Android" : /Mac/.test(navigator.userAgent) ? "Mac" : "device"}`;
  await api("/api/push/subscribe", { body: { subscription: sub.toJSON(), label, person_id: who || null } });
}
async function unsubscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await api("/api/push/unsubscribe", { body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}

// The API. Runs inside the Durable Object in production and inside the Deno
// harness locally; both hand it a Db and an env.
import { allSettings, Db, getSetting, insertRow, SECRET_SETTINGS, setSetting, uid, updateRow } from "./db.ts";
import { seedIfEmpty } from "./seed.ts";
import {
  checkSession, clearCookie, clearPinFailures, cookieValue, ensureSecret, hashPin, lockoutState, makeSession,
  recordPinFailure, sessionCookie, verifyPin,
} from "./logic/auth.ts";
import { applyRules, budgetForMonth, dedupeHash, goalsWithProgress, netWorth, paycheckPlan, yearGrid } from "./logic/money.ts";
import { computeAlerts, costBasis, replacementForecast, taskViews, walkthroughDeadline, warrantyViews } from "./logic/home.ts";
import { buildIcs } from "./logic/ics.ts";
import { ensureVapid, pushAll, sendPush } from "./logic/push.ts";
import { claimSetupToken, syncSimplefin } from "./logic/simplefin.ts";
import { EmailEnv, emailConfigured, renderDigest, sendEmail } from "./logic/email.ts";
import { runCron } from "./logic/notify.ts";
import { guessColumns, parseAmount, parseCsv, parseDate } from "./logic/csv.ts";

export interface ApiEnv extends EmailEnv { DEV?: string }

// Tables the generic CRUD endpoints may touch, and the columns they may write.
const TABLES: Record<string, string[]> = {
  people: ["name", "email", "color", "sort"],
  accounts: ["name", "type", "owner_id", "institution", "balance", "balance_date", "on_budget", "archived", "notes", "sort"],
  income_sources: ["person_id", "name", "kind", "gross_annual", "tax_rate", "deferrals", "active", "notes", "sort"],
  allocations: ["name", "kind", "amount", "account_id", "category_id", "notes", "sort"],
  categories: ["group_name", "name", "kind", "monthly_budget", "home_link", "archived", "sort"],
  category_rules: ["pattern", "category_id", "sort"],
  goals: ["name", "target", "target_date", "saved", "account_id", "notes", "done", "sort"],
  assets: ["category", "name", "make", "model", "serial", "install_date", "capacity", "warranty_until", "location", "manual_url", "support_phone", "lifespan_years", "replace_cost", "registered", "notes", "sort"],
  maintenance_tasks: ["name", "area", "interval_months", "last_done", "notes", "asset_id", "est_cost", "season", "active", "remind_days", "sort"],
  warranties: ["group_name", "name", "provider", "covers", "start_date", "length_months", "doc_location", "notes", "asset_id", "sort"],
  vendors: ["trade", "company", "contact", "phone", "email", "rating", "notes", "last_used", "sort"],
  projects: ["name", "status", "type", "date", "vendor_id", "cost", "est_cost", "permit", "adds_basis", "receipt", "priority", "timing", "notes", "sort"],
  finishes: ["room", "surface", "brand", "color_name", "color_code", "sheen", "material", "notes", "sort"],
  documents: ["name", "have", "location", "backed_up", "notes", "sort"],
  inventory: ["room", "item", "brand_model", "serial", "purchase_date", "value", "has_photo", "notes", "sort"],
  checklist_items: ["list", "section", "text", "detail", "priority", "done", "done_on", "answer", "fills", "applies_to", "sort"],
  utilities: ["service", "provider", "account_no", "contact", "location", "typical_monthly", "notes", "sort"],
  emergency: ["section", "label", "value", "note", "sort"],
  lifespans: ["section", "item", "variant", "care", "interval", "lifespan", "plan_years", "notes", "keep", "sort"],
  transactions: ["date", "amount", "payee", "memo", "category_id", "account_id", "person_id", "pending"],
};
const PUBLIC_SETTINGS = ["household_name", "timezone", "mode", "home", "notify", "budget_start_month"];

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const err = (message: string, status = 400) => json({ error: message }, status);

export async function handleApi(req: Request, db: Db, env: ApiEnv): Promise<Response> {
  seedIfEmpty(db);
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const secure = url.protocol === "https:";
  const baseUrl = url.origin;
  const tz = getSetting<string>(db, "timezone", "America/Los_Angeles");
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: tz });

  try {
    // ---- calendar feed (token in the URL, no cookie) --------------------------
    let m = path.match(/^\/ics\/([A-Za-z0-9_-]+)\.ics$/);
    if (m) {
      const token = getSetting<string>(db, "ics_token", "");
      if (!token || m[1] !== token) return new Response("Not found", { status: 404 });
      return new Response(buildIcs(db, todayStr, baseUrl), {
        headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-cache", "content-disposition": 'inline; filename="homebase.ics"' },
      });
    }

    // ---- auth -------------------------------------------------------------------
    const pinHash = getSetting<string>(db, "pin_hash", "");
    if (path === "/api/status") {
      const authed = await checkSession(db, cookieValue(req, "hb_session"));
      return json({ setup_done: !!pinHash, authed, lock: lockoutState(db), household_name: getSetting(db, "household_name", "Home Base") });
    }
    if (path === "/api/auth/setup" && method === "POST") {
      if (pinHash) return err("Already set up.", 409);
      const body = await req.json();
      const pin = String(body.pin || "");
      if (!/^\d{4,8}$/.test(pin)) return err("PIN must be 4–8 digits.");
      setSetting(db, "pin_hash", await hashPin(pin));
      ensureSecret(db, "session_secret");
      ensureSecret(db, "ics_token");
      if (body.household_name) setSetting(db, "household_name", String(body.household_name).slice(0, 60));
      if (Array.isArray(body.people)) {
        for (const p of body.people) if (p.id && p.email !== undefined) updateRow(db, "people", p.id, { email: String(p.email).trim() });
      }
      const token = await makeSession(db);
      return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, secure) });
    }
    if (path === "/api/auth/login" && method === "POST") {
      if (!pinHash) return err("Set up first.", 409);
      const lock = lockoutState(db);
      if (lock.locked) return err(`Too many tries. Wait ${Math.ceil(lock.retry_in / 60)} min.`, 429);
      const body = await req.json();
      if (!(await verifyPin(String(body.pin || ""), pinHash))) { recordPinFailure(db); return err("Wrong PIN.", 401); }
      clearPinFailures(db);
      const token = await makeSession(db);
      return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, secure) });
    }
    if (path === "/api/auth/logout" && method === "POST") return json({ ok: true }, 200, { "set-cookie": clearCookie(secure) });

    if (!(await checkSession(db, cookieValue(req, "hb_session")))) return err("Not signed in.", 401);

    if (path === "/api/auth/change-pin" && method === "POST") {
      const body = await req.json();
      if (!(await verifyPin(String(body.current || ""), pinHash))) return err("Current PIN is wrong.", 401);
      if (!/^\d{4,8}$/.test(String(body.next || ""))) return err("New PIN must be 4–8 digits.");
      setSetting(db, "pin_hash", await hashPin(String(body.next)));
      setSetting(db, "session_generation", getSetting<number>(db, "session_generation", 1) + 1); // sign everyone out
      const token = await makeSession(db);
      return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, secure) });
    }

    // ---- bootstrap: everything the shell needs in one call ----------------------
    if (path === "/api/bootstrap") {
      const settings = allSettings(db);
      const pub: Record<string, unknown> = {};
      for (const k of Object.keys(settings)) if (!SECRET_SETTINGS.has(k)) pub[k] = settings[k];
      const vapid = await ensureVapid(db);
      return json({
        settings: pub, today: todayStr,
        people: db.all("SELECT * FROM people ORDER BY sort"),
        accounts: db.all("SELECT * FROM accounts WHERE archived = 0 ORDER BY sort, name"),
        categories: db.all("SELECT * FROM categories WHERE archived = 0 ORDER BY sort"),
        vendors: db.all("SELECT * FROM vendors ORDER BY sort"),
        assets: db.all("SELECT id, name, category FROM assets ORDER BY sort"),
        alerts: computeAlerts(db, todayStr),
        email_configured: emailConfigured(env),
        simplefin_connected: !!getSetting(db, "simplefin_access_url", ""),
        vapid_public: vapid.publicKey,
        ics_url: `${baseUrl}/ics/${ensureSecret(db, "ics_token")}.ics`,
        push_subscriptions: db.all("SELECT id, label, person_id, created_at, failures FROM push_subscriptions ORDER BY created_at"),
      });
    }

    // ---- settings ---------------------------------------------------------------
    if (path === "/api/settings" && method === "PUT") {
      const body = await req.json();
      for (const k of Object.keys(body)) if (PUBLIC_SETTINGS.includes(k)) setSetting(db, k, body[k]);
      return json({ ok: true });
    }

    // ---- budget -----------------------------------------------------------------
    if (path === "/api/paycheck") return json(paycheckPlan(db));
    if (path === "/api/budget") return json(budgetForMonth(db, url.searchParams.get("month") || todayStr.slice(0, 7)));
    if (path === "/api/budget/year") return json(yearGrid(db, Number(url.searchParams.get("year")) || Number(todayStr.slice(0, 4))));
    if (path === "/api/budget/override" && method === "PUT") {
      const b = await req.json();
      if (b.amount === null || b.amount === "") db.run("DELETE FROM budget_overrides WHERE category_id = ? AND month = ?", b.category_id, b.month);
      else db.run("INSERT INTO budget_overrides (category_id, month, amount) VALUES (?,?,?) ON CONFLICT(category_id, month) DO UPDATE SET amount = excluded.amount", b.category_id, b.month, Number(b.amount));
      return json({ ok: true });
    }
    if (path === "/api/goals") return json(goalsWithProgress(db));
    if (path === "/api/networth") return json(netWorth(db));

    // ---- transactions -----------------------------------------------------------
    if (path === "/api/transactions" && method === "GET") {
      const where: string[] = [], params: unknown[] = [];
      const month = url.searchParams.get("month");
      if (month) { where.push("substr(t.date,1,7) = ?"); params.push(month); }
      const from = url.searchParams.get("from"), to = url.searchParams.get("to");
      if (from) { where.push("t.date >= ?"); params.push(from); }
      if (to) { where.push("t.date <= ?"); params.push(to); }
      const cat = url.searchParams.get("category");
      if (cat === "none") where.push("(t.category_id IS NULL OR t.category_id = '')");
      else if (cat) { where.push("t.category_id = ?"); params.push(cat); }
      const acct = url.searchParams.get("account");
      if (acct) { where.push("t.account_id = ?"); params.push(acct); }
      const q = url.searchParams.get("q");
      if (q) { where.push("(t.payee LIKE ? OR t.memo LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
      const limit = Math.min(Number(url.searchParams.get("limit")) || 500, 2000);
      const rows = db.all(
        `SELECT t.*, c.name category_name, a.name account_name FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN accounts a ON a.id = t.account_id
         ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY t.date DESC, t.created_at DESC LIMIT ?`, ...params, limit,
      );
      return json(rows);
    }
    if (path === "/api/transactions" && method === "POST") {
      const body = await req.json();
      const rows = Array.isArray(body.rows) ? body.rows : [body];
      let inserted = 0, skipped = 0;
      const now = new Date().toISOString();
      for (const r of rows) {
        const date = parseDate(r.date) ?? todayStr;
        const amount = Number(r.amount);
        if (!isFinite(amount)) { skipped++; continue; }
        const hash = await dedupeHash(date, amount, r.payee || "", r.account_id || null);
        if (body.dedupe !== false && db.one("SELECT 1 FROM transactions WHERE dedupe_hash = ?", hash)) { skipped++; continue; }
        insertRow(db, "transactions", {
          date, amount, payee: r.payee || "", memo: r.memo || "", category_id: r.category_id || applyRules(db, r.payee || "", r.memo || ""),
          account_id: r.account_id || null, person_id: r.person_id || null, source: r.source || "manual", dedupe_hash: hash, created_at: now,
        });
        inserted++;
      }
      return json({ ok: true, inserted, skipped });
    }
    if (path === "/api/transactions/monthly" && method === "POST") {
      // "Just type the month's total" mode: one transaction per category per month.
      const b = await req.json();
      const cat = db.one<any>("SELECT * FROM categories WHERE id = ?", b.category_id);
      if (!cat) return err("Unknown category.");
      const extId = `mt:${b.month}:${b.category_id}`;
      const amount = cat.kind === "expense" ? -Math.abs(Number(b.amount) || 0) : Math.abs(Number(b.amount) || 0);
      const existing = db.one<any>("SELECT id FROM transactions WHERE external_id = ?", extId);
      if (!Number(b.amount)) { if (existing) db.run("DELETE FROM transactions WHERE id = ?", existing.id); return json({ ok: true, removed: !!existing }); }
      if (existing) updateRow(db, "transactions", existing.id, { amount });
      else insertRow(db, "transactions", { date: `${b.month}-01`, amount, payee: `${cat.name} — monthly total`, memo: "Entered as a monthly total", category_id: cat.id, source: "monthly_total", external_id: extId, created_at: new Date().toISOString() });
      return json({ ok: true });
    }
    if (path === "/api/import/preview" && method === "POST") {
      const b = await req.json();
      const rows = parseCsv(String(b.csv || ""));
      if (rows.length < 2) return err("Could not find any rows in that file.");
      return json({ header: rows[0], columns: guessColumns(rows[0]), sample: rows.slice(1, 6), total: rows.length - 1 });
    }
    if (path === "/api/import/commit" && method === "POST") {
      const b = await req.json();
      const rows = parseCsv(String(b.csv || ""));
      const c = b.columns || guessColumns(rows[0]);
      const out: any[] = [];
      for (const r of rows.slice(1)) {
        const date = parseDate(r[c.date]);
        let amount = NaN;
        if (c.amount >= 0) amount = parseAmount(r[c.amount]);
        else if (c.debit >= 0 || c.credit >= 0) {
          const d = c.debit >= 0 ? parseAmount(r[c.debit]) : 0, cr = c.credit >= 0 ? parseAmount(r[c.credit]) : 0;
          amount = (isFinite(cr) ? Math.abs(cr) : 0) - (isFinite(d) ? Math.abs(d) : 0);
        }
        if (b.flip_sign) amount = -amount;
        if (!date || !isFinite(amount)) continue;
        out.push({ date, amount, payee: r[c.payee] || "", memo: c.memo >= 0 ? r[c.memo] : "", account_id: b.account_id || null, source: "csv" });
      }
      const res = await handleApi(new Request(`${baseUrl}/api/transactions`, { method: "POST", headers: req.headers, body: JSON.stringify({ rows: out }) }), db, env);
      return res;
    }
    if (path === "/api/rules/apply" && method === "POST") {
      const rows = db.all<any>("SELECT id, payee, memo FROM transactions WHERE category_id IS NULL OR category_id = ''");
      let n = 0;
      for (const r of rows) { const c = applyRules(db, r.payee, r.memo); if (c) { db.run("UPDATE transactions SET category_id = ? WHERE id = ?", c, r.id); n++; } }
      return json({ ok: true, categorized: n });
    }

    // ---- home -------------------------------------------------------------------
    if (path === "/api/home/overview") {
      const tasks = taskViews(db, todayStr);
      const warranties = warrantyViews(db, todayStr, Number(getSetting<any>(db, "notify", {}).warranty_days) || 90);
      const inv = db.one<any>("SELECT COALESCE(SUM(value),0) t, COUNT(*) n FROM inventory")!;
      const lists: Record<string, { done: number; total: number }> = {};
      for (const r of db.all<any>("SELECT list, SUM(done) d, COUNT(*) n FROM checklist_items GROUP BY list")) lists[r.list] = { done: Number(r.d), total: Number(r.n) };
      return json({
        tasks, warranties, forecast: replacementForecast(db, todayStr), basis: costBasis(db), walkthrough: walkthroughDeadline(db),
        inventory: { total: Number(inv.t), count: Number(inv.n) }, checklists: lists,
        overdue: tasks.filter((t) => t.status === "overdue").length, due_soon: tasks.filter((t) => t.status === "soon" || t.status === "due").length,
        warranties_active: warranties.filter((w) => w.status === "active" || w.status === "expiring").length,
        warranties_expiring: warranties.filter((w) => w.status === "expiring").length,
        projects_planned: db.one<any>("SELECT COALESCE(SUM(est_cost),0) t FROM projects WHERE status != 'done'")?.t ?? 0,
      });
    }
    m = path.match(/^\/api\/maintenance\/([^/]+)\/done$/);
    if (m && method === "POST") {
      const task = db.one<any>("SELECT * FROM maintenance_tasks WHERE id = ?", m[1]);
      if (!task) return err("Task not found.", 404);
      const b = await req.json();
      const done_on = parseDate(b.done_on) ?? todayStr;
      let txId: string | null = null;
      if (b.post_to_budget && Number(b.cost) > 0) {
        const cat = db.one<any>("SELECT id FROM categories WHERE home_link = 'maintenance' AND archived = 0");
        txId = insertRow(db, "transactions", {
          date: done_on, amount: -Math.abs(Number(b.cost)), payee: b.vendor_name || task.name, memo: `Maintenance: ${task.name}`,
          category_id: cat?.id ?? null, account_id: b.account_id || null, person_id: b.person_id || null, source: "maintenance", link_type: "task", link_id: task.id, created_at: new Date().toISOString(),
        });
      }
      insertRow(db, "maintenance_log", { task_id: task.id, done_on, cost: Number(b.cost) || 0, person_id: b.person_id || null, notes: b.notes || "", vendor_id: b.vendor_id || null, transaction_id: txId });
      if (!task.last_done || done_on >= task.last_done) updateRow(db, "maintenance_tasks", task.id, { last_done: done_on });
      if (b.vendor_id) updateRow(db, "vendors", b.vendor_id, { last_used: done_on });
      return json({ ok: true, transaction_id: txId });
    }
    if (path === "/api/maintenance/log") {
      const tid = url.searchParams.get("task_id");
      const rows = db.all(
        `SELECT l.*, t.name task_name, p.name person_name, v.company vendor FROM maintenance_log l
         JOIN maintenance_tasks t ON t.id = l.task_id LEFT JOIN people p ON p.id = l.person_id LEFT JOIN vendors v ON v.id = l.vendor_id
         ${tid ? "WHERE l.task_id = ?" : ""} ORDER BY l.done_on DESC LIMIT 200`, ...(tid ? [tid] : []),
      );
      return json(rows);
    }
    m = path.match(/^\/api\/projects\/([^/]+)\/post$/);
    if (m && method === "POST") {
      // Post a finished project's cost to the budget (Home Improvements or Maintenance & Repairs).
      const p = db.one<any>("SELECT * FROM projects WHERE id = ?", m[1]);
      if (!p) return err("Project not found.", 404);
      if (p.transaction_id) return err("Already posted.");
      const b = await req.json();
      const link = p.type === "repair" ? "maintenance" : "improvement";
      const cat = db.one<any>("SELECT id FROM categories WHERE home_link = ? AND archived = 0", link);
      const vendor = p.vendor_id ? db.one<any>("SELECT company FROM vendors WHERE id = ?", p.vendor_id) : null;
      const txId = insertRow(db, "transactions", {
        date: p.date || todayStr, amount: -Math.abs(Number(p.cost) || 0), payee: vendor?.company || p.name, memo: `${p.type === "repair" ? "Repair" : "Improvement"}: ${p.name}`,
        category_id: cat?.id ?? null, account_id: b.account_id || null, source: "project", link_type: "project", link_id: p.id, created_at: new Date().toISOString(),
      });
      updateRow(db, "projects", p.id, { transaction_id: txId });
      return json({ ok: true, transaction_id: txId });
    }

    // ---- photos -----------------------------------------------------------------
    if (path === "/api/photos" && method === "GET") {
      return json(db.all("SELECT id, entity_type, entity_id, mime, caption, created_at, length(data) bytes FROM photos WHERE entity_type = ? AND entity_id = ? ORDER BY created_at", url.searchParams.get("entity_type"), url.searchParams.get("entity_id")));
    }
    if (path === "/api/photos" && method === "POST") {
      const b = await req.json();
      const bytes = Uint8Array.from(atob(String(b.data || "")), (c) => c.charCodeAt(0));
      if (bytes.length > 1_500_000) return err("Photo too large — it should have been resized on your phone. Try again.");
      const id = insertRow(db, "photos", { entity_type: b.entity_type, entity_id: b.entity_id, mime: b.mime || "image/jpeg", data: bytes, caption: b.caption || "", created_at: new Date().toISOString() });
      if (b.entity_type === "inventory") db.run("UPDATE inventory SET has_photo = 1 WHERE id = ?", b.entity_id);
      return json({ ok: true, id });
    }
    m = path.match(/^\/api\/photos\/([^/]+)$/);
    if (m && method === "GET") {
      const p = db.one<any>("SELECT mime, data FROM photos WHERE id = ?", m[1]);
      if (!p) return new Response("Not found", { status: 404 });
      const data = p.data instanceof ArrayBuffer ? new Uint8Array(p.data) : p.data;
      return new Response(data, { headers: { "content-type": p.mime, "cache-control": "private, max-age=31536000" } });
    }
    if (m && method === "DELETE") { db.run("DELETE FROM photos WHERE id = ?", m[1]); return json({ ok: true }); }

    // ---- push -------------------------------------------------------------------
    if (path === "/api/push/subscribe" && method === "POST") {
      const b = await req.json();
      const s = b.subscription;
      if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) return err("Bad subscription.");
      const existing = db.one<any>("SELECT id FROM push_subscriptions WHERE endpoint = ?", s.endpoint);
      if (existing) updateRow(db, "push_subscriptions", existing.id, { label: b.label || "Device", person_id: b.person_id || null, p256dh: s.keys.p256dh, auth: s.keys.auth, failures: 0 });
      else insertRow(db, "push_subscriptions", { label: b.label || "Device", person_id: b.person_id || null, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, created_at: new Date().toISOString() });
      return json({ ok: true });
    }
    if (path === "/api/push/test" && method === "POST") {
      const b = await req.json().catch(() => ({}));
      if (b.endpoint) {
        const sub = db.one<any>("SELECT * FROM push_subscriptions WHERE endpoint = ?", b.endpoint);
        if (!sub) return err("This device is not subscribed.");
        return json(await sendPush(db, sub, { title: "Home Base is connected", body: "You'll get reminders here.", url: "#/" }));
      }
      return json(await pushAll(db, { title: "Test from Home Base", body: "Push notifications are working.", url: "#/" }));
    }
    if (path === "/api/push/unsubscribe" && method === "POST") {
      const b = await req.json();
      db.run("DELETE FROM push_subscriptions WHERE endpoint = ?", String(b.endpoint || ""));
      return json({ ok: true });
    }
    m = path.match(/^\/api\/push\/([^/]+)$/);
    if (m && method === "DELETE") { db.run("DELETE FROM push_subscriptions WHERE id = ?", m[1]); return json({ ok: true }); }

    // ---- calendar / email / simplefin / cron -----------------------------------
    if (path === "/api/calendar/rotate" && method === "POST") {
      setSetting(db, "ics_token", "");
      return json({ ics_url: `${baseUrl}/ics/${ensureSecret(db, "ics_token")}.ics` });
    }
    if (path === "/api/email/test" && method === "POST") {
      const to = db.all<{ email: string }>("SELECT email FROM people WHERE email IS NOT NULL AND email != ''").map((p) => p.email);
      if (!to.length) return err("Add an email address to a person first.");
      const { html, text } = renderDigest("Home Base email is working", "This is a test.", [{ title: "Nothing to do", body: "Reminders will look like this.", link: "#/" }], baseUrl);
      return json(await sendEmail(env, to, "Test from Home Base", html, text));
    }
    if (path === "/api/simplefin/connect" && method === "POST") {
      const b = await req.json();
      await claimSetupToken(db, String(b.setup_token || ""));
      const sync = await syncSimplefin(db, { days: 90 }).catch((e) => ({ error: String(e) }));
      return json({ ok: true, sync });
    }
    if (path === "/api/simplefin/sync" && method === "POST") return json(await syncSimplefin(db, { days: Number(url.searchParams.get("days")) || 45 }));
    if (path === "/api/simplefin" && method === "DELETE") {
      setSetting(db, "simplefin_access_url", ""); setSetting(db, "simplefin_status", null);
      return json({ ok: true });
    }
    if (path === "/api/notify/run" && method === "POST") {
      const b = await req.json().catch(() => ({}));
      return json(await runCron(db, env, baseUrl, { daily: !!b.daily, digest: !!b.digest, sync: !!b.sync }));
    }
    if (path === "/api/notifications") return json(db.all("SELECT * FROM notifications ORDER BY sent_at DESC LIMIT 100"));
    if (path === "/api/alerts") return json(computeAlerts(db, todayStr));

    // ---- export (backup) --------------------------------------------------------
    if (path === "/api/export") {
      const dump: Record<string, unknown> = { exported_at: new Date().toISOString(), settings: {} as Record<string, unknown> };
      const s = allSettings(db);
      for (const k of Object.keys(s)) if (!SECRET_SETTINGS.has(k)) (dump.settings as any)[k] = s[k];
      for (const t of Object.keys(TABLES)) dump[t] = db.all(`SELECT * FROM ${t}`);
      dump.maintenance_log = db.all("SELECT * FROM maintenance_log");
      dump.budget_overrides = db.all("SELECT * FROM budget_overrides");
      return json(dump, 200, { "content-disposition": `attachment; filename="homebase-backup-${todayStr}.json"` });
    }

    // ---- generic CRUD -----------------------------------------------------------
    m = path.match(/^\/api\/t\/([a-z_]+)(?:\/([^/]+))?$/);
    if (m) {
      const table = m[1], id = m[2];
      const cols = TABLES[table];
      if (!cols) return err("Unknown table.", 404);
      if (method === "GET" && !id) {
        const where: string[] = [], params: unknown[] = [];
        for (const [k, v] of url.searchParams) if (cols.includes(k)) { where.push(`${k} = ?`); params.push(v); }
        return json(db.all(`SELECT * FROM ${table} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY sort, rowid`, ...params));
      }
      if (method === "GET" && id) { const r = db.one(`SELECT * FROM ${table} WHERE id = ?`, id); return r ? json(r) : err("Not found.", 404); }
      if (method === "POST" && !id) {
        const b = await req.json();
        const row: Record<string, unknown> = {};
        for (const c of cols) if (b[c] !== undefined) row[c] = b[c];
        if (table === "transactions") { row.created_at = new Date().toISOString(); row.source = "manual"; }
        const newId = insertRow(db, table, row);
        return json(db.one(`SELECT * FROM ${table} WHERE id = ?`, newId));
      }
      if (method === "PUT" && id) {
        const b = await req.json();
        const patch: Record<string, unknown> = {};
        for (const c of cols) if (b[c] !== undefined) patch[c] = b[c];
        if (table === "checklist_items" && patch.done !== undefined) patch.done_on = patch.done ? todayStr : null;
        updateRow(db, table, id, patch);
        return json(db.one(`SELECT * FROM ${table} WHERE id = ?`, id));
      }
      if (method === "DELETE" && id) {
        db.run(`DELETE FROM ${table} WHERE id = ?`, id);
        if (table === "maintenance_tasks") db.run("DELETE FROM maintenance_log WHERE task_id = ?", id);
        db.run("DELETE FROM photos WHERE entity_id = ?", id);
        return json({ ok: true });
      }
    }
    return err("Not found.", 404);
  } catch (e) {
    return err((e as Error).message || String(e), 500);
  }
}

export { uid };

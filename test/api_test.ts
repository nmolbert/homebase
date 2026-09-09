// deno test -A test/api_test.ts
import { DatabaseSync } from "node:sqlite";
import { Db, migrate } from "../src/db.ts";
import { handleApi } from "../src/api.ts";
import { encryptPayload } from "../src/logic/push.ts";
import { addMonths } from "../src/logic/home.ts";
import { parseCsv, parseAmount, parseDate } from "../src/logic/csv.ts";

function makeDb(): Db {
  const s = new DatabaseSync(":memory:");
  const db: Db = {
    all: (q, ...p) => s.prepare(q).all(...(p as any[])) as any[],
    one: (q, ...p) => s.prepare(q).get(...(p as any[])) as any,
    run: (q, ...p) => { s.prepare(q).run(...(p as any[])); },
    exec: (q) => s.exec(q),
  };
  migrate(db);
  return db;
}
const env = {};
const BASE = "http://localhost";
let cookie = "";
async function call(db: Db, path: string, method = "GET", body?: unknown) {
  const res = await handleApi(new Request(BASE + path, { method, headers: { cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), db, env);
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const ct = res.headers.get("content-type") || "";
  return { status: res.status, body: ct.includes("json") ? await res.json() : await res.text() };
}
const assert = (c: unknown, msg: string) => { if (!c) throw new Error("ASSERT: " + msg); };

Deno.test("end to end", async () => {
  const db = makeDb();
  let r = await call(db, "/api/status");
  assert(r.status === 200 && r.body.setup_done === false, "fresh install has no PIN");
  r = await call(db, "/api/bootstrap");
  assert(r.status === 401, "bootstrap needs login");
  r = await call(db, "/api/auth/setup", "POST", { pin: "12", household_name: "Home Base" });
  assert(r.status === 400, "short PIN rejected");
  r = await call(db, "/api/auth/setup", "POST", { pin: "2468", household_name: "Home Base" });
  assert(r.status === 200 && cookie.startsWith("hb_session="), "setup gives session");
  cookie = "";
  r = await call(db, "/api/auth/login", "POST", { pin: "0000" });
  assert(r.status === 401, "wrong pin");
  r = await call(db, "/api/auth/login", "POST", { pin: "2468" });
  assert(r.status === 200, "login ok");

  r = await call(db, "/api/bootstrap");
  assert(r.status === 200, "bootstrap ok");
  assert(r.body.people.length === 2 && r.body.categories.length > 40, "seeded people + categories");
  assert(r.body.settings.pin_hash === undefined && r.body.settings.session_secret === undefined, "secrets hidden");
  assert(r.body.ics_url.includes("/ics/"), "ics url present");
  assert(r.body.vapid_public.length > 40, "vapid generated");

  // Paycheck plan replicates Alex's sheet.
  r = await call(db, "/api/paycheck");
  const plan = r.body;
  assert(Math.abs(plan.net_monthly - 26162.91) < 5, `net monthly ≈ 26,162.91 (got ${plan.net_monthly.toFixed(2)})`);
  assert(Math.abs(plan.reserve_monthly - 9780) < 1, `tax reserve ≈ 9,780 (got ${plan.reserve_monthly.toFixed(2)})`);
  assert(Math.abs(plan.spending_available - 6162.91) < 5, `spending available ≈ 6,162.91 like the sheet (got ${plan.spending_available.toFixed(2)})`);

  // Transactions + budget rollup.
  const groceries = r.body && (await call(db, "/api/bootstrap")).body.categories.find((c: any) => c.name === "Groceries");
  const month = new Date().toISOString().slice(0, 7);
  r = await call(db, "/api/transactions", "POST", { rows: [
    { date: `${month}-03`, amount: -120.5, payee: "Trader Joe's", category_id: groceries.id },
    { date: `${month}-04`, amount: -80, payee: "Ralphs", category_id: groceries.id },
    { date: `${month}-04`, amount: -80, payee: "Ralphs", category_id: groceries.id }, // duplicate
    { date: `${month}-01`, amount: 5000, payee: "UCLA payroll" },
  ] });
  assert(r.body.inserted === 3 && r.body.skipped === 1, "dedupe on import");
  r = await call(db, `/api/budget?month=${month}`);
  const g = r.body.rows.find((x: any) => x.id === groceries.id);
  assert(Math.abs(g.actual - 200.5) < 0.01, "groceries actual 200.50");
  assert(r.body.uncategorized.count === 1, "one uncategorized");

  // Monthly-total entry mode.
  r = await call(db, "/api/transactions/monthly", "POST", { month, category_id: groceries.id, amount: 300 });
  r = await call(db, `/api/budget?month=${month}`);
  assert(Math.abs(r.body.rows.find((x: any) => x.id === groceries.id).actual - 500.5) < 0.01, "monthly total adds");

  // Rules.
  r = await call(db, "/api/t/category_rules", "POST", { pattern: "payroll", category_id: (await call(db, "/api/bootstrap")).body.categories.find((c: any) => c.name === "Salary / Paycheck").id });
  r = await call(db, "/api/rules/apply", "POST");
  assert(r.body.categorized === 1, "rule categorized payroll");

  // CSV import.
  const csv = 'Date,Description,Amount\n09/02/2026,"COSTCO WHSE #123",-245.10\n09/03/2026,Interest,1.25\n';
  r = await call(db, "/api/import/preview", "POST", { csv });
  assert(r.body.total === 2 && r.body.columns.amount === 2, "csv preview");
  r = await call(db, "/api/import/commit", "POST", { csv, columns: r.body.columns });
  assert(r.body.inserted === 2, "csv commit");

  // Home: owner mode, mark a task done with a cost → posts to budget.
  await call(db, "/api/settings", "PUT", { mode: "owner", home: { close_date: "2026-01-15", purchase_price: 1763000, year_built: 2026 } });
  r = await call(db, "/api/home/overview");
  assert(r.body.walkthrough === addMonths("2026-01-15", 11), "walkthrough deadline = close + 11 months");
  assert(r.body.tasks.length >= 20, "tasks seeded");
  const filter = r.body.tasks.find((t: any) => t.name.startsWith("Replace HVAC"));
  r = await call(db, `/api/maintenance/${filter.id}/done`, "POST", { done_on: "2026-09-01", cost: 22, post_to_budget: true });
  assert(r.body.transaction_id, "posted maintenance cost");
  r = await call(db, "/api/home/overview");
  const f2 = r.body.tasks.find((t: any) => t.id === filter.id);
  assert(f2.next_due === "2026-11-01" && f2.status === "ok", `next due rolls forward (${f2.next_due})`);
  r = await call(db, `/api/budget?month=2026-09`);
  assert(r.body.rows.find((x: any) => x.home_link === "maintenance").actual === 22, "maintenance shows in budget");

  // Warranty + alerts.
  const w = (await call(db, "/api/t/warranties")).body.find((x: any) => x.name === "Workmanship / fit & finish");
  await call(db, `/api/t/warranties/${w.id}`, "PUT", { start_date: "2026-01-15" });
  r = await call(db, "/api/home/overview");
  const wv = r.body.warranties.find((x: any) => x.id === w.id);
  assert(wv.expires === "2027-01-15", "warranty expiry computed");

  // ICS feed.
  const ics = (await call(db, "/api/bootstrap")).body.ics_url.replace(BASE, "");
  r = await call(db, ics);
  assert(r.status === 200 && String(r.body).includes("BEGIN:VEVENT") && String(r.body).includes("Replace HVAC"), "ics has events");
  r = await call(db, "/ics/wrong.ics");
  assert(r.status === 404, "ics token required");

  // Push encryption produces a well-formed aes128gcm body for a fake subscriber.
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const body = await encryptPayload(b64(uaPub), b64(crypto.getRandomValues(new Uint8Array(16))), JSON.stringify({ title: "hi" }));
  assert(body.length > 86 + 16 && body[20] === 65, "aes128gcm header (keyid len 65)");

  // Export + PIN change signs out old sessions.
  r = await call(db, "/api/export");
  assert(r.body.transactions.length >= 6 && r.body.settings.pin_hash === undefined, "export ok, no secrets");
  const old = cookie;
  r = await call(db, "/api/auth/change-pin", "POST", { current: "2468", next: "1357" });
  assert(r.status === 200, "pin changed");
  cookie = old;
  r = await call(db, "/api/bootstrap");
  assert(r.status === 401, "old session invalid after PIN change");

  // Cron: force daily; nothing should throw without push subs / email.
  cookie = "";
  await call(db, "/api/auth/login", "POST", { pin: "1357" });
  r = await call(db, "/api/notify/run", "POST", { daily: true, digest: true });
  assert(r.status === 200 && r.body.date, "cron ran");
});

Deno.test("csv helpers", () => {
  assert(parseAmount("($1,234.50)") === -1234.5, "parens negative");
  assert(parseAmount("-45") === -45 && parseAmount("$12.00") === 12, "signs");
  assert(parseDate("9/5/26") === "2026-09-05" && parseDate("2026-09-05T10:00") === "2026-09-05", "dates");
  const rows = parseCsv('a,b\n"x, y","he said ""hi"""\n');
  assert(rows[1][0] === "x, y" && rows[1][1] === 'he said "hi"', "quotes");
  assert(addMonths("2026-01-31", 1) === "2026-03-03" || addMonths("2026-01-31", 1) === "2026-02-28", "month add");
});

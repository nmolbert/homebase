// Database layer. One tiny interface so the same code runs inside the
// Durable Object (SqlStorage) in production and on top of node:sqlite in the
// local Deno harness (dev/serve.ts) and tests.

export interface Db {
  all<T = any>(sql: string, ...params: unknown[]): T[];
  one<T = any>(sql: string, ...params: unknown[]): T | undefined;
  run(sql: string, ...params: unknown[]): void;
  exec(sql: string): void; // multiple statements, no params
}

export const uid = () => crypto.randomUUID();
export const today = (tz = "America/Los_Angeles") =>
  new Date().toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD

export const SCHEMA_VERSION = 1;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, color TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'checking',
  owner_id TEXT, institution TEXT, balance REAL DEFAULT 0, balance_date TEXT,
  simplefin_id TEXT UNIQUE, on_budget INTEGER DEFAULT 1, archived INTEGER DEFAULT 0,
  notes TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS income_sources (
  id TEXT PRIMARY KEY, person_id TEXT, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'w2',
  gross_annual REAL DEFAULT 0, tax_rate REAL DEFAULT 0.3, deferrals TEXT DEFAULT '[]',
  active INTEGER DEFAULT 1, notes TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS allocations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'fixed',
  amount REAL DEFAULT 0, account_id TEXT, category_id TEXT, notes TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, group_name TEXT NOT NULL, name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'expense', monthly_budget REAL DEFAULT 0,
  home_link TEXT, archived INTEGER DEFAULT 0, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS budget_overrides (
  category_id TEXT NOT NULL, month TEXT NOT NULL, amount REAL NOT NULL,
  PRIMARY KEY (category_id, month));
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, amount REAL NOT NULL, payee TEXT,
  memo TEXT, category_id TEXT, account_id TEXT, person_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual', external_id TEXT UNIQUE, pending INTEGER DEFAULT 0,
  dedupe_hash TEXT, link_type TEXT, link_id TEXT, created_at TEXT);
CREATE INDEX IF NOT EXISTS tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS tx_cat ON transactions(category_id);
CREATE TABLE IF NOT EXISTS category_rules (
  id TEXT PRIMARY KEY, pattern TEXT NOT NULL, category_id TEXT NOT NULL, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, target REAL DEFAULT 0, target_date TEXT,
  saved REAL DEFAULT 0, account_id TEXT, notes TEXT, done INTEGER DEFAULT 0, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT 'system', name TEXT NOT NULL,
  make TEXT, model TEXT, serial TEXT, install_date TEXT, capacity TEXT, warranty_until TEXT,
  location TEXT, manual_url TEXT, support_phone TEXT, lifespan_years REAL, replace_cost REAL,
  registered INTEGER DEFAULT 0, notes TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS maintenance_tasks (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, area TEXT, interval_months REAL NOT NULL DEFAULT 12,
  last_done TEXT, notes TEXT, asset_id TEXT, est_cost REAL DEFAULT 0, season TEXT,
  active INTEGER DEFAULT 1, remind_days INTEGER DEFAULT 7, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS maintenance_log (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, done_on TEXT NOT NULL, cost REAL DEFAULT 0,
  person_id TEXT, notes TEXT, vendor_id TEXT, transaction_id TEXT);
CREATE TABLE IF NOT EXISTS warranties (
  id TEXT PRIMARY KEY, group_name TEXT, name TEXT NOT NULL, provider TEXT, covers TEXT,
  start_date TEXT, length_months REAL, doc_location TEXT, notes TEXT, asset_id TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY, trade TEXT NOT NULL, company TEXT, contact TEXT, phone TEXT, email TEXT,
  rating INTEGER, notes TEXT, last_used TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'idea',
  type TEXT DEFAULT 'improvement', date TEXT, vendor_id TEXT, cost REAL, est_cost REAL,
  permit TEXT, adds_basis INTEGER DEFAULT 0, receipt INTEGER DEFAULT 0, priority TEXT,
  timing TEXT, notes TEXT, transaction_id TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS finishes (
  id TEXT PRIMARY KEY, room TEXT NOT NULL, surface TEXT, brand TEXT, color_name TEXT,
  color_code TEXT, sheen TEXT, material TEXT, notes TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, have INTEGER DEFAULT 0, location TEXT,
  backed_up INTEGER DEFAULT 0, notes TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY, room TEXT NOT NULL, item TEXT NOT NULL, brand_model TEXT, serial TEXT,
  purchase_date TEXT, value REAL DEFAULT 0, has_photo INTEGER DEFAULT 0, notes TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS checklist_items (
  id TEXT PRIMARY KEY, list TEXT NOT NULL, section TEXT, text TEXT NOT NULL, detail TEXT,
  priority TEXT, done INTEGER DEFAULT 0, done_on TEXT, answer TEXT, fills TEXT,
  applies_to TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS utilities (
  id TEXT PRIMARY KEY, service TEXT NOT NULL, provider TEXT, account_no TEXT, contact TEXT,
  location TEXT, typical_monthly REAL, notes TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS emergency (
  id TEXT PRIMARY KEY, section TEXT NOT NULL, label TEXT NOT NULL, value TEXT, note TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS lifespans (
  id TEXT PRIMARY KEY, section TEXT, item TEXT NOT NULL, variant TEXT, care TEXT, interval TEXT,
  lifespan TEXT, plan_years REAL, notes TEXT, keep INTEGER DEFAULT 1, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, mime TEXT NOT NULL,
  data BLOB NOT NULL, caption TEXT, created_at TEXT);
CREATE INDEX IF NOT EXISTS photos_entity ON photos(entity_type, entity_id);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY, label TEXT, person_id TEXT, endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT, failures INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, key TEXT NOT NULL, channel TEXT NOT NULL,
  title TEXT, body TEXT, sent_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS notif_key ON notifications(kind, key, channel);
`;

// ---- settings helpers -------------------------------------------------------
export function getSetting<T = any>(db: Db, key: string, fallback: T): T {
  const row = db.one<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}
export function setSetting(db: Db, key: string, value: unknown) {
  db.run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    JSON.stringify(value),
  );
}
export function allSettings(db: Db): Record<string, any> {
  const out: Record<string, any> = {};
  for (const r of db.all<{ key: string; value: string }>("SELECT key, value FROM settings")) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out;
}

// Keys that must never leave the server.
export const SECRET_SETTINGS = new Set([
  "pin_hash",
  "session_secret",
  "vapid_private",
  "simplefin_access_url",
  "ics_token",
  "pin_failures",
]);

// ---- migrate ----------------------------------------------------------------
export function migrate(db: Db) {
  db.exec(SCHEMA);
  const v = getSetting<number>(db, "schema_version", 0);
  if (v < SCHEMA_VERSION) setSetting(db, "schema_version", SCHEMA_VERSION);
}

// ---- generic row helpers used by the API -------------------------------------
export function insertRow(db: Db, table: string, row: Record<string, unknown>): string {
  const r = { ...row };
  if (!r.id) r.id = uid();
  const cols = Object.keys(r);
  db.run(
    `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    ...cols.map((c) => norm(r[c])),
  );
  return r.id as string;
}
export function updateRow(db: Db, table: string, id: string, patch: Record<string, unknown>) {
  const p = { ...patch };
  delete p.id;
  const cols = Object.keys(p);
  if (!cols.length) return;
  db.run(
    `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
    ...cols.map((c) => norm(p[c])),
    id,
  );
}
function norm(v: unknown) {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v !== null && typeof v === "object" && !(v instanceof Uint8Array) && !(v instanceof ArrayBuffer)) {
    return JSON.stringify(v);
  }
  return v;
}

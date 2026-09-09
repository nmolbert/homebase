// SimpleFIN Bridge: the user pastes a one-time setup token; we claim it once
// for a permanent access URL, then pull accounts + transactions daily.
import { Db, getSetting, insertRow, setSetting, uid } from "../db.ts";
import { applyRules, dedupeHash } from "./money.ts";

export async function claimSetupToken(db: Db, setupToken: string) {
  const claimUrl = atob(setupToken.trim());
  if (!/^https:\/\//.test(claimUrl)) throw new Error("That does not look like a SimpleFIN setup token.");
  const res = await fetch(claimUrl, { method: "POST" });
  if (!res.ok) throw new Error(`SimpleFIN claim failed (${res.status}). Setup tokens can only be used once — generate a new one.`);
  const accessUrl = (await res.text()).trim();
  setSetting(db, "simplefin_access_url", accessUrl);
  setSetting(db, "simplefin_status", { connected_at: new Date().toISOString(), error: null });
  return { ok: true };
}

function splitAccessUrl(accessUrl: string) {
  const u = new URL(accessUrl);
  const auth = btoa(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`);
  u.username = ""; u.password = "";
  return { base: u.toString().replace(/\/$/, ""), auth };
}

export async function syncSimplefin(db: Db, opts: { days?: number } = {}) {
  const accessUrl = getSetting<string>(db, "simplefin_access_url", "");
  if (!accessUrl) throw new Error("SimpleFIN is not connected.");
  const { base, auth } = splitAccessUrl(accessUrl);
  const days = opts.days ?? 45;
  const start = Math.floor(Date.now() / 1000) - days * 86400;
  const res = await fetch(`${base}/accounts?start-date=${start}&pending=1`, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) {
    const msg = `SimpleFIN returned ${res.status}`;
    setSetting(db, "simplefin_status", { ...getSetting(db, "simplefin_status", {}), error: msg, error_since: new Date().toISOString().slice(0, 10) });
    throw new Error(msg);
  }
  const data: any = await res.json();
  let newTx = 0, updatedAccounts = 0;
  const now = new Date().toISOString();
  for (const acct of data.accounts || []) {
    const sfId = `${acct.org?.id || acct.org?.domain || "sf"}:${acct.id}`;
    let row = db.one<any>("SELECT * FROM accounts WHERE simplefin_id = ?", sfId);
    const balance = Number(acct.balance);
    const balDate = acct["balance-date"] ? new Date(acct["balance-date"] * 1000).toISOString().slice(0, 10) : now.slice(0, 10);
    if (!row) {
      const id = insertRow(db, "accounts", {
        name: acct.name || "Bank account", type: guessType(acct), institution: acct.org?.name || acct.org?.domain || "",
        balance, balance_date: balDate, simplefin_id: sfId, sort: 50,
      });
      row = { id };
    } else {
      db.run("UPDATE accounts SET balance = ?, balance_date = ?, institution = COALESCE(NULLIF(institution,''), ?) WHERE id = ?", balance, balDate, acct.org?.name || "", row.id);
    }
    updatedAccounts++;
    for (const t of acct.transactions || []) {
      const extId = `sf:${sfId}:${t.id}`;
      const date = new Date((t.transacted_at || t.posted) * 1000).toISOString().slice(0, 10);
      const amount = Number(t.amount);
      const payee = t.payee || t.description || "";
      const existing = db.one<any>("SELECT id, pending FROM transactions WHERE external_id = ?", extId);
      if (existing) {
        if (existing.pending && !t.pending) db.run("UPDATE transactions SET pending = 0, date = ?, amount = ? WHERE id = ?", date, amount, existing.id);
        continue;
      }
      // A manual/CSV entry with the same date+amount+payee is the same transaction: adopt it.
      const hash = await dedupeHash(date, amount, payee, row.id);
      const dupe = db.one<any>("SELECT id FROM transactions WHERE dedupe_hash = ? AND external_id IS NULL", hash);
      if (dupe) { db.run("UPDATE transactions SET external_id = ?, source = 'simplefin', pending = ? WHERE id = ?", extId, t.pending ? 1 : 0, dupe.id); continue; }
      insertRow(db, "transactions", {
        id: uid(), date, amount, payee, memo: t.description && t.description !== payee ? t.description : "",
        category_id: applyRules(db, payee, t.description), account_id: row.id, source: "simplefin", external_id: extId,
        pending: t.pending ? 1 : 0, dedupe_hash: hash, created_at: now,
      });
      newTx++;
    }
  }
  const errors = (data.errors || []).join("; ");
  setSetting(db, "simplefin_status", { connected_at: getSetting<any>(db, "simplefin_status", {}).connected_at, last_sync: now, new_transactions: newTx, accounts: updatedAccounts, error: errors || null, error_since: errors ? now.slice(0, 10) : null });
  return { ok: true, new_transactions: newTx, accounts: updatedAccounts, errors };
}

function guessType(acct: any): string {
  const n = String(acct.name || "").toLowerCase();
  if (/credit|card|visa|mastercard|amex/.test(n)) return "credit";
  if (/saving|hysa|money market/.test(n)) return "savings";
  if (/loan|mortgage/.test(n)) return "loan";
  if (/broker|invest|401|ira|roth/.test(n)) return "investment";
  return "checking";
}

// Hourly cron → decide what to send. Day-of reminders go out once at the
// household's chosen local hour; the weekly digest on the chosen day; bank
// sync runs early each morning. Every send is logged so nothing repeats.
import { Db, getSetting, insertRow, setSetting } from "../db.ts";
import { Alert, computeAlerts } from "./home.ts";
import { EmailEnv, emailConfigured, renderDigest, sendEmail } from "./email.ts";
import { pushAll } from "./push.ts";
import { syncSimplefin } from "./simplefin.ts";

export function localParts(tz: string, d = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" });
  const parts: Record<string, string> = {};
  for (const p of f.formatToParts(d)) parts[p.type] = p.value;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, dow };
}

function alreadySent(db: Db, kind: string, key: string, channel: string) {
  return !!db.one("SELECT 1 FROM notifications WHERE kind = ? AND key = ? AND channel = ?", kind, key, channel);
}
function logSent(db: Db, kind: string, key: string, channel: string, title: string, body: string) {
  insertRow(db, "notifications", { kind, key, channel, title, body, sent_at: new Date().toISOString() });
}

export async function runCron(db: Db, env: EmailEnv, baseUrl: string, force: { daily?: boolean; digest?: boolean; sync?: boolean } = {}) {
  const tz = getSetting<string>(db, "timezone", "America/Los_Angeles");
  const notify = getSetting<any>(db, "notify", {});
  const { date, hour, dow } = localParts(tz);
  const report: Record<string, unknown> = { date, hour, dow };

  // 1. Bank sync at 5am local (or on demand).
  if ((hour === 5 || force.sync) && getSetting(db, "simplefin_access_url", "")) {
    try { report.sync = await syncSimplefin(db); } catch (e) { report.sync_error = String(e); }
  }

  const alerts = computeAlerts(db, date);
  const dailyHour = Number(notify.daily_hour ?? 8);
  const digestHour = Number(notify.digest_hour ?? 8);
  const digestDay = Number(notify.digest_day ?? 0);

  // 2. Day-of / overdue reminders, once per alert key.
  if (hour === dailyHour || force.daily) {
    const fresh = alerts.filter((a) => a.severity !== "low" && !alreadySent(db, a.kind, a.key, "push"));
    report.daily = fresh.length;
    if (fresh.length) {
      const first = fresh[0];
      const title = fresh.length === 1 ? first.title : `${fresh.length} things need attention`;
      const body = fresh.length === 1 ? first.body : fresh.slice(0, 3).map((a) => a.title).join(" · ");
      if (notify.push !== false) await pushAll(db, { title, body, url: fresh.length === 1 ? first.link : "#/", tag: "hb-daily" });
      for (const a of fresh) logSent(db, a.kind, a.key, "push", a.title, a.body);
      if (notify.email !== false) await emailAlerts(db, env, baseUrl, "Today from Home Base", "These need a look.", fresh, "daily");
    }
  }

  // 3. Weekly digest: everything open, including low-severity items.
  if ((dow === digestDay && hour === digestHour) || force.digest) {
    const key = `digest:${date}`;
    if (!alreadySent(db, "digest", key, "email") || force.digest) {
      report.digest = alerts.length;
      const upcoming = digestExtras(db, date);
      const items = [...alerts, ...upcoming];
      if (items.length) {
        if (notify.push !== false) await pushAll(db, { title: "Weekly home & money digest", body: items.slice(0, 3).map((a) => a.title).join(" · "), url: "#/", tag: "hb-digest" });
        if (notify.email !== false) await emailAlerts(db, env, baseUrl, "Your weekly Home Base digest", `${items.length} items for the week ahead.`, items, "digest", key);
      }
      logSent(db, "digest", key, "email", "digest", `${items.length} items`);
    }
  }
  setSetting(db, "last_cron", { at: new Date().toISOString(), report });
  return report;
}

// Extra digest-only items: tasks due in the next 14 days and budget standing.
function digestExtras(db: Db, date: string): Alert[] {
  const out: Alert[] = [];
  const month = date.slice(0, 7);
  const over = db.all<any>(
    `SELECT c.name, c.monthly_budget b, -SUM(t.amount) spent FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE c.kind = 'expense' AND substr(t.date,1,7) = ? GROUP BY c.id HAVING c.monthly_budget > 0 AND -SUM(t.amount) > c.monthly_budget * 0.9`, month,
  );
  for (const o of over) {
    out.push({ kind: "budget", key: `${month}:${o.name}`, title: `${o.name}: $${Math.round(o.spent).toLocaleString()} of $${Math.round(o.b).toLocaleString()}`, body: o.spent > o.b ? "Over budget this month." : "Close to the limit.", date: null, severity: "low", link: "#/budget" });
  }
  return out;
}

async function emailAlerts(db: Db, env: EmailEnv, baseUrl: string, title: string, intro: string, items: Alert[], kind: string, key?: string) {
  if (!emailConfigured(env)) return;
  const to = db.all<{ email: string }>("SELECT email FROM people WHERE email IS NOT NULL AND email != ''").map((p) => p.email);
  if (!to.length) return;
  const { html, text } = renderDigest(title, intro, items.map((a) => ({ title: a.title, body: a.body, link: a.link })), baseUrl);
  const res = await sendEmail(env, to, title, html, text);
  logSent(db, `email_${kind}`, key || new Date().toISOString(), "email", title, JSON.stringify(res).slice(0, 200));
}

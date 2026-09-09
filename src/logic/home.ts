// Home-manual logic: next-due dates, warranty status, replacement forecasts,
// and the alert list that drives push, email, the dashboard and the calendar.
import { Db, getSetting } from "../db.ts";

export function addMonths(date: string, months: number): string {
  const d = new Date(date + "T00:00:00Z");
  const whole = Math.floor(months);
  const frac = months - whole;
  d.setUTCMonth(d.getUTCMonth() + whole);
  if (frac) d.setUTCDate(d.getUTCDate() + Math.round(frac * 30));
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

export interface TaskView {
  id: string; name: string; area: string; interval_months: number; last_done: string | null;
  next_due: string | null; days_until: number | null; status: "overdue" | "due" | "soon" | "ok" | "unscheduled";
  est_cost: number; asset_id: string | null; asset_name: string | null; notes: string; remind_days: number; active: number;
}

export function taskViews(db: Db, todayStr: string): TaskView[] {
  const rows = db.all<any>(
    `SELECT t.*, a.name asset_name FROM maintenance_tasks t LEFT JOIN assets a ON a.id = t.asset_id
     WHERE t.active = 1 ORDER BY t.sort`,
  );
  return rows.map((t) => {
    const next = t.last_done ? addMonths(t.last_done, Number(t.interval_months) || 12) : null;
    const days = next ? daysBetween(todayStr, next) : null;
    let status: TaskView["status"] = "unscheduled";
    if (days !== null) {
      if (days < 0) status = "overdue";
      else if (days === 0) status = "due";
      else if (days <= (Number(t.remind_days) || 7)) status = "soon";
      else status = "ok";
    }
    return { ...t, next_due: next, days_until: days, status };
  }).sort((a, b) => {
    const order: Record<string, number> = { overdue: 0, due: 1, soon: 2, ok: 3, unscheduled: 4 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return (a.days_until ?? 9e9) - (b.days_until ?? 9e9);
  });
}

export function warrantyViews(db: Db, todayStr: string, soonDays = 90) {
  const rows = db.all<any>(
    `SELECT w.*, a.name asset_name FROM warranties w LEFT JOIN assets a ON a.id = w.asset_id ORDER BY w.sort`,
  );
  return rows.map((w) => {
    const expires = w.start_date && w.length_months ? addMonths(w.start_date, Number(w.length_months)) : null;
    const days = expires ? daysBetween(todayStr, expires) : null;
    let status = "unknown";
    if (days !== null) status = days < 0 ? "expired" : days <= soonDays ? "expiring" : "active";
    return { ...w, expires, days_until: days, status };
  });
}

// Replacement forecast: install date (or build year) + planned lifespan.
export function replacementForecast(db: Db, todayStr: string) {
  const home = getSetting<any>(db, "home", {});
  const buildYear = Number(home.year_built) || null;
  const assets = db.all<any>("SELECT * FROM assets ORDER BY sort");
  const year = Number(todayStr.slice(0, 4));
  return assets
    .filter((a) => a.lifespan_years)
    .map((a) => {
      const installYear = a.install_date ? Number(String(a.install_date).slice(0, 4)) : buildYear;
      const replaceYear = installYear ? installYear + Number(a.lifespan_years) : null;
      return {
        id: a.id, name: a.name, category: a.category, install_year: installYear, lifespan_years: a.lifespan_years,
        replace_year: replaceYear, years_left: replaceYear ? replaceYear - year : null,
        replace_cost: Number(a.replace_cost) || 0,
        monthly_set_aside: replaceYear && a.replace_cost ? (Number(a.replace_cost) || 0) / Math.max(1, (replaceYear - year) * 12) : 0,
      };
    })
    .sort((a, b) => (a.replace_year ?? 9999) - (b.replace_year ?? 9999));
}

export function costBasis(db: Db) {
  const home = getSetting<any>(db, "home", {});
  const spent = db.one<any>("SELECT COALESCE(SUM(cost),0) t FROM projects WHERE status = 'done'")?.t ?? 0;
  const basis = db.one<any>("SELECT COALESCE(SUM(cost),0) t FROM projects WHERE status = 'done' AND adds_basis = 1")?.t ?? 0;
  const price = Number(home.purchase_price) || 0;
  return { improvements_total: Number(spent), basis_adding: Number(basis), purchase_price: price, adjusted_basis: price ? price + Number(basis) : null };
}

export function walkthroughDeadline(db: Db) {
  const home = getSetting<any>(db, "home", {});
  if (!home.close_date) return null;
  return addMonths(home.close_date, 11);
}

export interface Alert {
  kind: string; key: string; title: string; body: string; date: string | null; severity: "high" | "medium" | "low"; link: string;
}

// Everything worth telling the household about today.
export function computeAlerts(db: Db, todayStr: string): Alert[] {
  const out: Alert[] = [];
  const notify = getSetting<any>(db, "notify", {});
  const mode = getSetting<string>(db, "mode", "prepurchase");

  if (mode === "owner") {
    for (const t of taskViews(db, todayStr)) {
      if (t.status === "overdue") {
        out.push({ kind: "task_overdue", key: `${t.id}:${t.next_due}`, title: `Overdue: ${t.name}`, body: `Was due ${fmt(t.next_due!)} (${-t.days_until!} days ago).`, date: t.next_due, severity: "high", link: "#/home/maintenance" });
      } else if (t.status === "due") {
        out.push({ kind: "task_due", key: `${t.id}:${t.next_due}`, title: `Due today: ${t.name}`, body: t.notes || t.area, date: t.next_due, severity: "high", link: "#/home/maintenance" });
      } else if (t.status === "soon") {
        out.push({ kind: "task_soon", key: `${t.id}:${t.next_due}`, title: `Coming up: ${t.name}`, body: `Due ${fmt(t.next_due!)} (in ${t.days_until} days).`, date: t.next_due, severity: "medium", link: "#/home/maintenance" });
      }
    }
    for (const w of warrantyViews(db, todayStr, Number(notify.warranty_days) || 90)) {
      if (w.status === "expiring") {
        out.push({ kind: "warranty_expiring", key: `${w.id}:${w.expires}`, title: `Warranty ending: ${w.name}`, body: `Expires ${fmt(w.expires!)} (${w.days_until} days). Get any claims in first.`, date: w.expires, severity: w.days_until! <= 30 ? "high" : "medium", link: "#/home/warranties" });
      }
    }
    const wt = walkthroughDeadline(db);
    if (wt) {
      const days = daysBetween(todayStr, wt);
      const done = db.one<any>("SELECT COUNT(*) n FROM checklist_items WHERE list='walkthrough11' AND done=1")?.n ?? 0;
      if (days >= 0 && days <= 60 && Number(done) < 13) {
        out.push({ kind: "walkthrough", key: wt, title: "11-month warranty walkthrough", body: `Do it by ${fmt(wt)} (${days} days) so defects are submitted before the workmanship warranty closes.`, date: wt, severity: days <= 21 ? "high" : "medium", link: "#/home/checklists" });
      }
    }
    // Seasonal rituals: nudge on Mar 1 and Oct 1 windows.
    const md = todayStr.slice(5);
    if (md >= "03-01" && md <= "03-31") out.push(seasonal("spring", todayStr.slice(0, 4)));
    if (md >= "10-01" && md <= "10-31") out.push(seasonal("fall", todayStr.slice(0, 4)));
    // Replacement forecast landing within 12 months.
    for (const r of replacementForecast(db, todayStr)) {
      if (r.years_left !== null && r.years_left <= 1) {
        out.push({ kind: "replace_soon", key: `${r.id}:${r.replace_year}`, title: `Plan to replace: ${r.name}`, body: `Estimated end of life around ${r.replace_year}.`, date: null, severity: "low", link: "#/home/systems" });
      }
    }
  } else {
    // Pre-purchase mode: keep the goal and the escrow list in view.
    const goal = db.one<any>("SELECT * FROM goals WHERE name LIKE 'Home Down%' AND done = 0");
    if (goal) out.push({ kind: "goal", key: goal.id, title: "Down payment goal", body: "Track it on the Goals page; escrow and builder questions are ready under House.", date: goal.target_date, severity: "low", link: "#/budget/goals" });
  }

  // Budget alerts (any mode).
  if (notify.budget_alerts !== false) {
    const month = todayStr.slice(0, 7);
    const unc = db.one<any>("SELECT COUNT(*) n FROM transactions WHERE substr(date,1,7) = ? AND (category_id IS NULL OR category_id='')", month)?.n ?? 0;
    if (Number(unc) >= 5) out.push({ kind: "uncategorized", key: `${month}:${Math.floor(Number(unc) / 5)}`, title: `${unc} transactions need a category`, body: "Sort them so this month's budget is accurate.", date: null, severity: "low", link: "#/budget/transactions" });
    const sf = getSetting<any>(db, "simplefin_status", null);
    if (sf && sf.error) out.push({ kind: "bank_sync", key: sf.error_since || todayStr, title: "Bank sync needs attention", body: String(sf.error).slice(0, 140), date: null, severity: "medium", link: "#/budget/accounts" });
  }
  return out;
}

function seasonal(season: "spring" | "fall", year: string): Alert {
  return {
    kind: "seasonal", key: `${season}:${year}`, title: season === "spring" ? "Spring checklist time" : "Fall checklist time",
    body: "Work through the seasonal list under House → Checklists.", date: null, severity: "low", link: "#/home/checklists",
  };
}

export function fmt(d: string) {
  const dt = new Date(d + "T00:00:00Z");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

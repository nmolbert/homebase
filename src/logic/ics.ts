// Calendar feed (.ics) that Apple Calendar and Google Calendar subscribe to.
// One all-day event per upcoming maintenance task, warranty expiry, the
// 11-month walkthrough deadline, seasonal checklist kick-offs and goal dates.
import { Db, getSetting } from "../db.ts";
import { addMonths, taskViews, walkthroughDeadline, warrantyViews } from "./home.ts";

function icsDate(d: string) { return d.replace(/-/g, ""); }
function esc(s: string) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
function fold(line: string) {
  // RFC 5545: lines max 75 octets; fold with CRLF + space.
  const out: string[] = [];
  let s = line;
  while (s.length > 73) { out.push(s.slice(0, 73)); s = " " + s.slice(73); }
  out.push(s);
  return out.join("\r\n");
}

export function buildIcs(db: Db, todayStr: string, baseUrl: string): string {
  const name = getSetting<string>(db, "household_name", "Home Base");
  const mode = getSetting<string>(db, "mode", "prepurchase");
  const events: { uid: string; date: string; end?: string; title: string; desc: string; url?: string }[] = [];

  if (mode === "owner") {
    for (const t of taskViews(db, todayStr)) {
      if (!t.next_due) continue;
      // Emit this occurrence plus the next two so the calendar looks ahead.
      for (let i = 0; i < 3; i++) {
        const d = i === 0 ? t.next_due : addMonths(t.next_due, Number(t.interval_months) * i);
        events.push({ uid: `task-${t.id}-${d}`, date: d, title: `🏠 ${t.name}`, desc: `${t.area || ""}${t.notes ? " — " + t.notes : ""}\nMark it done in Home Base to roll the date forward.`, url: `${baseUrl}/#/home/maintenance` });
      }
    }
    for (const w of warrantyViews(db, todayStr)) {
      if (!w.expires) continue;
      events.push({ uid: `warranty-${w.id}-${w.expires}`, date: w.expires, title: `🛡️ Warranty ends: ${w.name}`, desc: `${w.provider || ""} — ${w.covers || ""}`, url: `${baseUrl}/#/home/warranties` });
      const heads = addMonths(w.expires, -1);
      if (heads > todayStr) events.push({ uid: `warranty-heads-${w.id}-${w.expires}`, date: heads, title: `🛡️ 30 days left: ${w.name} warranty`, desc: "File any claims before it closes.", url: `${baseUrl}/#/home/warranties` });
    }
    const wt = walkthroughDeadline(db);
    if (wt) {
      events.push({ uid: `walkthrough-${wt}`, date: wt, title: "🏠 11-month walkthrough deadline", desc: "Submit the defect list to the builder before the workmanship warranty closes.", url: `${baseUrl}/#/home/checklists` });
      events.push({ uid: `walkthrough-start-${wt}`, date: addMonths(wt, -1), title: "🏠 Start the 11-month walkthrough", desc: "Walk the house, tape every defect, use the checklist in Home Base.", url: `${baseUrl}/#/home/checklists` });
    }
    const y = Number(todayStr.slice(0, 4));
    for (const yr of [y, y + 1]) {
      events.push({ uid: `spring-${yr}`, date: `${yr}-03-01`, title: "🌱 Spring home checklist", desc: "House → Checklists → Spring", url: `${baseUrl}/#/home/checklists` });
      events.push({ uid: `fall-${yr}`, date: `${yr}-10-01`, title: "🍂 Fall home checklist", desc: "House → Checklists → Fall", url: `${baseUrl}/#/home/checklists` });
    }
  }
  for (const g of db.all<any>("SELECT * FROM goals WHERE done = 0 AND target_date IS NOT NULL AND target_date != ''")) {
    events.push({ uid: `goal-${g.id}`, date: g.target_date, title: `🎯 Goal date: ${g.name}`, desc: `Target $${Number(g.target).toLocaleString()}`, url: `${baseUrl}/#/budget/goals` });
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Home Base//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`, "X-WR-TIMEZONE:America/Los_Angeles", "REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H",
  ];
  for (const e of events) {
    const end = e.end || nextDay(e.date);
    lines.push(
      "BEGIN:VEVENT", `UID:${e.uid}@homebase`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
      `DTEND;VALUE=DATE:${icsDate(end)}`, fold(`SUMMARY:${esc(e.title)}`), fold(`DESCRIPTION:${esc(e.desc)}`),
    );
    if (e.url) lines.push(fold(`URL:${e.url}`));
    lines.push("BEGIN:VALARM", "TRIGGER:-PT15H", "ACTION:DISPLAY", fold(`DESCRIPTION:${esc(e.title)}`), "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
function nextDay(d: string) {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

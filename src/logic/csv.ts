// CSV parsing for bank exports (server side, so the same parser serves the
// preview and the import). Handles quotes, embedded commas and newlines.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQ = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

// Guess which columns are date / amount / payee from the header row.
export function guessColumns(header: string[]) {
  const h = header.map((x) => x.toLowerCase().trim());
  const find = (...names: string[]) => h.findIndex((x) => names.some((n) => x === n || x.includes(n)));
  const date = find("date", "posted", "transaction date");
  const amount = find("amount");
  const debit = find("debit", "withdrawal");
  const credit = find("credit", "deposit");
  const payee = find("description", "payee", "merchant", "name", "memo");
  const memo = h.findIndex((x, i) => i !== payee && (x.includes("memo") || x.includes("category") || x.includes("notes")));
  return { date, amount, debit, credit, payee, memo };
}

export function parseAmount(s: string): number {
  if (s == null) return NaN;
  let t = String(s).trim();
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.startsWith("-")) { neg = !neg; t = t.slice(1); }
  t = t.replace(/[$,\s]/g, "");
  const n = Number(t);
  return neg ? -n : n;
}

export function parseDate(s: string): string | null {
  const t = String(s || "").trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

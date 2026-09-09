// Shared-PIN login. The PIN is hashed with PBKDF2; a signed, expiring session
// token lives in an HttpOnly cookie. Five wrong PINs in a row lock the door
// for 15 minutes.
import { Db, getSetting, setSetting } from "../db.ts";

const enc = new TextEncoder();
const SESSION_DAYS = 90;
const B = (u: Uint8Array) => u as unknown as BufferSource;

export function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function hashPin(pin: string, saltB64?: string) {
  const salt = saltB64 ? fromB64url(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: B(salt), iterations: 120000 }, key, 256);
  return `${b64url(salt)}.${b64url(bits)}`;
}
export async function verifyPin(pin: string, stored: string) {
  const [salt] = stored.split(".");
  const h = await hashPin(pin, salt);
  return timingSafeEqual(h, stored);
}
function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function ensureSecret(db: Db, key: string): string {
  let s = getSetting<string>(db, key, "");
  if (!s) {
    s = b64url(crypto.getRandomValues(new Uint8Array(32)));
    setSetting(db, key, s);
  }
  return s;
}

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function makeSession(db: Db): Promise<string> {
  const secret = ensureSecret(db, "session_secret");
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const gen = getSetting<number>(db, "session_generation", 1);
  const payload = `${exp}.${gen}`;
  return `${payload}.${await hmac(secret, payload)}`;
}
export async function checkSession(db: Db, token: string | null): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [exp, gen, sig] = parts;
  if (Number(exp) < Date.now()) return false;
  if (Number(gen) !== getSetting<number>(db, "session_generation", 1)) return false;
  const secret = getSetting<string>(db, "session_secret", "");
  if (!secret) return false;
  return timingSafeEqual(await hmac(secret, `${exp}.${gen}`), sig);
}

export function lockoutState(db: Db) {
  const f = getSetting<{ count: number; until: number }>(db, "pin_failures", { count: 0, until: 0 });
  return { locked: f.until > Date.now(), retry_in: Math.max(0, Math.ceil((f.until - Date.now()) / 1000)), count: f.count };
}
export function recordPinFailure(db: Db) {
  const f = getSetting<{ count: number; until: number }>(db, "pin_failures", { count: 0, until: 0 });
  const count = f.count + 1;
  setSetting(db, "pin_failures", { count, until: count >= 5 ? Date.now() + 15 * 60 * 1000 : 0 });
}
export function clearPinFailures(db: Db) {
  setSetting(db, "pin_failures", { count: 0, until: 0 });
}

export function cookieValue(req: Request, name: string): string | null {
  const c = req.headers.get("cookie") || "";
  for (const part of c.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
export function sessionCookie(token: string, secure: boolean) {
  return `hb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`;
}
export function clearCookie(secure: boolean) {
  return `hb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

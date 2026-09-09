// Web Push without dependencies: VAPID (RFC 8292) + aes128gcm payload
// encryption (RFC 8291 / RFC 8188) using WebCrypto. Keys are generated once
// and stored in settings, so there is nothing to configure.
import { Db, getSetting, setSetting } from "../db.ts";
import { b64url, fromB64url } from "./auth.ts";

const enc = new TextEncoder();
const B = (u: Uint8Array) => u as unknown as BufferSource;

export interface VapidKeys { publicKey: string; privateJwk: JsonWebKey }

export async function ensureVapid(db: Db): Promise<VapidKeys> {
  const pub = getSetting<string>(db, "vapid_public", "");
  const priv = getSetting<JsonWebKey | null>(db, "vapid_private", null);
  if (pub && priv) return { publicKey: pub, privateJwk: priv };
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", kp.publicKey);
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const keys = { publicKey: b64url(rawPub), privateJwk: jwk };
  setSetting(db, "vapid_public", keys.publicKey);
  setSetting(db, "vapid_private", keys.privateJwk);
  return keys;
}

async function vapidAuthHeader(keys: VapidKeys, audience: string, subject: string) {
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const payload = b64url(enc.encode(JSON.stringify({ aud: audience, exp, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${payload}`));
  return `vapid t=${header}.${payload}.${b64url(sig)}, k=${keys.publicKey}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await crypto.subtle.importKey("raw", B(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: B(salt), info: B(info) }, key, len * 8));
}
function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Encrypt `payload` for a subscription (RFC 8291, aes128gcm content coding).
export async function encryptPayload(p256dhB64: string, authB64: string, payload: string) {
  const uaPub = fromB64url(p256dhB64);
  const authSecret = fromB64url(authB64);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localPub = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", B(uaPub), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPub, localPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const plain = concat(enc.encode(payload), new Uint8Array([2])); // padding delimiter
  const aes = await crypto.subtle.importKey("raw", B(cek), "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: B(nonce) }, aes, B(plain)));
  // header: salt(16) | rs(4) | idlen(1) | keyid(65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  const header = concat(salt, rs, new Uint8Array([localPub.length]), localPub);
  return concat(header, cipher);
}

export interface PushSub { id: string; endpoint: string; p256dh: string; auth: string }

export async function sendPush(db: Db, sub: PushSub, data: { title: string; body: string; url?: string; tag?: string }, subject = "mailto:nicholasmolbert@gmail.com") {
  const keys = await ensureVapid(db);
  const url = new URL(sub.endpoint);
  const auth = await vapidAuthHeader(keys, url.origin, subject);
  const body = await encryptPayload(sub.p256dh, sub.auth, JSON.stringify(data));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Authorization": auth, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
      "TTL": "86400", "Urgency": "normal",
    },
    body: B(body) as BodyInit,
  });
  if (res.status === 404 || res.status === 410) {
    db.run("DELETE FROM push_subscriptions WHERE id = ?", sub.id); // gone for good
    return { ok: false, gone: true, status: res.status };
  }
  if (!res.ok) {
    db.run("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?", sub.id);
    return { ok: false, status: res.status, text: (await res.text()).slice(0, 200) };
  }
  db.run("UPDATE push_subscriptions SET failures = 0 WHERE id = ?", sub.id);
  return { ok: true, status: res.status };
}

export async function pushAll(db: Db, data: { title: string; body: string; url?: string; tag?: string }) {
  const subs = db.all<PushSub>("SELECT id, endpoint, p256dh, auth FROM push_subscriptions");
  const results = [];
  for (const s of subs) {
    try { results.push(await sendPush(db, s, data)); } catch (e) { results.push({ ok: false, error: String(e) }); }
  }
  return results;
}

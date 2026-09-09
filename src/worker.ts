// Cloudflare Worker entry. Static files come from public/ (the ASSETS
// binding); everything under /api and /ics goes to the single Household
// Durable Object, which owns the SQLite database.
import { Db, migrate } from "./db.ts";
import { handleApi } from "./api.ts";
import { runCron } from "./logic/notify.ts";

export interface Env {
  HOUSEHOLD: any;
  ASSETS: { fetch(req: Request): Promise<Response> };
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  PUBLIC_URL?: string;
}

const householdStub = (env: Env) => env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName("household"));

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ics/")) {
      return householdStub(env).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const base = env.PUBLIC_URL || "https://homebase.nmolbert.workers.dev";
    ctx.waitUntil(householdStub(env).fetch(new Request(`${base}/__cron`, { method: "POST" })));
  },
};

// Durable Object: one per household (we only ever use one).
export class Household {
  private db: Db;
  private env: Env;
  private ready = false;
  constructor(private state: any, env: Env) {
    this.env = env;
    const sql = state.storage.sql;
    // SqlStorage binds ArrayBuffer for blobs, not Uint8Array.
    const fix = (p: unknown[]) => p.map((v) => v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v);
    this.db = {
      all: (q, ...p) => sql.exec(q, ...fix(p)).toArray(),
      one: (q, ...p) => sql.exec(q, ...fix(p)).toArray()[0],
      run: (q, ...p) => { sql.exec(q, ...fix(p)); },
      exec: (q) => { sql.exec(q); },
    };
  }
  private init() {
    if (this.ready) return;
    migrate(this.db);
    this.ready = true;
  }
  async fetch(req: Request): Promise<Response> {
    this.init();
    const url = new URL(req.url);
    if (url.pathname === "/__cron") {
      const report = await runCron(this.db, this.env, url.origin);
      return new Response(JSON.stringify(report), { headers: { "content-type": "application/json" } });
    }
    return handleApi(req, this.db, this.env);
  }
}

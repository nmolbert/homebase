// Local harness (no node needed): `deno run -A dev/serve.ts` serves public/
// and runs the real API on a SQLite file at dev/data/homebase.db.
//   HB_DB=:memory: for a throwaway database.   PORT=8788 by default.
import { DatabaseSync } from "node:sqlite";
import { Db, migrate } from "../src/db.ts";
import { handleApi } from "../src/api.ts";
import { runCron } from "../src/logic/notify.ts";

const dbPath = Deno.env.get("HB_DB") || new URL("./data/homebase.db", import.meta.url).pathname;
if (dbPath !== ":memory:") await Deno.mkdir(new URL("./data", import.meta.url).pathname, { recursive: true }).catch(() => {});
const sqlite = new DatabaseSync(dbPath);
const db: Db = {
  all: (q, ...p) => sqlite.prepare(q).all(...(p as any[])) as any[],
  one: (q, ...p) => sqlite.prepare(q).get(...(p as any[])) as any,
  run: (q, ...p) => { sqlite.prepare(q).run(...(p as any[])); },
  exec: (q) => sqlite.exec(q),
};
migrate(db);
const env = { RESEND_API_KEY: Deno.env.get("RESEND_API_KEY"), EMAIL_FROM: Deno.env.get("EMAIL_FROM"), DEV: "1" };
const pub = new URL("../public/", import.meta.url).pathname;
const port = Number(Deno.env.get("PORT") || 8788);
const types: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", json: "application/json", webmanifest: "application/manifest+json", svg: "image/svg+xml", png: "image/png", ico: "image/x-icon" };

Deno.serve({ port }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ics/")) return handleApi(req, db, env);
  if (url.pathname === "/__cron") return Response.json(await runCron(db, env, url.origin));
  let p = url.pathname === "/" ? "/index.html" : url.pathname;
  try {
    const data = await Deno.readFile(pub + p);
    const ext = p.split(".").pop() || "";
    return new Response(data, { headers: { "content-type": types[ext] || "application/octet-stream", "cache-control": "no-store" } });
  } catch {
    const data = await Deno.readFile(pub + "/index.html");
    return new Response(data, { headers: { "content-type": types.html, "cache-control": "no-store" } });
  }
});
console.log(`Home Base dev → http://localhost:${port}  (db: ${dbPath})`);

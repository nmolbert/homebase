# Home Base — Nick & Alex's budget + home manual

Read this first. It is the day-one briefing for anyone (human or Claude Code)
touching this repo.

## In plain English

Home Base is a private web app for one household (Nick Molbert and Alex Smick).
It replaces three spreadsheets:

- Nick's **Budget Spreadsheet** (12-month category tracker, savings goals),
- Alex's **Smick Molbert Budget Worksheet** (per-income-source tax model and the
  "where does each month's net go" plan),
- the **Home Manual** workbook (systems, appliances, maintenance calendar,
  warranties, vendors, improvements/cost basis, inventory, checklists).

What it does that the spreadsheets could not: maintenance tasks roll their next
due date forward when marked done, reminders go out on their own (push
notifications, email, and a calendar feed both Apple Calendar and Google
Calendar subscribe to), bank transactions arrive daily through SimpleFIN, and
house costs (a repair, an improvement) post straight into the budget.

Live at **https://homebase.nmolbert.workers.dev**. Shared PIN, no accounts.

## How it is built

- **One Cloudflare Worker** (`src/worker.ts`). Static files in `public/` are
  served as assets; `/api/*` and `/ics/*` go to a single **Durable Object**
  (`Household`) whose SQLite storage IS the database. Nothing to provision:
  `wrangler deploy` creates it. Free plan is enough.
- **Deploy = push to `main`.** Cloudflare's Git integration (Workers Builds)
  runs `npx wrangler deploy`. There is no staging.
- **No node on this Mac.** Everything is checked with Deno
  (`~/nissim-learn-private/bin/deno`) — see "Working locally". Do not add
  tooling that assumes node/npm locally; Cloudflare's build machine has them.
- **Frontend is build-free:** Preact + htm vendored in `public/vendor/`
  (`import { html, useState } from "../vendor/preact-htm.js"`), one page module
  per section under `public/pages/`, shared pieces in `public/ui.js`, the shell
  (router, login, nav, API client) in `public/app.js`. Plain CSS in
  `public/style.css` with light/dark variables.
- **Server code is TypeScript**, bundled by wrangler at deploy time. It runs the
  same in the Durable Object and in the local Deno harness because every query
  goes through the tiny `Db` interface in `src/db.ts`.
- `public/sw.js` is the service worker: offline shell + push handler. **Bump
  `CACHE` when you change app files**, same rule as Nissim Learn.

## Map

| Path | What |
|---|---|
| `wrangler.jsonc` | Worker config: assets, Durable Object, hourly cron, vars. |
| `src/worker.ts` | Entry: routes to assets or the DO; cron → `runCron`. |
| `src/api.ts` | Every HTTP route. Generic CRUD at `/api/t/<table>` with a column allowlist. |
| `src/db.ts` | `Db` interface, schema, settings helpers, row helpers. |
| `src/seed.ts` | First-run data: people, categories, income sources, allocations, goals, and the whole home manual. |
| `src/logic/money.ts` | Paycheck math (Alex's model), monthly envelopes, year grid, goals, net worth, rules. |
| `src/logic/home.ts` | Next-due dates, warranty status, replacement forecast, cost basis, **`computeAlerts`**. |
| `src/logic/notify.ts` | Hourly cron: bank sync at 5am, day-of reminders, weekly digest; dedupes via the `notifications` table. |
| `src/logic/push.ts` | Web Push (VAPID + aes128gcm) with WebCrypto, no dependencies. Keys self-generate. |
| `src/logic/ics.ts` | The calendar feed. |
| `src/logic/simplefin.ts` | SimpleFIN claim + daily sync with dedupe. |
| `src/logic/email.ts` | Resend. Optional; skipped when `RESEND_API_KEY` is unset. |
| `src/logic/auth.ts` | PIN hashing, signed session cookie, lockout. |
| `src/logic/csv.ts` | Bank CSV parsing + column guessing. |
| `public/pages/*.js` | dashboard, budget (+ transactions, paycheck, accounts, goals), home (all house pages), settings, crud (generic list/edit). |
| `dev/serve.ts` | Local harness on Deno + node:sqlite. |
| `test/api_test.ts` | End-to-end API test. Run it before every push. |

## Working locally

```bash
~/nissim-learn-private/bin/deno test -A --no-check test/api_test.ts
~/nissim-learn-private/bin/deno run --watch -A dev/serve.ts   # http://localhost:8788
~/nissim-learn-private/bin/deno check src/worker.ts src/api.ts
```

The dev database is `dev/data/homebase.db` (gitignored). Delete it to start
fresh. `HB_DB=:memory:` for a throwaway run.

## Rules that matter

- **Secrets never leave the server.** `SECRET_SETTINGS` in `src/db.ts` lists
  the settings keys that `/api/bootstrap` and `/api/export` must never return.
  Add to it whenever you store something sensitive in `settings`.
- **Money sign convention:** transactions store money-out as negative. The
  budget page flips expenses positive for display. Monthly-total entries are
  one transaction dated the 1st with `external_id = mt:<month>:<category>`.
- **The tax reserve is not a deduction from net.** Each income source's net is
  already after its estimated tax; the `tax_reserve` allocation only reports how
  much of that to move to the Tax HYSA. Alex's sheet works the same way.
- **Modes.** `settings.mode` is `prepurchase` (default) or `owner`. Maintenance,
  warranty and walkthrough alerts only fire in `owner` mode.
- **Schema changes:** add `ALTER TABLE` steps guarded by `schema_version` in
  `migrate()`; `CREATE TABLE IF NOT EXISTS` alone will not alter existing rows.
- Keep the deploy instructions in `README.md` as **dashboard click paths** —
  Nick runs anything that needs a shell.

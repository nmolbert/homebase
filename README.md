# Home Base

Nick & Alex's household budget and home manual, in one app. Live at
https://homebase.nmolbert.workers.dev once deployed (see below).

## Going live — the steps, in order

You do the dashboard clicks; Claude Code runs the commands.

### 1. Put the code on GitHub (you)

1. Go to https://github.com/new
2. Repository name: `homebase`. Set it to **Private**. Leave everything else
   unchecked (no README, no .gitignore). Click **Create repository**.
3. Tell Claude Code "repo is created" — it will push the code.

### 2. Connect Cloudflare (you)

1. Open https://dash.cloudflare.com → **Workers & Pages** → **Create** →
   **Import a repository** (under "Workers").
2. If GitHub asks, allow Cloudflare to see the `homebase` repository, then pick
   **nmolbert/homebase**.
3. On the setup screen:
   - Project name: `homebase` (this makes the address `homebase.nmolbert.workers.dev`)
   - Build command: leave blank
   - Deploy command: `npx wrangler deploy` (usually pre-filled)
   - Root directory: leave blank
4. Click **Create and Deploy**. The first build takes about a minute. When it
   says "Success", click the `homebase.nmolbert.workers.dev` link.
5. Verify: you should see the **Welcome to Home Base** screen asking for a PIN.
   Choose the PIN you and Alex will share, confirm it, add emails, open the app.

Every later push to `main` redeploys automatically.

### 3. Email reminders (optional, you)

Push notifications and the calendar feed work without this. Email needs a
Resend API key.

1. In Resend → **API Keys** → **Create API Key** (name it `homebase`), copy it.
2. Cloudflare → **Workers & Pages** → **homebase** → **Settings** →
   **Variables and Secrets** → **Add**:
   - Type **Secret**, name `RESEND_API_KEY`, paste the key. Save.
   - Type **Text**, name `EMAIL_FROM`, value like `Home Base <homebase@yourdomain.com>`
     (must be a sender address verified in that Resend account). Save.
3. Click **Deploy** if the dashboard offers it, then in the app go to
   **Settings → Email → Send test**.

Note: Resend's free tier only sends to your own address unless a domain is
verified there. With a verified domain both of you get the emails.

### 4. Your phones (each of you)

1. Open the address in **Safari** on iPhone → Share → **Add to Home Screen**.
2. Open Home Base from the home-screen icon, enter the PIN.
3. **Settings → Push notifications on this device → Turn on push here** →
   Allow. Tap **Send test**.
4. **Settings → Calendar feed**: tap **Open in Apple Calendar** (Nick) or copy
   the link and add it in Google Calendar via *Other calendars → + → From URL*
   (Alex).

### 5. Bank feed (once, either of you)

1. https://bridge.simplefin.org → create an account ($15/yr) → connect each bank.
2. **New App** → copy the setup token.
3. Home Base → **Budget → Accounts → Connect bank (SimpleFIN)** → paste → Connect.
   Transactions sync every morning at 5am; **Sync now** pulls immediately.

### 6. When you buy the house

**Settings → The house**: set the stage to **We own it**, enter the close date,
purchase price and year built, Save. That starts the warranty clocks, the
11-month walkthrough deadline, replacement forecasts and maintenance reminders.
Then on **House → Warranties** tap **Use close date for all**, and on
**House → Maintenance** tap **Log it** on each task the first time you do it.

## Day to day

- **Budget** — type monthly amounts next to categories to set envelopes; switch
  to *Enter totals* to just type what you spent. Tap a category to see its
  transactions. *Year* shows the spreadsheet-style 12-month grid.
- **Transactions** — add, import a bank CSV, or let SimpleFIN fill them in.
  *Rules* auto-categorise by payee text.
- **Paycheck plan** — Alex's model: each income source, its tax rate and
  deferrals → net per month → fixed bills → savings transfers → spending
  available, compared with what the envelopes add up to.
- **House** — mark maintenance done (optionally with a cost that posts to the
  budget), keep systems/appliances/warranties/vendors/records, log projects
  (cost basis), work through checklists.
- **Settings** — PIN, people & emails, reminder times, push, calendar link,
  backup download.

## Developer notes

See `CLAUDE.md`.

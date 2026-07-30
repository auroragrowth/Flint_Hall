# Flint Hall — Project Overview & Handoff

> Single source of truth for continuing this build in **Claude Code** (or any dev).
> Last updated **2026-07-23**. To have Claude Code auto-load this each session,
> copy it to the repo root as `CLAUDE.md` (`cp PROJECT_OVERVIEW.md CLAUDE.md`).

---

## 1. What this is

Flint Hall is the website + internal booking/operations system for a Suffolk wedding & events venue. It's a **buildless static site** (no framework, no bundler, no `package.json`, no npm) where **Supabase is the entire backend**, called directly from the browser.

| File | Served at | What it is | ~lines |
|---|---|---|---|
| `index.html` | `/` | Public marketing site | 1,360 |
| `booking.html` | `/booking` | Lead-capture form **+** authenticated client portal | 2,025 |
| `ops.html` | `/ops` | Staff operations console (auth-gated) | 7,180 |
| `gallery.html` | `/gallery` | Public gallery (reads `gallery_photos` + Storage) | 367 |
| `auth-test.html` | `/auth-test` | Internal auth/RLS diagnostic, `noindex` | 332 |

Each page is **one self-contained file**: its own `<style>` block + one inline `<script>`/`<script type="module">` with all the JS. There is **no shared JS/CSS** — brand CSS custom properties (`--rust`, `--brown-700`, `--linen`, `--gold`…) are copy-pasted at the top of each file's `<style>`. Supabase JS is imported from `esm.sh` (no install/build). No AI/LLM at runtime — it's a CRUD app where triggers keep derived data in sync and RLS decides who can read what.

---

## 2. Deploy workflow (IMPORTANT — this changed)

**`git push origin main` auto-deploys to Vercel production.** The Vercel project (`aurora-growths-projects/flinthall`) is connected to GitHub `auroragrowth/Flint_Hall`; every push to `main` triggers a production deploy in ~1–2 min. There is **no** manual `vercel --prod`, no CI, no preview/PR flow.

- Commit + push = live. Hard-refresh the browser after ~2 min.
- End commit messages with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Confirm an asset is live: `curl -s -o /dev/null -w "%{http_code}" -L https://flinthall.uk/<path>`

`vercel.json`: `cleanUrls` (`booking.html` → `/booking`), a `/padel` rewrite to a Railway app, immutable cache on `/photos/*`, security headers.

---

## 3. Supabase backend

- **Project ref:** `dgrbazpcytwusnsvoaou` (Postgres 17, `eu-west-1`).
- **Client key (publishable, safe in client JS):** `sb_publishable_C5jAgpcN560Eg1zRqFU62g_Es8zRT_t`. Real authz is in **RLS**, not the key.
- **Auth:** magic-link (`signInWithOtp`) + password (`signInWithPassword`). Backend logic *is SQL* — RLS, triggers, `SECURITY DEFINER` RPCs.

### 3a. Tables (all RLS-enabled, `public`)

| Table | Purpose |
|---|---|
| `bookings` | **Central table**, one row per enquiry/event. Flat snake_case columns + `function_sheet` JSONB (running order, suppliers, catering extras). Holds `visit_date`/`visit_time` (viewings), `client_login_*`, contract/financial fields. `dbToBooking`/`bookingToDb` map to/from nested camelCase. |
| `team_members` | **Staff allowlist** — add a row to grant `/ops` access (`email`, `name`, `role`). |
| `email_templates` | Ops email templates — **source of truth** (see §5). |
| `app_settings` | Key/value JSON. `business_settings` (yourName, bacsDetails, deposits) + `contract_template` (contract text). |
| `client_account_requests` | Portal access requests → staff approve. |
| `gallery_photos` | Public gallery metadata (binary in `gallery` bucket). |
| `event_contractors` | Client-declared suppliers + evidence; `booking_id` links the event. |
| `catering_orders` | Client catering orders (trigger rolls cost into `bookings`). |
| `portal_messages` | Two-way client⇄staff messages. |
| `client_documents` | Staff→client files (`client-documents` bucket). |
| `running_order_versions` | Attributed snapshot history of each booking's running order. |
| `invoices` | **Client** quotes+invoices. `doc_type` = `quote`\|`invoice`; auto-numbered `Q-YYYY-NNNN`/`FH-YYYY-NNNN`; jsonb `items`; convert quote→invoice. |
| `staff_invoices` | **Staff timesheets** (Izzy/Jem billing Flint Hall). jsonb `items`, £15/hr, snapshots address/NI/bank. |
| `staff_profiles` | Per-staff invoice details (address, NI, bank). |
| `login_sessions` | Login activity (login_at, last_seen_at, logout_at). |

### 3b. SQL helpers / patterns

- `public.is_team_member()` — caller in `team_members`? Used across staff RLS.
- `public.is_catering()` — caller is `catering@flinthall.uk`? Gates staff-invoice payment + Login Activity.
- Client RLS: `lower(client_email)=lower(auth.jwt()->>'email')`. Client writes that RLS blocks go via `SECURITY DEFINER` RPCs (`save_my_running_order`, `get_payment_info`, `get_my_booking`, `submit_client_account_request`, …).
- Numbering/subtotal/updated_at are `BEFORE INSERT/UPDATE` triggers (`invoices_biu`, `staff_invoices_biu`).
- **Repo migration copies live in `sql/`.** Keep them updated. ⚠️ Some tables (`staff_invoices`, `login_sessions`, `staff_profiles`, plus the foundational `bookings`/`team_members`/etc.) were applied **live only** — they're not fully reconstructable from `sql/`. Add repo copies when you touch them.

### 3c. Edge Functions (Deno, `verify_jwt: true`)

| Function | Role |
|---|---|
| `send-client-email` (v5) | Staff→client email via Resend. `{to,subject,body}` (wrapped) or `{to,subject,html}` (custom, for invoices/quotes). **CCs `info@flinthall.uk`.** |
| `provision-client-login` (v2) | One-click: create/refresh client Auth user, enable portal, email login (CC info@). Uses admin API (correct way to make users). |
| `notify-catering-order` (v3) | Emails catering team + client confirmation; CC info@. |
| `notify-portal-message` | New-message notification. |
| `notify-new-request` / `notify-client-approved` | Portal access lifecycle. |
| `padel-details` | Supports the `/padel` proxied app. |

Source for the ones we edit is in `supabase/functions/<name>/index.ts`.

### 3d. Secrets / config (NEVER commit values)

- `RESEND_API_KEY` — should be a **Supabase Edge Function secret**. ⚠️ Currently **hardcoded as a fallback in `send-client-email`** and was pasted in chat historically → **rotate in Resend + move to the secret**, then delete the fallback. `notify-catering-order` and `provision-client-login` have no fallback (need the secret to send).
- `CLIENT_CC`=`info@flinthall.uk`, `NOTIFY_FROM`=`Flint Hall <noreply@flinthall.uk>`, `REPLY_TO`=`info@flinthall.uk` (edge-function env, defaulted).
- Domain `flinthall.uk` is **verified in Resend** (SPF/DKIM/MX on `send.flinthall.uk`). Email logo: `https://flinthall.uk/email/flinthall-logo.png`.

---

## 4. `/ops` structure

One big `App = {...}` object (state + methods). Hash routing (`applyHashRoute` → `switch` in `render()`), static nav with `data-route` bound in `bindNav()`.
- **Auth gate:** session checked against `team_members`; `window.fhCurrentUser` → `App.state.userEmail`/`isCatering` (set in `init()`). Nav items with `data-catering-only` show only for catering.
- **Bookings** load once into `App.state.bookings`; other data fetched on demand per tab.

**Features:** Dashboard (per-event **journey tracker** dots + outstanding actions) · Calendar (events + **viewings**) · **Events Overview** (financials table + Kanban) · Pipeline (+ Viewing column) · Booking tabs **Details/Payments/Quotes&Invoices/Comms/Running Order/Contract** · Access Requests (status tabs) · Gallery · Supplier Docs (by event) · Catering Orders · **Staff → My Invoices** (timesheets) · **Staff Invoices** + **Login Activity** (catering-only) · Templates · Contract Template · Settings.

Notable: Quotes&Invoices builder has a **food-from-menu dropdown** (covers pre-fill from guest count) + venue/deposit/balance presets + ad-hoc lines; quote↔invoice with convert; branded send/print. **My Invoices** timesheet builder is £15/hr, every line event-linked (except flat expense), address/NI **pop-up** (`staff_profiles`), prints an **unbranded personal invoice** billed *to* Flint Hall.

---

## 5. Email templates & contract (DB-backed — read this before editing)

- **`email_templates` (DB) is the source of truth**, loaded into `App.state.templates`. The `DEFAULT_TEMPLATES` array in `ops.html` **only seeds an empty table on first run**.
- ⚠️ **To change a template, update BOTH the DB row (live) AND the `DEFAULT_TEMPLATES` constant** in `ops.html`. Same for the contract: `app_settings.contract_template` (live) **and** the `DEFAULT_CONTRACT` constant.
- Picker is ordered by client journey (Inquiry→Quote→Booking→Planning→Payment→Pre-event→Post-event).
- Merge fields via `fillMergeFields(text, b)`: `{first_name} {event_date_long} {total_cost} {deposit_amount} {balance_amount} {bacs_details} {your_name} {contract_full} {visit_datetime}` … All sign off **"Many thanks, Justin and Gemma"**.
- Some templates **auto-surface as ops actions**: follow-up (10 quiet days), contract reminder (7 days unsigned), deposit reminder (5 days post-signing).
- **Supabase auth emails** are branded HTML in `email/*.html` — paste into Supabase → Auth → Email Templates.

---

## 6. Editing conventions & verification

- Match surrounding style (inline JS in one object; inline styles; CSS vars).
- **Syntax-check the ops script after every edit** (one stray bracket breaks the app):
  ```bash
  cd ~/code/flinthall
  S=$(grep -n '^<script>' ops.html | tail -1 | cut -d: -f1); S=$((S+1))
  E=$(grep -n '</script>' ops.html | tail -1 | cut -d: -f1); E=$((E-1))
  sed -n "${S},${E}p" ops.html > /tmp/ops_app.js && node --check /tmp/ops_app.js && echo OK
  ```
  For `booking.html`, do the same over its `<script type="module">…</script>`.
- **Optimise photos before committing** (macOS): `sips -Z 1600 -s format jpeg -s formatOptions 80 in.jpg --out out.jpg`. Logos ~340px.
- Static files serve from repo root: `photos/x.jpg` → `flinthall.uk/photos/x.jpg`.

---

## 7. Gotchas (learned the hard way)

1. **Pasted images ≠ files.** A chat-pasted image can't be saved to disk — the real file must be dropped into the repo, then optimised + referenced.
2. **Manual `auth.users` need empty-string tokens.** Set `confirmation_token, recovery_token, email_change, email_change_token_new/current, phone_change, phone_change_token, reauthentication_token` to `''` (not NULL) or sign-in fails **"Database error querying schema"**. Hash with `extensions.crypt(pw, extensions.gen_salt('bf'))`, `email_confirmed_at=now()`, don't insert `auth.identities.email` (generated), `provider_id`=user uuid text. Prefer `provision-client-login` (admin API) when possible.
3. **Templates/contract/settings live in the DB** — editing the HTML constant alone won't change live behaviour (§5).
4. **`.moments-head` heading styles are for dark (`wood-bg`) sections** — on a light (`paper-bg`) section the text is near-invisible; use dark colours on light.
5. **Staff invoices stay unbranded** (individual's invoice *to* Flint Hall). Client invoices/quotes *are* Flint Hall branded. Don't cross them.

---

## 8. People / access

- **Staff (`team_members`, all admin):** `info@flinthall.uk` (Gemma), `izzy@flinthall.uk` (Izzy), `catering@flinthall.uk`, `jussybahar@gmail.com` (Justin), `paulrudland@me.com` (Paul).
- **`catering@flinthall.uk`** = pays staff invoices + sees Login Activity (`is_catering()`).
- **Test client (portal QA):** `testclient@example.com` / `letmein123!`.

---

## 9. Open / roadmap (not yet built)

- **Bride lead-magnet** (requested): a public-site form capturing **name, phone, email** → downloadable **wedding checklist / planning booklet**. Needs a `lead_magnet_signups` table (RLS: anon insert, staff read), a section on `index.html`, PDF delivery (host in repo or email), and lead visibility in `/ops`. Research the most useful magnet (venue-questions checklist, wedding countdown, budget planner) before designing.
- **Weekday-weddings landing page** (20% off, private URL for social).
- **`RESEND_API_KEY` → Supabase secret + rotate**; drop the hardcoded fallback in `send-client-email`.
- Optional: **global Invoices page** (all client invoices, unpaid/overdue filters); outstanding-invoice totals on Events Overview.
- Backfill `sql/` copies for `staff_invoices` / `login_sessions` / `staff_profiles`.

---

## 10. Known risks / tech debt (from the July-11 audit — still relevant)

- **`SECURITY DEFINER` RPCs are `anon`-executable** (`get_my_booking`, `get_my_terms`, `get_payment_info`, `my_portal_status`, `save_my_running_order`, `sign_my_terms`, `submit_client_account_request`). Mostly intentional (anon enquiries), but confirm each one's internal `auth.jwt()` scoping is airtight since they run elevated.
- **Leaked-password protection is off** in Supabase Auth — trivial to enable.
- **Schema-as-code incomplete** — core tables were applied live, not via committed `sql/`; you can't stand up a clean second environment from the repo alone.
- **No tests / CI / staging** — pushes deploy straight to prod against the single prod DB (33 real bookings). Change RLS/schema carefully.
- **No rate limiting** on the public enquiry RPC / form — a flood lands in `client_account_requests` and fires real emails.
- **Duplicated boilerplate** (Supabase init, palette, `escapeHtml`) across all 5 files — every brand tweak is N edits.

---

## 11. Continuing in Claude Code — checklist

1. `git clone https://github.com/auroragrowth/Flint_Hall.git` → work in `~/code/flinthall`.
2. Edit HTML → **syntax-check (§6)** → `git add` → `git commit` (co-author line) → **`git push origin main`** (auto-deploys).
3. DB changes: run SQL on project `dgrbazpcytwusnsvoaou`. With Supabase MCP connected, apply directly; otherwise **paste into Supabase → SQL Editor**. Keep a copy in `sql/`.
4. Edge functions: edit `supabase/functions/<name>/index.ts`; deploy via Supabase MCP or CLI.
5. Remember: **templates / contract / settings are DB-backed** — update the DB, not just the HTML constant.
6. Images must be **real files** in the repo (can't be pasted); optimise before commit.

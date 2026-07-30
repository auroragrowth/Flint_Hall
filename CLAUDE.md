# Flint Hall — Claude Code working notes

**Read [`PROJECT_OVERVIEW.md`](./PROJECT_OVERVIEW.md) first** — it's the full architecture, schema, features, gotchas and roadmap. This file just pins the essentials.

## Must-knows
- **Deploy = `git push origin main`** → Vercel auto-deploys production in ~2 min. No build step, no CI. End commits with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Buildless static site.** Each page (`index.html`, `booking.html`, `ops.html`, `gallery.html`) is one self-contained file with inline `<style>` + `<script>`. No framework, no npm.
- **Supabase is the backend** (project `dgrbazpcytwusnsvoaou`). Authz = RLS. Backend logic = SQL triggers + `SECURITY DEFINER` RPCs.
- **Email templates, the contract, and settings live in the DB** (`email_templates`, `app_settings`). Editing the `DEFAULT_TEMPLATES`/`DEFAULT_CONTRACT` constant in `ops.html` alone does NOT change live behaviour — update the DB row too.
- **Staff timesheet invoices must stay UNBRANDED** (they bill Flint Hall). Client invoices/quotes ARE Flint Hall branded.
- **Images can't be pasted** — real files must be dropped into `photos/`, then optimised (`sips -Z 1600 …`).

## Before committing an `ops.html` / `booking.html` edit — syntax-check the inline script
```bash
S=$(grep -n '^<script>' ops.html | tail -1 | cut -d: -f1); S=$((S+1))
E=$(grep -n '</script>' ops.html | tail -1 | cut -d: -f1); E=$((E-1))
sed -n "${S},${E}p" ops.html > /tmp/ops_app.js && node --check /tmp/ops_app.js && echo OK
```

## DB / edge functions
- SQL: run against project `dgrbazpcytwusnsvoaou` (Supabase MCP if connected, else paste into Supabase SQL Editor). Keep a copy in `sql/`.
- Edge functions: `supabase/functions/<name>/index.ts`.
- Creating `auth.users` by SQL: set all token columns to `''` (not NULL) or sign-in throws "Database error querying schema". See PROJECT_OVERVIEW §7.

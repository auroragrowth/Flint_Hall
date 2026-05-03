# Flint Hall — Website + Operations System

Live at [flinthall.uk](https://flinthall.uk) (public site) and [flinthall.uk/ops](https://flinthall.uk/ops) (staff operations).

## Files

- `index.html` — public marketing site (the one customers see)
- `ops.html` — staff operations system, served at `/ops` after Vercel routing. Supabase-backed, requires sign-in.
- `auth-test.html` — diagnostic page for verifying Supabase auth, served at `/auth-test`. Internal only.
- `photos/` — venue photography + brand logo
- `vercel.json` — caching, security headers, clean URLs config

## Quick reference

### Daily workflow

1. Open this folder in VS Code
2. Edit any file
3. Save
4. Open the integrated terminal and run:
   ```bash
   vercel --prod
   ```

### Connected services

- **Hosting:** Vercel (`aurora-growths-projects/flinthall`)
- **Database & auth:** Supabase project `dgrbazpcytwusnsvoaou`
- **Domain:** flinthall.uk and www.flinthall.uk
- **DNS:** managed at SiteGround (currently); domain itself registered there
- **Email (admin@flinthall.uk):** still routed via SiteGround mail servers — untouched by web migration

### Operations system access

Three people are on the team allowlist (in Supabase `team_members` table):
- Paul Rudland — `paulrudland@me.com`
- Izzy — `info@flinthall.uk`
- Justin Bahar — `jussybahar@gmail.com`

To add or remove someone, run SQL in the Supabase dashboard:
```sql
INSERT INTO public.team_members (email, name, role)
VALUES ('newperson@example.com', 'New Person', 'admin');

-- Or remove:
DELETE FROM public.team_members WHERE email = 'someone@example.com';
```

### Sign-in flow

1. Visit https://flinthall.uk/ops
2. Enter your team email
3. Click the magic link in the email Supabase sends
4. Land back on /ops, signed in
5. Sessions persist for ~30 days

## Git workflow

```bash
git status           # see what's changed
git add .            # stage all changes
git commit -m "..."  # commit with a message
git push             # push to GitHub (if connected — optional)
```

# Flint Hall — Marketing Site

Single-page marketing site for Flint Hall Events. Live at [flinthall.uk](https://flinthall.uk).

## Files

- `index.html` — the public site (the one customers see)
- `auth-test.html` — internal page for testing Supabase auth, reachable at `/auth-test` once deployed. Marked `noindex`. Will be removed once auth is verified.
- `photos/` — venue photography + brand logo (WebP)
- `vercel.json` — caching, security headers, clean URLs config
- `.vercel/` — local link to the Vercel project (auto-created, gitignored)

## Setting up in VS Code

### 1. Open the folder

`File → Open Folder` → select this folder.

### 2. Install recommended extensions

VS Code should prompt you to install the recommended extensions when you open the folder (Live Server, Prettier, Vercel). If not, open the Extensions panel and search for them — `.vscode/extensions.json` lists what's recommended.

### 3. Preview locally

Right-click `index.html` in the file explorer → **Open with Live Server**. Browser opens at `http://127.0.0.1:5500`. Edit any file, save, the browser refreshes automatically.

### 4. Deploy a change

Open the integrated terminal (`View → Terminal` or `` Ctrl+` ``):

```bash
vercel --prod
```

That's it — the `.vercel` folder is already linked, so no questions asked.

## Git workflow

This project is a Git repository. Standard flow:

```bash
git status           # see what's changed
git add .            # stage all changes
git commit -m "..."  # commit with a message
git push             # push to GitHub (if connected)
```

If you push to GitHub and connect the repo to Vercel via the dashboard, deploys will become automatic on every push to the main branch.

## Hosting

- **Production:** Vercel project `flinthall` under `aurora-growths-projects`
- **Domain:** flinthall.uk (apex) and www.flinthall.uk (mirror)
- **DNS:** managed at SiteGround, pointing at Vercel

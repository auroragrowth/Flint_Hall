# Flint Hall — email assets

Hosted logo (served by Vercel from this folder):
`https://flinthall.uk/email/flinthall-logo.png` (340px, optimised for email)
`flinthall-logo-transparent.png` — full-resolution source.

## Supabase auth email templates

Paste the **source** of each file into **Supabase → Authentication → Email Templates → [template] → Save**.
All share the same branded frame and the hosted logo above.

| File | Supabase template | Key variable |
|------|-------------------|--------------|
| `magic-link.html` | Magic Link | `{{ .ConfirmationURL }}` |
| `confirm-signup.html` | Confirm signup | `{{ .ConfirmationURL }}` |
| `invite.html` | Invite user | `{{ .ConfirmationURL }}` |
| `reset-password.html` | Reset Password | `{{ .ConfirmationURL }}` |
| `change-email.html` | Change Email Address | `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}` |
| `reauthentication.html` | Reauthentication | `{{ .Token }}` (6-digit code) |

Note: the Cinzel/Lora web fonts load in clients that support `@import` (Apple Mail, iOS);
everywhere else they fall back to Georgia, which is expected and looks correct.

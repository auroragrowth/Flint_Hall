// Self-service temporary password for staff, requested from the /ops login.
// Verifies the email belongs to a team member, sets a temporary password,
// flags the account (user_metadata.must_reset = true) so they're forced to
// choose their own password on next sign-in, and emails them the temp password.
//
// verify_jwt is FALSE — the requester isn't signed in yet. It only ever acts on
// emails that are on the team_members allowlist, and returns a generic OK either
// way so it can't be used to discover who is/isn't staff.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Set RESEND_API_KEY as a Supabase Edge Function secret. (The live deploy also
// carries a fallback so email works today; move fully to the secret + rotate.)
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const NOTIFY_FROM    = Deno.env.get("NOTIFY_FROM") ?? "Flint Hall <noreply@flinthall.uk>";
const REPLY_TO       = Deno.env.get("REPLY_TO") ?? "info@flinthall.uk";
const OPS_URL        = Deno.env.get("PORTAL_OPS_URL") ?? "https://flinthall.uk/ops";
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sbAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}
function genPassword(): string {
  const words = ["Meadow", "Barn", "Ranch", "Flint", "Willow", "Harvest", "Copper",
                 "Amber", "Hazel", "Bramble", "Orchard", "Thistle", "Foxglove", "Heron"];
  const r = (n: number) => Math.floor(Math.random() * n);
  return `${words[r(words.length)]}-${words[r(words.length)]}-${10 + r(90)}`;
}
async function findUserByEmail(email: string) {
  const want = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sbAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const hit = data.users.find(u => (u.email ?? "").toLowerCase() === want);
    if (hit) return hit;
    if (data.users.length < 200) break;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST")    return json(405, { error: "method_not_allowed" });

  let body: { email?: string } = {};
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json" }); }
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email) return json(400, { error: "missing_email" });

  // Staff only — and stay generic so this can't enumerate accounts.
  const { data: tm } = await sbAdmin.from("team_members").select("email").ilike("email", email).maybeSingle();
  if (!tm) return json(200, { ok: true });
  const user = await findUserByEmail(email);
  if (!user) return json(200, { ok: true });

  const temp = genPassword();
  const { error } = await sbAdmin.auth.admin.updateUserById(user.id, {
    password: temp,
    user_metadata: { ...(user.user_metadata ?? {}), must_reset: true },
  });
  if (error) { console.error("send-temp-password: update failed", error.message); return json(500, { error: "update_failed" }); }

  const subject = "Your temporary Flint Hall password";
  const text = [
    "Hello,",
    "",
    "Here's a temporary password for the Flint Hall operations system:",
    "",
    `    ${temp}`,
    "",
    `Sign in at ${OPS_URL} with your email address and this temporary password.`,
    "You'll then be asked to set your own password.",
    "",
    "If you didn't request this, you can ignore this email — but do change your",
    "password once you're back in, just in case.",
    "",
    "Flint Hall Events",
  ].join("\n");
  const html = `<div style="font-family:Georgia,serif; max-width:520px; margin:0 auto; color:#3a2818;">
    <div style="text-align:center; padding-bottom:14px; border-bottom:1px solid #d4ba8c; margin-bottom:18px;">
      <img src="https://flinthall.uk/email/flinthall-logo.png" alt="Flint Hall Events" width="140" style="max-width:140px; height:auto; border:0;">
    </div>
    <p>Here's a temporary password for the Flint Hall operations system:</p>
    <div style="text-align:center; margin:18px 0;">
      <span style="display:inline-block; font-family:'Cinzel',Georgia,serif; font-size:24px; letter-spacing:3px; color:#a64a18; border:1px solid #b8924a; border-radius:5px; padding:12px 24px;">${esc(temp)}</span>
    </div>
    <p style="font-size:14px;">Sign in at <a href="${esc(OPS_URL)}" style="color:#8c4a2f;">${esc(OPS_URL)}</a> with your email and this temporary password. You'll then be asked to set your own password.</p>
    <p style="font-size:12px; color:#806555;">If you didn't request this, you can ignore this email — but do change your password once you're back in.</p>
    <div style="margin-top:22px; padding-top:14px; border-top:1px solid #d4ba8c; font-style:italic; font-size:12px; color:#806555;">Flint Hall Events &middot; Suffolk</div>
  </div>`;

  if (RESEND_API_KEY) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: NOTIFY_FROM, to: [email], reply_to: REPLY_TO, subject, html, text }),
    });
    if (!r.ok) console.error("send-temp-password: resend failed", r.status, await r.text());
  }
  return json(200, { ok: true });
});

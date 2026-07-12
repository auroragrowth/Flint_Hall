// Provision (or refresh) a client's portal login and email them access.
// Triggered from ops.html by the one-click "Send portal login" action that
// appears once a quote has been sent.
//
// Staff-only: the caller's JWT must belong to a team_members row.
// It will:
//   1. Ensure a Supabase Auth user exists for the booking's client_email
//      (creating it, or resetting the password if it already exists).
//   2. Enable the portal on the booking and store the username/password so
//      staff can see/repeat the credentials in ops.
//   3. Email the client their sign-in details, rendered from the editable
//      `tmpl_login_credentials` email template.
//
// Env (Supabase secrets):
//   RESEND_API_KEY  — Resend API key (if absent, the account is still
//                     provisioned and the password is returned, but no email
//                     is sent — ops shows the password to share manually)
//   NOTIFY_FROM     — From header; default 'Flint Hall <noreply@flinthall.uk>'
//   REPLY_TO        — Reply-To; default 'info@flinthall.uk'
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const NOTIFY_FROM     = Deno.env.get("NOTIFY_FROM") ?? "Flint Hall <noreply@flinthall.uk>";
const REPLY_TO        = Deno.env.get("REPLY_TO") ?? "info@flinthall.uk";
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

// Friendly, memorable password: Word-Word-NN
function genPassword(): string {
  const words = ["Meadow", "Barn", "Ranch", "Flint", "Willow", "Harvest", "Copper",
                 "Amber", "Hazel", "Bramble", "Orchard", "Thistle", "Foxglove", "Heron"];
  const r = (n: number) => Math.floor(Math.random() * n);
  return `${words[r(words.length)]}-${words[r(words.length)]}-${10 + r(90)}`;
}

function fill(tpl: string, map: Record<string, string>): string {
  return String(tpl ?? "").replace(/\{(\w+)\}/g, (m, k) => (map[k] !== undefined ? map[k] : m));
}

async function findUserByEmail(email: string) {
  const want = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sbAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const hit = data.users.find(u => (u.email ?? "").toLowerCase() === want);
    if (hit) return hit;
    if (data.users.length < 200) break; // last page
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST")    return json(405, { error: "method_not_allowed" });

  // --- Auth: caller must be a team member ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json(401, { error: "missing_token" });
  const { data: caller } = await sbAdmin.auth.getUser(jwt);
  const callerEmail = caller?.user?.email?.toLowerCase();
  if (!callerEmail) return json(401, { error: "invalid_token" });
  const { data: staff } = await sbAdmin
    .from("team_members").select("email").ilike("email", callerEmail).maybeSingle();
  if (!staff) return json(403, { error: "not_staff" });

  // --- Input ---
  let body: { booking_id?: string } = {};
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json" }); }
  if (!body.booking_id) return json(400, { error: "missing booking_id" });

  const { data: booking, error: bErr } = await sbAdmin
    .from("bookings")
    .select("id, client_email, client_first_name, client_last_name")
    .eq("id", body.booking_id).maybeSingle();
  if (bErr || !booking) return json(404, { error: "booking_not_found" });
  const email = (booking.client_email ?? "").trim();
  if (!email) return json(400, { error: "booking_has_no_email" });

  // --- Provision auth user ---
  const password = genPassword();
  const existing = await findUserByEmail(email);
  if (existing) {
    const { error } = await sbAdmin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
    if (error) return json(500, { error: "auth_update_failed", detail: error.message });
  } else {
    const { error } = await sbAdmin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) return json(500, { error: "auth_create_failed", detail: error.message });
  }

  // --- Enable portal + store credentials on the booking ---
  const today = new Date().toISOString().slice(0, 10);
  await sbAdmin.from("bookings").update({
    client_portal_enabled: true,
    client_login_username: email,
    client_login_password: password,
    client_login_sent_date: today,
  }).eq("id", booking.id);

  // --- Email the client, rendered from the editable template ---
  const firstName = booking.client_first_name || "there";
  const fullName  = [booking.client_first_name, booking.client_last_name].filter(Boolean).join(" ") || email;
  const { data: settings } = await sbAdmin.from("app_settings").select("value").eq("key", "business_settings").maybeSingle();
  const yourName = (settings?.value?.yourName ?? "Justin and Gemma").toString();

  const { data: tpl } = await sbAdmin
    .from("email_templates").select("subject, body").eq("id", "tmpl_login_credentials").maybeSingle();

  const map: Record<string, string> = {
    first_name: firstName,
    client_full_name: fullName,
    client_email: email,
    login_username: email,
    login_password: password,
    your_name: yourName,
  };
  const subject = fill(tpl?.subject ?? "Your Flint Hall planning login", map);
  const text    = fill(tpl?.body ?? `Sign in at flinthall.uk\nYour email: {client_email}\nPassword: {login_password}`, map);
  const html = `<div style="font-family: Georgia, serif; max-width:560px; margin:0 auto; color:#3a2818; white-space:pre-line; font-size:15px; line-height:1.6;">${esc(text)}</div>`;

  let sent = false;
  if (RESEND_API_KEY) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: NOTIFY_FROM, to: [email], subject, html, text, reply_to: REPLY_TO }),
    });
    if (r.ok) { sent = true; }
    else { console.error("provision-client-login: resend failed", r.status, await r.text()); }
  } else {
    console.warn("provision-client-login: RESEND_API_KEY not set; account provisioned, email skipped");
  }

  return json(200, { ok: true, email, password, sent });
});

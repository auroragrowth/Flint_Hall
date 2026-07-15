// Emails a new catering order to the Flint Hall catering team AND a
// confirmation to the client. Triggered from booking.html after a
// catering_orders row is inserted/updated.
//
// Env (Supabase secrets):
//   RESEND_API_KEY       — Resend API key (if absent, no-ops gracefully)
//   CATERING_NOTIFY_TO   — team recipient(s), comma-separated; default catering@flinthall.uk
//   CLIENT_CC            — CC on the client confirmation; default info@flinthall.uk
//   NOTIFY_FROM          — From header; default 'Flint Hall <noreply@flinthall.uk>'
//   PORTAL_OPS_URL       — ops link; default https://flinthall.uk/ops
//   PORTAL_URL           — client portal link; default https://flinthall.uk/booking
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY     = Deno.env.get("RESEND_API_KEY") ?? "";
const CATERING_NOTIFY_TO = Deno.env.get("CATERING_NOTIFY_TO") ?? "catering@flinthall.uk";
const CLIENT_CC          = Deno.env.get("CLIENT_CC") ?? "info@flinthall.uk";
const NOTIFY_FROM        = Deno.env.get("NOTIFY_FROM") ?? "Flint Hall <noreply@flinthall.uk>";
const PORTAL_OPS_URL     = Deno.env.get("PORTAL_OPS_URL") ?? "https://flinthall.uk/ops";
const PORTAL_URL         = Deno.env.get("PORTAL_URL") ?? "https://flinthall.uk/booking";
const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sbAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>\"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}
function money(n: unknown): string {
  return "£" + Number(n ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function sendEmail(to: string[], subject: string, html: string, text: string, replyTo?: string, cc?: string[]) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: NOTIFY_FROM, to, subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}), ...(cc && cc.length ? { cc } : {}) })
  });
  if (!r.ok) { const detail = await r.text(); console.error("Resend failed:", r.status, detail); return false; }
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST")    return json(405, { error: "method_not_allowed" });

  let body: { order_id?: string } = {};
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json" }); }
  const id = body.order_id;
  if (!id) return json(400, { error: "missing order_id" });

  const { data: order, error } = await sbAdmin
    .from("catering_orders")
    .select("id, client_email, items, subtotal, reference, created_at")
    .eq("id", id).maybeSingle();
  if (error || !order) return json(404, { error: "order_not_found" });

  const { data: booking } = await sbAdmin
    .from("bookings")
    .select("client_first_name, client_last_name, event_date")
    .ilike("client_email", order.client_email)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  const clientName = booking
    ? [booking.client_first_name, booking.client_last_name].filter(Boolean).join(" ")
    : order.client_email;
  const eventDate = booking?.event_date
    ? new Date(booking.event_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : "(not set)";

  const items: Array<{ name: string; unit_price: number; qty: number; line_total: number }> =
    Array.isArray(order.items) ? order.items : [];

  // BACS details for the client's confirmation.
  const { data: settings } = await sbAdmin.from("app_settings").select("value").eq("key", "business_settings").maybeSingle();
  const bacs = (settings?.value?.bacsDetails ?? "").toString();

  if (!RESEND_API_KEY) {
    console.warn("notify-catering-order: RESEND_API_KEY not set; skipping send");
    return json(200, { ok: true, sent: false, reason: "RESEND_API_KEY not configured" });
  }

  const rowsHtml = items.map(it =>
    `<tr><td style="padding:4px 14px 4px 0;">${esc(it.name)}</td><td style="padding:4px 14px 4px 0; text-align:right;">${esc(it.qty)}</td><td style="padding:4px 14px 4px 0; text-align:right;">${money(it.unit_price)}</td><td style="padding:4px 0; text-align:right;">${money(it.line_total)}</td></tr>`
  ).join("");
  const itemsTable = `<table style="width:100%; border-collapse:collapse; font-size:14px; margin-top:8px;">
      <tr style="border-bottom:1px solid #e0d4bf; color:#806555; text-align:left;"><th style="padding:4px 14px 6px 0;">Item</th><th style="padding:4px 14px 6px 0; text-align:right;">Covers</th><th style="padding:4px 14px 6px 0; text-align:right;">Per head</th><th style="padding:4px 0 6px; text-align:right;">Line</th></tr>
      ${rowsHtml}
      <tr style="border-top:2px solid #4a2f23; font-weight:bold;"><td colspan="3" style="padding:8px 14px 0 0; text-align:right;">Total</td><td style="padding:8px 0 0; text-align:right;">${money(order.subtotal)}</td></tr>
    </table>`;
  const itemsText = items.map(it => `  ${it.qty} x ${it.name} @ ${money(it.unit_price)} = ${money(it.line_total)}`).join("\n");

  // 1) Team notification
  const staffHtml = `<div style="font-family: Georgia, serif; max-width:560px; margin:0 auto; color:#3a2818;">
    <h2 style="font-family:'Cinzel',Georgia,serif; color:#4a2f23; margin-bottom:4px;">New catering order</h2>
    <p style="font-style:italic; color:#5c4530; margin-top:0;">${esc(clientName)} has ordered catering through the client portal.</p>
    <table style="font-size:14px; margin:12px 0;">
      <tr><td style="padding:2px 18px 2px 0; color:#806555;">Client</td><td><strong>${esc(clientName)}</strong> &lt;${esc(order.client_email)}&gt;</td></tr>
      <tr><td style="padding:2px 18px 2px 0; color:#806555;">Event date</td><td>${esc(eventDate)}</td></tr>
      <tr><td style="padding:2px 18px 2px 0; color:#806555;">Reference</td><td>${esc(order.reference ?? "")}</td></tr>
    </table>${itemsTable}
    <p style="margin-top:22px;"><a href="${esc(PORTAL_OPS_URL)}" style="background:#4a2f23; color:#f1e6cf; padding:10px 18px; text-decoration:none; border-radius:4px; font-family:sans-serif; font-size:12px; letter-spacing:0.16em; text-transform:uppercase;">Open Ops &rarr;</a></p>
    <p style="font-style:italic; font-size:12px; color:#806555; margin-top:26px;">Flint Hall &middot; Catering</p></div>`;
  const staffText = [`New catering order — ${clientName}`, "", `Client: ${clientName} <${order.client_email}>`, `Event date: ${eventDate}`, `Reference: ${order.reference ?? ""}`, "", itemsText, "", `TOTAL: ${money(order.subtotal)}`].join("\n");

  const staffOk = await sendEmail(
    CATERING_NOTIFY_TO.split(",").map(s => s.trim()).filter(Boolean),
    `New catering order — ${clientName} (${money(order.subtotal)})`, staffHtml, staffText, order.client_email);

  // 2) Client confirmation
  const bacsHtml = bacs
    ? `<div style="margin-top:16px; padding:12px 14px; background:#f6efe0; border-radius:4px; font-size:13px; white-space:pre-line;"><strong style="display:block; color:#a6612f; font-size:11px; letter-spacing:0.12em; text-transform:uppercase; margin-bottom:5px;">Pay by bank transfer</strong>${esc(bacs)}\nReference: ${esc(order.reference ?? "")}</div>`
    : "";
  const clientHtml = `<div style="font-family: Georgia, serif; max-width:560px; margin:0 auto; color:#3a2818;">
    <h2 style="font-family:'Cinzel',Georgia,serif; color:#4a2f23; margin-bottom:4px;">Your catering order is in — thank you!</h2>
    <p style="font-style:italic; color:#5c4530; margin-top:0;">Hi ${esc(booking?.client_first_name ?? "there")}, we’ve received your catering order for ${esc(eventDate)}. Here’s a summary.</p>
    ${itemsTable}${bacsHtml}
    <p style="font-size:13px; margin-top:18px;">A 50% deposit secures your catering; the balance is due before the event. You can review everything any time in your portal.</p>
    <p style="margin-top:14px;"><a href="${esc(PORTAL_URL)}" style="background:#4a2f23; color:#f1e6cf; padding:10px 18px; text-decoration:none; border-radius:4px; font-family:sans-serif; font-size:12px; letter-spacing:0.16em; text-transform:uppercase;">Open my portal &rarr;</a></p>
    <p style="font-style:italic; font-size:12px; color:#806555; margin-top:26px;">Flint Hall Events &middot; Suffolk</p></div>`;
  const clientText = [`Your catering order is in — thank you!`, "", `Event date: ${eventDate}`, "", itemsText, "", `TOTAL: ${money(order.subtotal)}`, "", bacs ? `Pay by bank transfer:\n${bacs}\nReference: ${order.reference ?? ""}` : "", "", `Portal: ${PORTAL_URL}`].join("\n");

  const clientCc = CLIENT_CC.split(",").map(s => s.trim()).filter(a => a && a.toLowerCase() !== String(order.client_email).toLowerCase());
  const clientOk = await sendEmail([order.client_email], `Your Flint Hall catering order (${money(order.subtotal)})`, clientHtml, clientText, CATERING_NOTIFY_TO.split(",")[0].trim(), clientCc);

  return json(200, { ok: true, staff_sent: staffOk, client_sent: clientOk });
});

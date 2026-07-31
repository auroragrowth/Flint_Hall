// Emails a bride her wedding planning checklist after she signs up on index.html.
// Triggered from index.html after the submit_lead_magnet RPC succeeds.
// Sends a branded Resend email with a download button + the PDF attached,
// and BCCs the venue inbox so staff get a heads-up on the new lead.
//
// Required env (Supabase secrets):
//   RESEND_API_KEY   — Resend API key (if absent, function no-ops gracefully)
//   NOTIFY_FROM      — From: header;   defaults to 'Flint Hall <noreply@flinthall.uk>'
//   CLIENT_REPLY_TO  — Reply-To;       defaults to info@flinthall.uk
//   LEAD_NOTIFY_BCC  — staff heads-up;  defaults to info@flinthall.uk
//   CHECKLIST_URL    — hosted PDF;     defaults to https://flinthall.uk/wedding-planning-checklist.pdf

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { encodeBase64 } from "jsr:@std/encoding/base64";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const NOTIFY_FROM    = Deno.env.get("NOTIFY_FROM") ?? "Flint Hall <noreply@flinthall.uk>";
const REPLY_TO       = Deno.env.get("CLIENT_REPLY_TO") ?? "info@flinthall.uk";
const NOTIFY_BCC     = Deno.env.get("LEAD_NOTIFY_BCC") ?? "info@flinthall.uk";
const CHECKLIST_URL  = Deno.env.get("CHECKLIST_URL") ?? "https://flinthall.uk/wedding-planning-checklist.pdf";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
const addrList = (s: string) => s.split(",").map(x => x.trim()).filter(Boolean);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST")    return json(405, { error: "method_not_allowed" });

  let body: { name?: string; email?: string } = {};
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json" }); }

  const name  = (body.name ?? "").trim();
  const email = (body.email ?? "").trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "invalid_email" });
  const firstName = name.split(/\s+/)[0] || "there";

  if (!RESEND_API_KEY) {
    console.warn("send-lead-magnet: RESEND_API_KEY not set; skipping send");
    return json(200, { ok: true, sent: false, reason: "RESEND_API_KEY not configured" });
  }

  // Try to attach the PDF; fall back to a link-only email if the fetch fails.
  let attachments: Array<{ filename: string; content: string }> | undefined;
  try {
    const pdf = await fetch(CHECKLIST_URL);
    if (pdf.ok) {
      const bytes = new Uint8Array(await pdf.arrayBuffer());
      attachments = [{ filename: "Flint Hall — Wedding Planning Checklist.pdf", content: encodeBase64(bytes) }];
    } else {
      console.warn("send-lead-magnet: checklist fetch not ok", pdf.status);
    }
  } catch (e) {
    console.warn("send-lead-magnet: checklist fetch failed", (e as Error).message);
  }

  const subject = "Your wedding planning checklist — Flint Hall";
  const html = `
  <div style="font-family:Georgia,serif; max-width:560px; margin:0 auto; color:#3a2818; font-size:15px; line-height:1.65;">
    <div style="text-align:center; padding-bottom:16px; border-bottom:1px solid #d4ba8c; margin-bottom:22px;">
      <img src="https://flinthall.uk/email/flinthall-logo.png" alt="Flint Hall" width="150" style="display:block; margin:0 auto; max-width:150px; height:auto; border:0;">
    </div>
    <p style="margin:0 0 14px;">Hi ${esc(firstName)},</p>
    <p style="margin:0 0 14px;">Congratulations &mdash; and thank you for downloading <strong>The Wedding Planning Checklist &amp; Countdown Timeline</strong>. It&rsquo;s attached to this email, and you can grab a fresh copy any time using the button below.</p>
    <p style="margin:0 0 22px;">It walks you through every task in the order it needs doing, from the moment you say &ldquo;yes&rdquo; to the morning of your wedding. Print it, tick it off, and let the rest take care of itself.</p>
    <p style="text-align:center; margin:26px 0;">
      <a href="${esc(CHECKLIST_URL)}" style="background:#4a2f23; color:#f1e6cf; padding:13px 26px; text-decoration:none; border-radius:4px; font-family:'Montserrat',Arial,sans-serif; font-size:12px; letter-spacing:0.2em; text-transform:uppercase; display:inline-block;">Download your checklist</a>
    </p>
    <p style="margin:22px 0 14px;">If a Suffolk barn wedding is the picture in your head, we&rsquo;d love to show you ours &mdash; exposed timber, big skies, and room for everyone you love. Just reply to this email whenever you&rsquo;d like to arrange a viewing.</p>
    <p style="margin:0 0 4px;">Warmest wishes,</p>
    <p style="margin:0; font-style:italic; color:#5c4530;">The team at Flint Hall</p>
    <div style="margin-top:26px; padding-top:16px; border-top:1px solid #d4ba8c; font-style:italic; font-size:12px; color:#806555;">
      Flint Hall &middot; Suffolk &middot; <a href="mailto:${esc(REPLY_TO)}" style="color:#8C4A2F;">${esc(REPLY_TO)}</a> &middot; flinthall.uk
    </div>
  </div>`;

  const text = [
    `Hi ${firstName},`,
    "",
    "Congratulations, and thank you for downloading The Wedding Planning Checklist & Countdown Timeline.",
    "It's attached to this email, and you can download a fresh copy any time here:",
    CHECKLIST_URL,
    "",
    "It walks you through every task in the order it needs doing, from the moment you say \"yes\" to the morning of your wedding.",
    "",
    "If a Suffolk barn wedding is the picture in your head, we'd love to show you ours. Just reply to this email to arrange a viewing.",
    "",
    "Warmest wishes,",
    "The team at Flint Hall",
    "Suffolk · flinthall.uk",
  ].join("\n");

  const bcc = addrList(NOTIFY_BCC).filter(a => a.toLowerCase() !== email.toLowerCase());
  const payload: Record<string, unknown> = {
    from: NOTIFY_FROM,
    to: [email],
    reply_to: REPLY_TO,
    subject,
    html,
    text,
  };
  if (bcc.length) payload.bcc = bcc;
  if (attachments) payload.attachments = attachments;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const resBody = await r.text();
  console.log("send-lead-magnet: resend status", r.status, "| to", email, "| attached", Boolean(attachments), "| body", resBody);
  if (!r.ok) { console.error("Resend failed", r.status, resBody); return json(502, { ok: false, error: "send_failed", detail: resBody }); }
  return json(200, { ok: true, sent: true, attached: Boolean(attachments) });
});

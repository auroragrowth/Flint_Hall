-- =============================================================
-- Flint Hall — per-booking WhatsApp chat log (migration: whatsapp_messages)
-- Applied to project dgrbazpcytwusnsvoaou.
-- Staff export a chat from WhatsApp (Export chat → Without media) and
-- upload the .txt under a booking in /ops. The app parses it into
-- individual timestamped messages. Re-uploading a fresh export just adds
-- new messages: each row carries a content hash (msg_key) that is unique
-- per booking, so upserts with ignoreDuplicates never double-count.
-- Internal only — not surfaced in the client portal. Re-uses is_team_member().
-- Safe to re-run (idempotent).
-- =============================================================

create table if not exists public.whatsapp_messages (
  id         uuid primary key default gen_random_uuid(),
  booking_id text not null,
  sent_at    timestamptz,                 -- message's own timestamp (wall-clock, stored as UTC)
  sender     text,                        -- null for WhatsApp system lines
  body       text not null default '',
  msg_key    text not null,               -- content hash: dedupe key across re-exports
  created_at timestamptz not null default now(),
  unique (booking_id, msg_key)
);

create index if not exists whatsapp_messages_booking_idx
  on public.whatsapp_messages (booking_id, sent_at);

-- RLS: staff only (both read and write); never exposed to clients.
alter table public.whatsapp_messages enable row level security;

drop policy if exists wa_all on public.whatsapp_messages;
create policy wa_all on public.whatsapp_messages
  for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

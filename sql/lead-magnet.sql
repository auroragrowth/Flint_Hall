-- =============================================================
-- Flint Hall — Bride lead magnet (wedding planning checklist)
-- Applied to project dgrbazpcytwusnsvoaou (migration: lead_magnet).
-- Public visitors on index.html give name/phone/email to receive the
-- wedding planning checklist PDF by email. The write goes through an
-- anon-granted SECURITY DEFINER RPC (validates + light rate-limit),
-- mirroring submit_client_account_request. Staff read the leads in /ops.
-- Re-uses is_team_member(). Safe to re-run (idempotent).
-- =============================================================

create table if not exists public.lead_magnet_signups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null,
  phone      text,
  magnet     text not null default 'wedding-checklist',  -- which asset they asked for
  source     text,                                        -- where on the site they signed up
  created_at timestamptz not null default now()
);

create index if not exists lead_magnet_signups_email_idx
  on public.lead_magnet_signups (lower(email));
create index if not exists lead_magnet_signups_created_idx
  on public.lead_magnet_signups (created_at desc);

-- -------------------------------------------------------------
-- Anon-callable submit: validates, light-rate-limits, inserts.
-- Raises named errors the browser maps to friendly copy:
--   invalid_name | invalid_email | too_many
-- Runs as owner (SECURITY DEFINER) so it bypasses RLS to insert.
-- -------------------------------------------------------------
create or replace function public.submit_lead_magnet(
  p_name   text,
  p_email  text,
  p_phone  text default null,
  p_magnet text default 'wedding-checklist',
  p_source text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_recent int;
  v_id     uuid;
begin
  if length(v_name) < 1 then
    raise exception 'invalid_name';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email';
  end if;

  -- Light abuse guard: at most 5 signups from one email per day.
  select count(*) into v_recent
  from public.lead_magnet_signups
  where lower(email) = v_email
    and created_at > now() - interval '1 day';
  if v_recent >= 5 then
    raise exception 'too_many';
  end if;

  insert into public.lead_magnet_signups (name, email, phone, magnet, source)
  values (
    v_name,
    v_email,
    nullif(btrim(coalesce(p_phone, '')), ''),
    coalesce(nullif(btrim(coalesce(p_magnet, '')), ''), 'wedding-checklist'),
    nullif(btrim(coalesce(p_source, '')), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.submit_lead_magnet(text, text, text, text, text) to anon, authenticated;

-- -------------------------------------------------------------
-- RLS: staff (team_members) read all; nobody writes via the table
-- directly (writes go through the SECURITY DEFINER RPC above).
-- -------------------------------------------------------------
alter table public.lead_magnet_signups enable row level security;

drop policy if exists lms_select on public.lead_magnet_signups;
create policy lms_select on public.lead_magnet_signups
  for select to authenticated
  using (public.is_team_member());

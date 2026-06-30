-- =============================================================
-- Flint Hall — External Contractor / Supplier evidence system
-- Run once in the Supabase SQL Editor (project dgrbazpcytwusnsvoaou).
-- Scopes everything by the signed-in client's email, so it does NOT
-- depend on the bookings table schema. Re-uses team_members for staff.
-- Safe to re-run (idempotent).
-- =============================================================

-- 0) Pending: add catering@ to the staff allowlist (info@ is already on it)
insert into public.team_members (email, name, role)
values ('catering@flinthall.uk', 'Catering', 'admin')
on conflict (email) do nothing;

-- -------------------------------------------------------------
-- 1) Helper: is the caller a staff / team member?
-- -------------------------------------------------------------
create or replace function public.is_team_member()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members tm
    where lower(tm.email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- -------------------------------------------------------------
-- 2) Table: one row per external contractor a client declares
--    documents = jsonb array of
--      { type, path, filename, uploaded_at }
--    type ∈ 'PLI' | 'PAT' | 'FoodHygiene' | 'RiskAssessment' | 'Other'
-- -------------------------------------------------------------
create table if not exists public.event_contractors (
  id            uuid primary key default gen_random_uuid(),
  client_email  text not null,
  company       text not null,
  contact_name  text,
  contact_phone text,
  contact_email text,
  service       text not null,                         -- what they are doing
  documents     jsonb not null default '[]'::jsonb,
  status        text  not null default 'submitted',    -- submitted | approved | rejected
  staff_notes   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists event_contractors_client_email_idx
  on public.event_contractors (lower(client_email));

-- keep updated_at fresh
create or replace function public.touch_event_contractors()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_touch_event_contractors on public.event_contractors;
create trigger trg_touch_event_contractors
  before update on public.event_contractors
  for each row execute function public.touch_event_contractors();

-- -------------------------------------------------------------
-- 3) Row-level security
--    Clients: full control of their OWN rows (matched by email).
--    Staff:   read + update (to approve/reject + add notes) on all.
-- -------------------------------------------------------------
alter table public.event_contractors enable row level security;

drop policy if exists ec_select on public.event_contractors;
create policy ec_select on public.event_contractors
  for select to authenticated
  using ( lower(client_email) = lower(auth.jwt() ->> 'email')
          or public.is_team_member() );

drop policy if exists ec_insert on public.event_contractors;
create policy ec_insert on public.event_contractors
  for insert to authenticated
  with check ( lower(client_email) = lower(auth.jwt() ->> 'email') );

drop policy if exists ec_update on public.event_contractors;
create policy ec_update on public.event_contractors
  for update to authenticated
  using ( lower(client_email) = lower(auth.jwt() ->> 'email')
          or public.is_team_member() )
  with check ( lower(client_email) = lower(auth.jwt() ->> 'email')
          or public.is_team_member() );

drop policy if exists ec_delete on public.event_contractors;
create policy ec_delete on public.event_contractors
  for delete to authenticated
  using ( lower(client_email) = lower(auth.jwt() ->> 'email')
          or public.is_team_member() );

-- -------------------------------------------------------------
-- 4) Storage bucket for the evidence files (private)
--    Files live under  <client-email>/<uuid>-<filename>
--    so a client can only ever touch their own folder.
-- -------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('contractor-docs', 'contractor-docs', false)
on conflict (id) do nothing;

drop policy if exists cdocs_read on storage.objects;
create policy cdocs_read on storage.objects
  for select to authenticated
  using ( bucket_id = 'contractor-docs'
          and ( (storage.foldername(name))[1] = lower(auth.jwt() ->> 'email')
                or public.is_team_member() ) );

drop policy if exists cdocs_insert on storage.objects;
create policy cdocs_insert on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'contractor-docs'
          and (storage.foldername(name))[1] = lower(auth.jwt() ->> 'email') );

drop policy if exists cdocs_delete on storage.objects;
create policy cdocs_delete on storage.objects
  for delete to authenticated
  using ( bucket_id = 'contractor-docs'
          and ( (storage.foldername(name))[1] = lower(auth.jwt() ->> 'email')
                or public.is_team_member() ) );

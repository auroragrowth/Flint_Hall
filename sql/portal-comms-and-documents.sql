-- =============================================================
-- Flint Hall — Portal messaging + shared documents
-- Applied to project dgrbazpcytwusnsvoaou (migration: portal_comms_and_documents).
-- Two-way client<->staff messages (separate from the internal
-- bookings.communications log) and staff-shared documents the client
-- can download. Edge function notify-portal-message emails the other side.
-- =============================================================

create table if not exists public.portal_messages (
  id           uuid primary key default gen_random_uuid(),
  client_email text not null,
  booking_id   text,
  sender       text not null check (sender in ('client','staff')),
  sender_name  text,
  body         text not null,
  read_by_staff  boolean not null default false,
  read_by_client boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists portal_messages_client_email_idx on public.portal_messages (lower(client_email), created_at);

alter table public.portal_messages enable row level security;
drop policy if exists pm_select on public.portal_messages;
create policy pm_select on public.portal_messages for select to authenticated
  using (lower(client_email)=lower(auth.jwt()->>'email') or public.is_team_member());
drop policy if exists pm_insert on public.portal_messages;
create policy pm_insert on public.portal_messages for insert to authenticated
  with check (
    (lower(client_email)=lower(auth.jwt()->>'email') and sender='client')
    or (public.is_team_member() and sender='staff')
  );
drop policy if exists pm_update on public.portal_messages;
create policy pm_update on public.portal_messages for update to authenticated
  using (lower(client_email)=lower(auth.jwt()->>'email') or public.is_team_member())
  with check (lower(client_email)=lower(auth.jwt()->>'email') or public.is_team_member());

create table if not exists public.client_documents (
  id           uuid primary key default gen_random_uuid(),
  client_email text not null,
  booking_id   text,
  label        text,
  storage_path text not null,
  filename     text not null,
  uploaded_by  uuid,
  created_at   timestamptz not null default now()
);
create index if not exists client_documents_client_email_idx on public.client_documents (lower(client_email));

alter table public.client_documents enable row level security;
drop policy if exists cd_select on public.client_documents;
create policy cd_select on public.client_documents for select to authenticated
  using (lower(client_email)=lower(auth.jwt()->>'email') or public.is_team_member());
drop policy if exists cd_insert on public.client_documents;
create policy cd_insert on public.client_documents for insert to authenticated with check (public.is_team_member());
drop policy if exists cd_update on public.client_documents;
create policy cd_update on public.client_documents for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
drop policy if exists cd_delete on public.client_documents;
create policy cd_delete on public.client_documents for delete to authenticated using (public.is_team_member());

-- Private bucket for staff-shared documents (folder = client email).
insert into storage.buckets (id, name, public) values ('client-documents','client-documents',false)
on conflict (id) do nothing;

drop policy if exists cldocs_read on storage.objects;
create policy cldocs_read on storage.objects for select to authenticated
  using (bucket_id='client-documents' and ((storage.foldername(name))[1]=lower(auth.jwt()->>'email') or public.is_team_member()));
drop policy if exists cldocs_write on storage.objects;
create policy cldocs_write on storage.objects for insert to authenticated
  with check (bucket_id='client-documents' and public.is_team_member());
drop policy if exists cldocs_delete on storage.objects;
create policy cldocs_delete on storage.objects for delete to authenticated
  using (bucket_id='client-documents' and public.is_team_member());

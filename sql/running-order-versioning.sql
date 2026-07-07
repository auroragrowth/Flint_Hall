-- =============================================================
-- Flint Hall — "Running order of the day" versioning
-- Applied to project dgrbazpcytwusnsvoaou (migration: running_order_versioning).
-- Both the client (portal) and staff (ops) can edit the running order
-- (bookings.function_sheet->runningOrder). Every change is snapshotted as a
-- version by a trigger, attributed to client or staff, with shared history.
-- =============================================================

create table if not exists public.running_order_versions (
  id           uuid primary key default gen_random_uuid(),
  booking_id   text,
  client_email text,
  content      jsonb not null,                 -- snapshot of the runningOrder array
  editor       text not null default 'staff',  -- 'client' | 'staff'
  editor_name  text,
  created_at   timestamptz not null default now()
);
create index if not exists running_order_versions_client_idx on public.running_order_versions (lower(client_email), created_at desc);
create index if not exists running_order_versions_booking_idx on public.running_order_versions (booking_id, created_at desc);

alter table public.running_order_versions enable row level security;
drop policy if exists rov_select on public.running_order_versions;
create policy rov_select on public.running_order_versions for select to authenticated
  using (lower(client_email)=lower(auth.jwt()->>'email') or public.is_team_member());
drop policy if exists rov_delete on public.running_order_versions;
create policy rov_delete on public.running_order_versions for delete to authenticated
  using (public.is_team_member());

-- Snapshot on any change to runningOrder. Editor comes from a session setting
-- (set by the client RPC below); defaults to 'staff' for ops saves.
create or replace function public.snapshot_running_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (NEW.function_sheet -> 'runningOrder') is not null
     and (NEW.function_sheet -> 'runningOrder') is distinct from (OLD.function_sheet -> 'runningOrder') then
    insert into public.running_order_versions (booking_id, client_email, content, editor, editor_name)
    values (
      NEW.id, NEW.client_email, NEW.function_sheet -> 'runningOrder',
      coalesce(nullif(current_setting('app.ro_editor', true), ''), 'staff'),
      nullif(current_setting('app.ro_editor_name', true), '')
    );
  end if;
  return null;
end $$;
drop trigger if exists trg_snapshot_running_order on public.bookings;
create trigger trg_snapshot_running_order
  after update on public.bookings
  for each row execute function public.snapshot_running_order();

-- Client saves their running order from the portal (they can't UPDATE bookings directly).
create or replace function public.save_my_running_order(p_rows jsonb, p_editor_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  select * into b from public.bookings
   where client_portal_enabled = true and lower(client_email) = lower(auth.jwt() ->> 'email')
   limit 1;
  if not found then return null; end if;

  perform set_config('app.ro_editor', 'client', true);
  perform set_config('app.ro_editor_name', coalesce(p_editor_name, ''), true);

  update public.bookings
     set function_sheet = coalesce(function_sheet, '{}'::jsonb) || jsonb_build_object('runningOrder', p_rows),
         updated_at = now()
   where id = b.id;

  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.snapshot_running_order() from anon, authenticated, public;
revoke execute on function public.save_my_running_order(jsonb, text) from anon;

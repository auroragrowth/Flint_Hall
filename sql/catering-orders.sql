-- =============================================================
-- Flint Hall — Client catering ordering + invoices
-- Applied to project dgrbazpcytwusnsvoaou (migration: catering_orders_system).
-- Clients place catering orders in the portal; the order feeds the
-- booking's catering_cost (50/50 deposit/balance) and an invoice is
-- shown in the portal with BACS details. Re-uses is_team_member().
-- =============================================================

create table if not exists public.catering_orders (
  id           uuid primary key default gen_random_uuid(),
  client_email text not null,
  booking_id   text,
  items        jsonb not null default '[]'::jsonb,   -- [{name, unit_price, qty, line_total}]
  subtotal     numeric not null default 0,
  status       text not null default 'submitted',    -- submitted | paid | cancelled
  reference    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists catering_orders_client_email_idx
  on public.catering_orders (lower(client_email));

create or replace function public.touch_catering_orders()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_touch_catering_orders on public.catering_orders;
create trigger trg_touch_catering_orders before update on public.catering_orders
  for each row execute function public.touch_catering_orders();

-- Keep the booking's catering cost in sync with the client's active orders (50/50 split).
create or replace function public.sync_booking_catering_cost()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text := coalesce(NEW.client_email, OLD.client_email);
  v_total numeric;
begin
  select coalesce(sum(subtotal),0) into v_total
  from public.catering_orders
  where lower(client_email) = lower(v_email) and status <> 'cancelled';

  update public.bookings
  set catering_cost           = v_total,
      catering_deposit_amount = round(v_total * 0.5, 2),
      catering_balance_amount = round(v_total * 0.5, 2),
      updated_at              = now()
  where lower(client_email) = lower(v_email);

  return null;
end; $$;
drop trigger if exists trg_sync_catering_cost on public.catering_orders;
create trigger trg_sync_catering_cost
  after insert or update or delete on public.catering_orders
  for each row execute function public.sync_booking_catering_cost();

-- RLS: clients manage their own orders; staff (team_members) see all.
alter table public.catering_orders enable row level security;

drop policy if exists co_select on public.catering_orders;
create policy co_select on public.catering_orders for select to authenticated
  using (lower(client_email)=lower(auth.jwt()->>'email') or public.is_team_member());
drop policy if exists co_insert on public.catering_orders;
create policy co_insert on public.catering_orders for insert to authenticated
  with check (lower(client_email)=lower(auth.jwt()->>'email'));
drop policy if exists co_update on public.catering_orders;
create policy co_update on public.catering_orders for update to authenticated
  using (lower(client_email)=lower(auth.jwt()->>'email') or public.is_team_member())
  with check (lower(client_email)=lower(auth.jwt()->>'email') or public.is_team_member());
drop policy if exists co_delete on public.catering_orders;
create policy co_delete on public.catering_orders for delete to authenticated
  using (lower(client_email)=lower(auth.jwt()->>'email') or public.is_team_member());

-- Expose BACS payment details to the portal invoice (read-only).
create or replace function public.get_payment_info()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'bacs', coalesce((select value->>'bacsDetails' from public.app_settings where key='business_settings'), '')
  );
$$;

-- =============================================================
-- Flint Hall — flexible invoicing (migration: invoices)
-- Applied to project dgrbazpcytwusnsvoaou.
-- Staff (ops) create invoices with any mix of auto-pulled and ad-hoc
-- line items; each is auto-numbered FH-YYYY-NNNN and tracked Draft →
-- Sent → Paid. Clients can view their own non-draft invoices in the portal.
-- =============================================================

create table if not exists public.invoices (
  id           uuid primary key default gen_random_uuid(),
  number       text unique,
  booking_id   text,
  client_email text not null,
  status       text not null default 'draft' check (status in ('draft','sent','paid')),
  issued_date  date default current_date,
  due_date     date,
  items        jsonb not null default '[]'::jsonb,   -- [{description, qty, unit_price, amount}]
  subtotal     numeric not null default 0,
  notes        text,
  sent_date    date,
  paid_date    date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists invoices_booking_idx on public.invoices (booking_id);
create index if not exists invoices_client_idx on public.invoices (lower(client_email));

-- Auto-number per year (FH-YYYY-0001) and keep subtotal/updated_at in sync.
create or replace function public.invoices_biu()
returns trigger language plpgsql security definer set search_path = public as $$
declare yr text; n int;
begin
  if TG_OP = 'INSERT' and (new.number is null or new.number = '') then
    yr := to_char(coalesce(new.issued_date, current_date), 'YYYY');
    perform pg_advisory_xact_lock(hashtext('fh_invoice_' || yr));
    select coalesce(max(nullif(regexp_replace(number, '^FH-' || yr || '-', ''), '')::int), 0) + 1
      into n from public.invoices where number like 'FH-' || yr || '-%';
    new.number := 'FH-' || yr || '-' || lpad(n::text, 4, '0');
  end if;
  new.subtotal := coalesce((
    select sum((i->>'amount')::numeric)
    from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) i), 0);
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_invoices_biu on public.invoices;
create trigger trg_invoices_biu before insert or update on public.invoices
  for each row execute function public.invoices_biu();

-- RLS: staff full control; client can read only their own non-draft invoices.
alter table public.invoices enable row level security;
drop policy if exists inv_select on public.invoices;
create policy inv_select on public.invoices for select to authenticated
  using (public.is_team_member()
         or (lower(client_email) = lower(auth.jwt() ->> 'email') and status <> 'draft'));
drop policy if exists inv_insert on public.invoices;
create policy inv_insert on public.invoices for insert to authenticated with check (public.is_team_member());
drop policy if exists inv_update on public.invoices;
create policy inv_update on public.invoices for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
drop policy if exists inv_delete on public.invoices;
create policy inv_delete on public.invoices for delete to authenticated using (public.is_team_member());

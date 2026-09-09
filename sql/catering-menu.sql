-- =============================================================
-- Flint Hall — editable catering menu (migration: catering_menu)
-- Applied to project dgrbazpcytwusnsvoaou.
-- The food & bar options were previously hard-coded in ops.html and
-- booking.html. This table makes them staff-editable in /ops (add/edit/
-- delete). Both the staff builders and the client portal read from it,
-- each falling back to their built-in list if the table is empty/unreachable
-- (so ordering never breaks). Staff seed it on first load of /ops.
-- Public read (the portal + ops need it); writes are staff-only.
-- Safe to re-run (idempotent).
-- =============================================================

create table if not exists public.catering_menu (
  id           uuid primary key default gen_random_uuid(),
  sort         int  not null default 0,
  category     text not null default 'food',      -- 'food' | 'bar'
  name         text not null,
  price        numeric not null default 0,
  pricing      text not null default 'per_head',  -- 'per_head' | 'flat'
  min          int  not null default 0,           -- minimum covers (per-head only)
  unit         text,                               -- flat price suffix, e.g. 'per pack'
  service_time text,                               -- default service time, e.g. '19:30'
  note         text,
  description  text,
  config       jsonb not null default '{}'::jsonb, -- preserves pick-N / options / special
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists catering_menu_sort_idx on public.catering_menu (category, sort);

create or replace function public.touch_catering_menu()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_touch_catering_menu on public.catering_menu;
create trigger trg_touch_catering_menu before update on public.catering_menu
  for each row execute function public.touch_catering_menu();

-- RLS: anyone may read the menu (the portal shows it to clients); only staff write.
alter table public.catering_menu enable row level security;

drop policy if exists cm_select on public.catering_menu;
create policy cm_select on public.catering_menu for select to anon, authenticated using (true);

drop policy if exists cm_write on public.catering_menu;
create policy cm_write on public.catering_menu for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());

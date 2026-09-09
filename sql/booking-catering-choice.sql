-- =============================================================
-- Flint Hall — structured catering choice on a booking
-- Applied to project dgrbazpcytwusnsvoaou (migration: booking_catering_choice).
-- Staff pick, in the booking Details tab, whether catering is Flint Hall
-- in-house or the client is bringing their own caterer; if their own, we
-- capture who is doing it and what they are providing. Additive & nullable.
-- =============================================================

alter table public.bookings add column if not exists event_catering_choice        text;  -- 'Flint Hall catering' | 'Bringing own caterer'
alter table public.bookings add column if not exists event_own_caterer             text;  -- who (company / name)
alter table public.bookings add column if not exists event_own_caterer_details     text;  -- what they are providing

-- Pickup Request workflow. Apply only after validating with the app's existing identity and sync model.
create table if not exists public.pickup_requests (
  id uuid primary key default gen_random_uuid(),
  vehicle_id text not null,
  plate_number text not null,
  origin_location_id text not null,
  destination_type text not null check (destination_type in ('Workshop Bay','Park Accommodation','Reception for Delivery')),
  requested_bay_id text,
  status text not null default 'Requested' check (status in ('Requested','In Transit','Completed','Cancelled')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  accepted_by text, accepted_at timestamptz,
  completed_by text, completed_at timestamptz, final_location_id text,
  cancelled_by text, cancelled_at timestamptz,
  constraint pickup_workshop_destination check (destination_type <> 'Workshop Bay' or requested_bay_id is not null)
);
create unique index if not exists pickup_one_active_per_vehicle on public.pickup_requests (vehicle_id) where status in ('Requested','In Transit');
create index if not exists pickup_status_requested_idx on public.pickup_requests (status, requested_at desc);
alter table public.pickup_requests enable row level security;
grant select, insert, update on public.pickup_requests to authenticated;
create policy "pickup_read_authenticated" on public.pickup_requests for select to authenticated using ((select auth.uid()) is not null);
create policy "pickup_create_authenticated" on public.pickup_requests for insert to authenticated with check ((select auth.uid()) is not null and status = 'Requested' and accepted_by is null and completed_by is null and cancelled_by is null);
-- Direct updates intentionally NOT permitted until a validated RPC implements status transitions and actor checks.
revoke update on public.pickup_requests from authenticated;

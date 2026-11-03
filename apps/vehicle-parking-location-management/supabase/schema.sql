create table if not exists public.workspace_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('Administrator', 'Supervisor', 'TechnicalLeader', 'Operator', 'Drivers', 'Guest Users', 'Others')),
  login_id text,
  user_name text,
  mobile_number text,
  created_at timestamptz not null default now()
);

alter table public.workspace_members
  add column if not exists login_id text,
  add column if not exists user_name text,
  add column if not exists mobile_number text;

alter table public.workspace_members
  drop constraint if exists workspace_members_role_check;
alter table public.workspace_members
  add constraint workspace_members_role_check
  check (role in ('Administrator', 'Supervisor', 'TechnicalLeader', 'Operator', 'Drivers', 'Guest Users', 'Others'));

create unique index if not exists workspace_members_login_id_unique
  on public.workspace_members (lower(login_id))
  where login_id is not null;

create unique index if not exists workspace_members_mobile_number_unique
  on public.workspace_members (mobile_number)
  where mobile_number is not null;

create table if not exists public.workspace_state (
  id smallint primary key check (id = 1),
  state jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

alter table public.workspace_members enable row level security;
alter table public.workspace_state enable row level security;

drop policy if exists "Members can read their own membership" on public.workspace_members;
drop policy if exists "Only AAMOTORS" on public.workspace_members;
create policy "Members can read their own membership"
  on public.workspace_members for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Workspace members can read shared state" on public.workspace_state;
create policy "Workspace members can read shared state"
  on public.workspace_state for select to authenticated
  using (exists (
    select 1 from public.workspace_members
    where user_id = (select auth.uid())
  ));

drop policy if exists "Workspace members can create shared state" on public.workspace_state;
drop policy if exists "Workspace members can save shared state" on public.workspace_state;

drop policy if exists "Workspace members can update shared state" on public.workspace_state;
drop policy if exists "Administrators can create shared state" on public.workspace_state;
drop policy if exists "Administrators can update shared state" on public.workspace_state;

revoke all on public.workspace_members from anon, authenticated;
grant select on public.workspace_members to authenticated;
revoke all on public.workspace_state from anon, authenticated;
grant select on public.workspace_state to authenticated;
grant all on public.workspace_state to service_role;

create table if not exists public.pickup_requests (
  id uuid primary key default gen_random_uuid(),
  vehicle_id text not null,
  plate_number text not null,
  origin_location_id text not null,
  destination_type text not null check (destination_type in ('Workshop Bay', 'Park Accommodation', 'Reception for Delivery')),
  requested_bay_id text,
  status text not null default 'Requested' check (status in ('Requested', 'In Transit', 'Completed', 'Cancelled')),
  requested_by text not null,
  requested_by_id uuid references auth.users (id) on delete set null,
  assigned_to_id uuid references public.workspace_members (user_id) on delete set null,
  assigned_to text,
  requested_at timestamptz not null default now(),
  accepted_by text,
  accepted_by_id uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  completed_by text,
  completed_by_id uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  final_location_id text,
  cancelled_by text,
  cancelled_by_id uuid references auth.users (id) on delete set null,
  cancelled_at timestamptz
);

alter table public.pickup_requests
  add column if not exists requested_by_id uuid references auth.users (id) on delete set null,
  add column if not exists assigned_to_id uuid references public.workspace_members (user_id) on delete set null,
  add column if not exists assigned_to text,
  add column if not exists accepted_by_id uuid references auth.users (id) on delete set null,
  add column if not exists completed_by_id uuid references auth.users (id) on delete set null,
  add column if not exists cancelled_by_id uuid references auth.users (id) on delete set null;

update public.pickup_requests as request
set requested_by_id = member.user_id
from (
  select user_name, min(user_id::text)::uuid as user_id
  from public.workspace_members
  where user_name is not null
  group by user_name
  having count(*) = 1
) as member
where request.requested_by_id is null and request.requested_by = member.user_name;

update public.pickup_requests as request
set accepted_by_id = member.user_id
from (
  select user_name, min(user_id::text)::uuid as user_id
  from public.workspace_members
  where user_name is not null
  group by user_name
  having count(*) = 1
) as member
where request.accepted_by_id is null and request.accepted_by = member.user_name;

update public.pickup_requests as request
set completed_by_id = member.user_id
from (
  select user_name, min(user_id::text)::uuid as user_id
  from public.workspace_members
  where user_name is not null
  group by user_name
  having count(*) = 1
) as member
where request.completed_by_id is null and request.completed_by = member.user_name;

update public.pickup_requests as request
set cancelled_by_id = member.user_id
from (
  select user_name, min(user_id::text)::uuid as user_id
  from public.workspace_members
  where user_name is not null
  group by user_name
  having count(*) = 1
) as member
where request.cancelled_by_id is null and request.cancelled_by = member.user_name;

create index if not exists pickup_requests_requested_at_idx
  on public.pickup_requests (requested_at desc);
create index if not exists pickup_requests_assigned_to_status_idx
  on public.pickup_requests (assigned_to_id, status);

alter table public.pickup_requests enable row level security;
revoke all on public.pickup_requests from anon, authenticated;
grant select, insert, update on public.pickup_requests to authenticated;

drop policy if exists "Workspace members can read pickup requests" on public.pickup_requests;
create policy "Workspace members can read pickup requests"
  on public.pickup_requests for select to authenticated
  using (exists (
    select 1 from public.workspace_members
    where user_id = (select auth.uid())
  ));

drop policy if exists "Workspace members can create pickup requests" on public.pickup_requests;
create policy "Workspace members can create pickup requests"
  on public.pickup_requests for insert to authenticated
  with check (exists (
    select 1 from public.workspace_members
    where user_id = (select auth.uid())
  ));

drop policy if exists "Workspace members can update pickup requests" on public.pickup_requests;
create policy "Workspace members can update pickup requests"
  on public.pickup_requests for update to authenticated
  using (exists (
    select 1 from public.workspace_members
    where user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.workspace_members
    where user_id = (select auth.uid())
  ));

-- Only this boolean lookup bypasses membership RLS; membership rows stay private.
create schema if not exists private;
grant usage on schema private to authenticated;
create or replace function private.is_pickup_driver(driver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (select 1 from public.workspace_members where user_id = auth.uid())
    and exists (select 1 from public.workspace_members where user_id = driver_id and role = 'Drivers');
$$;
revoke all on function private.is_pickup_driver(uuid) from public, anon;
grant execute on function private.is_pickup_driver(uuid) to authenticated;

create or replace function public.enforce_pickup_request_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  caller_role text;
  caller_id uuid := auth.uid();
begin
  select member.role into caller_role
  from public.workspace_members as member
  where member.user_id = caller_id;

  if caller_id is null or caller_role is null then
    raise exception 'Workspace membership is required for pickup requests.';
  end if;

  if tg_op = 'INSERT' then
    if new.requested_by_id is distinct from caller_id or new.status <> 'Requested' then
      raise exception 'Pickup requests must be created by the signed-in requester.';
    end if;
    if (new.assigned_to_id is null and new.assigned_to is not null)
      or (new.assigned_to_id is not null and not private.is_pickup_driver(new.assigned_to_id)) then
      raise exception 'Pickup assignments must target a registered Driver.';
    end if;
    return new;
  end if;

  if old.vehicle_id is distinct from new.vehicle_id
    or old.plate_number is distinct from new.plate_number
    or old.origin_location_id is distinct from new.origin_location_id
    or old.destination_type is distinct from new.destination_type
    or old.requested_bay_id is distinct from new.requested_bay_id
    or old.requested_by is distinct from new.requested_by
    or old.requested_by_id is distinct from new.requested_by_id
    or old.assigned_to_id is distinct from new.assigned_to_id
    or old.assigned_to is distinct from new.assigned_to
    or old.requested_at is distinct from new.requested_at then
    raise exception 'Pickup request details and assignment cannot be changed after submission.';
  end if;

  if old.status = 'Requested' and new.status = 'Cancelled' then
    if caller_role <> 'Administrator' and old.requested_by_id is distinct from caller_id then
      raise exception 'Only an Administrator or the requester can cancel this pickup.';
    end if;
    if new.cancelled_by_id is distinct from caller_id
      or (to_jsonb(new) - array['status', 'cancelled_by', 'cancelled_by_id', 'cancelled_at'])
        is distinct from (to_jsonb(old) - array['status', 'cancelled_by', 'cancelled_by_id', 'cancelled_at']) then
      raise exception 'Invalid pickup cancellation update.';
    end if;
  elsif old.status = 'Requested' and new.status = 'In Transit' then
    if caller_role <> 'Administrator' and old.assigned_to_id is not null and old.assigned_to_id <> caller_id then
      raise exception 'This pickup is assigned to another driver.';
    end if;
    if new.accepted_by_id is distinct from caller_id
      or (to_jsonb(new) - array['status', 'accepted_by', 'accepted_by_id', 'accepted_at'])
        is distinct from (to_jsonb(old) - array['status', 'accepted_by', 'accepted_by_id', 'accepted_at']) then
      raise exception 'Invalid pickup acceptance update.';
    end if;
  elsif old.status = 'In Transit' and new.status = 'Completed' then
    if caller_role <> 'Administrator'
      and old.accepted_by_id is distinct from caller_id
      and not (old.accepted_by_id is null and exists (
        select 1 from public.workspace_members as member
        where member.user_id = caller_id and member.user_name = old.accepted_by
      )) then
      raise exception 'Only the driver who accepted this pickup can complete it.';
    end if;
    if new.completed_by_id is distinct from caller_id
      or (to_jsonb(new) - array['status', 'completed_by', 'completed_by_id', 'completed_at', 'final_location_id'])
        is distinct from (to_jsonb(old) - array['status', 'completed_by', 'completed_by_id', 'completed_at', 'final_location_id']) then
      raise exception 'Invalid pickup completion update.';
    end if;
  else
    raise exception 'This pickup request cannot be changed from its current status.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_pickup_request_changes on public.pickup_requests;
create trigger enforce_pickup_request_changes
  before insert or update on public.pickup_requests
  for each row execute function public.enforce_pickup_request_changes();

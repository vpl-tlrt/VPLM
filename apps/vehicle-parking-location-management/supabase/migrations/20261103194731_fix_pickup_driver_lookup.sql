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

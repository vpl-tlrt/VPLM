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

  if caller_role in ('Administrator', 'Supervisor')
    and old.status = new.status
    and (to_jsonb(new) - array['destination_type', 'requested_bay_id', 'assigned_to_id', 'assigned_to', 'centre_bay_vehicle_id'])
      = (to_jsonb(old) - array['destination_type', 'requested_bay_id', 'assigned_to_id', 'assigned_to', 'centre_bay_vehicle_id']) then
    if new.assigned_to_id is distinct from old.assigned_to_id or new.assigned_to is distinct from old.assigned_to then
      if (new.assigned_to_id is null and new.assigned_to is not null)
        or (new.assigned_to_id is not null and not private.is_pickup_driver(new.assigned_to_id)) then
        raise exception 'Pickup assignments must target a registered Driver.';
      end if;
    end if;
    if new.centre_bay_vehicle_id is not null and new.centre_bay_vehicle_id is distinct from old.centre_bay_vehicle_id then
      raise exception 'A pickup edit cannot add a new Centre Bay move.';
    end if;
    return new;
  end if;

  if old.management_revision is distinct from new.management_revision
    or old.centre_bay_vehicle_id is distinct from new.centre_bay_vehicle_id
    or old.vehicle_id is distinct from new.vehicle_id
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

  if new.status = 'Cancelled' and (old.status = 'Requested' or (old.status = 'In Transit' and caller_role = 'Administrator')) then
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

create or replace function public.pickup_current_vehicle(target_vehicle_id text)
returns table (location_id text, vehicle_status text, x_parking text, workspace_revision bigint)
language sql stable security invoker set search_path = ''
as $$
  select vehicle ->> 'currentLocationId', vehicle ->> 'status', vehicle ->> 'xParking', workspace.revision
  from public.workspace_state as workspace
  cross join lateral jsonb_array_elements((workspace.state ->> 'vehicle-parking-browser-state-v2')::jsonb -> 'vehicles') as vehicle
  where workspace.id = 1 and vehicle ->> 'id' = target_vehicle_id
  limit 1;
$$;

revoke all on function public.pickup_current_vehicle(text) from public, anon;
grant execute on function public.pickup_current_vehicle(text) to authenticated;

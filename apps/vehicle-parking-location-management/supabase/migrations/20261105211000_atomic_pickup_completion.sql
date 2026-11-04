-- The browser supplies only the requested destination and the versions it confirmed.
create or replace function public.complete_pickup_parking(
  request_id uuid, request_revision bigint, workspace_revision bigint,
  expected_origin text, final_bay text, move_centre_occupant boolean default false
) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  member public.workspace_members%rowtype;
  pickup public.pickup_requests%rowtype;
  workspace public.workspace_state%rowtype;
  saved jsonb;
  vehicles jsonb;
  bays jsonb;
  vehicle jsonb;
  target jsonb;
  centre jsonb;
  occupant jsonb;
  original_bay text;
  current_bay text;
  target_count integer;
  actor text;
  stamp timestamptz := now();
  entries jsonb := '[]'::jsonb;
  audits jsonb := '[]'::jsonb;
  moving record;
  after_vehicle jsonb;
begin
  select * into member from public.workspace_members where user_id = caller;
  if caller is null or member.role is null or member.role = 'Guest Users' then
    raise exception 'Pickup completion requires an authorized workspace account.';
  end if;

  select * into pickup from public.pickup_requests where id = request_id for update;
  if not found then raise exception 'Pickup request no longer exists.'; end if;
  if member.role <> 'Administrator'
    and pickup.accepted_by_id is distinct from caller
    and not (pickup.accepted_by_id is null and member.user_name is not null and member.user_name = pickup.accepted_by) then
    raise exception 'Only the accepting driver or an Administrator can finish this pickup.';
  end if;
  select * into workspace from public.workspace_state where id = 1 for update;
  if not found then raise exception 'Workspace unavailable.'; end if;
  if pickup.status = 'Completed' and pickup.completed_by_id = caller and pickup.final_location_id = final_bay then
    return workspace.revision;
  end if;
  if pickup.status <> 'In Transit' or pickup.management_revision <> request_revision then
    raise exception 'The pickup changed. Reopen it and try again.';
  end if;
  if workspace.revision <> workspace_revision then
    raise exception 'The workspace changed. Refresh it before finishing this pickup.';
  end if;
  actor := coalesce(nullif(member.user_name, ''), 'Workspace user');
  saved := (workspace.state ->> 'vehicle-parking-browser-state-v2')::jsonb;
  vehicles := saved -> 'vehicles';
  bays := saved -> 'locations';
  select item into vehicle from jsonb_array_elements(vehicles) item where item ->> 'id' = pickup.vehicle_id;
  current_bay := vehicle ->> 'currentLocationId';
  original_bay := current_bay;
  if current_bay is null or current_bay is distinct from expected_origin or vehicle ->> 'status' = 'Delivered' then
    raise exception 'The vehicle location has changed. Check its current location before finishing.';
  end if;
  select item into target from jsonb_array_elements(bays) item where item ->> 'id' = final_bay;
  if target is null or coalesce(target ->> 'status', '') in ('Reserved', 'Maintenance') then
    raise exception 'The final bay is unavailable.';
  end if;
  if not coalesce(case pickup.destination_type
    when 'Workshop Bay' then ((target ->> 'zone') || ' ' || (target ->> 'bayNumber')) ~* '(workshop|\mbay\M|\mbp[123]\M)'
    when 'Reception for Delivery' then (target ->> 'zone') ~* 'reception'
    when 'Park Accommodation' then target ->> 'zone' in ('A','B','C')
    else false end, false) then
    raise exception 'The final bay does not match the pickup destination.';
  end if;
  select count(*) into target_count from jsonb_array_elements(vehicles) item
    where item ->> 'currentLocationId' = final_bay and item ->> 'id' <> pickup.vehicle_id
      and item ->> 'status' <> 'Delivered' and coalesce(item ->> 'xParking', 'No') <> 'Yes';
  if move_centre_occupant then
    select item into occupant from jsonb_array_elements(vehicles) item
      where item ->> 'id' = pickup.centre_bay_vehicle_id and item ->> 'currentLocationId' = final_bay
        and item ->> 'status' <> 'Delivered' and coalesce(item ->> 'xParking', 'No') <> 'Yes';
    select item into centre from jsonb_array_elements(bays) item where item ->> 'zone' = 'Workshop Centre Bay';
    if pickup.requested_bay_id is distinct from final_bay or target ->> 'zone' <> 'Workshop' or target_count <> 1
      or occupant is null or centre is null or centre ->> 'status' in ('Reserved','Maintenance')
      or (select count(*) from jsonb_array_elements(vehicles) item
          where item ->> 'currentLocationId' = centre ->> 'id' and item ->> 'status' <> 'Delivered') >= coalesce((centre ->> 'capacity')::int, 15) then
      raise exception 'The workshop or Centre Bay has changed. Recheck both parking locations.';
    end if;
  elsif target_count >= (case when target ->> 'lane' = 'Container' then coalesce((target ->> 'capacity')::int, 15) else 1 end) then
    raise exception 'Vehicle Existing not Moved, or parking location is unavailable.';
  end if;
  for moving in
    select occupant as item, centre ->> 'id' as destination where occupant is not null
    union all
    select vehicle, final_bay where current_bay <> final_bay or vehicle ->> 'xParking' = 'Yes'
  loop
    after_vehicle := (moving.item - array['xParkingOccupantPlateNumber','xParkingOccupantModel']) || jsonb_build_object(
      'currentLocationId', moving.destination, 'status', 'Transferred', 'operationalStatus', 'Parked',
      'assignedDate', stamp, 'assignedBy', actor, 'xParking', 'No');
    select jsonb_agg(case when item ->> 'id' = moving.item ->> 'id' then after_vehicle else item end order by ord)
      into vehicles from jsonb_array_elements(vehicles) with ordinality rows(item, ord);
    entries := entries || jsonb_build_array(jsonb_build_object('id', 'mov-' || gen_random_uuid(), 'vehicleId', moving.item ->> 'id',
      'fromLocationId', moving.item ->> 'currentLocationId', 'toLocationId', moving.destination, 'movementType', 'Transfer',
      'actionDateTime', stamp, 'performedBy', actor, 'notes', 'Pickup parking'));
  end loop;

  select jsonb_agg(case when item ->> 'id' in (original_bay, final_bay, centre ->> 'id')
    and coalesce(item ->> 'status','') not in ('Reserved','Maintenance') then item || jsonb_build_object('status',
      case when exists (select 1 from jsonb_array_elements(vehicles) v
        where v ->> 'currentLocationId' = item ->> 'id' and v ->> 'status' <> 'Delivered'
          and coalesce(v ->> 'xParking', 'No') <> 'Yes') then 'Occupied' else 'Available' end)
    else item end order by ord) into bays from jsonb_array_elements(bays) with ordinality rows(item, ord);
  audits := jsonb_build_array(jsonb_build_object('id', 'audit-' || gen_random_uuid(), 'action', 'Pickup completed',
    'entity', 'Vehicle', 'recordId', pickup.vehicle_id, 'actor', actor, 'timestamp', stamp,
    'fromLocationId', original_bay, 'toLocationId', final_bay, 'detail', pickup.plate_number || ' · pickup ' || pickup.id));
  saved := saved || jsonb_build_object('vehicles', vehicles, 'locations', bays,
    'movements', entries || coalesce(saved -> 'movements','[]'::jsonb),
    'auditEvents', audits || coalesce(saved -> 'auditEvents','[]'::jsonb), 'savedAt', stamp);
  update public.workspace_state set state = workspace.state || jsonb_build_object('vehicle-parking-browser-state-v2', saved::text),
    revision = workspace.revision + 1, updated_at = stamp where id = 1;
  update public.pickup_requests set status = 'Completed', completed_by = actor, completed_by_id = caller,
    completed_at = stamp, final_location_id = final_bay where id = request_id;
  return workspace.revision + 1;
end;
$$;

revoke all on function public.complete_pickup_parking(uuid,bigint,bigint,text,text,boolean) from public, anon;
grant execute on function public.complete_pickup_parking(uuid,bigint,bigint,text,text,boolean) to authenticated;

create or replace function private.require_atomic_pickup_completion()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status is distinct from new.status and new.status = 'Completed' and current_user in ('authenticated', 'anon') then
    raise exception 'Use Finish and Complete Parking from the current VPLM version.';
  end if;
  return new;
end;
$$;
drop trigger if exists require_atomic_pickup_completion on public.pickup_requests;
create trigger require_atomic_pickup_completion before update on public.pickup_requests
  for each row execute function private.require_atomic_pickup_completion();

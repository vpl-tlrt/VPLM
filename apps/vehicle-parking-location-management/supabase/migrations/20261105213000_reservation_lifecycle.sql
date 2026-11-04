create or replace function private.advance_vehicle_reservations()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  w public.workspace_state%rowtype;
  snapshot jsonb;
  reservations jsonb;
  bays jsonb;
  maintenance jsonb;
  current_reservation jsonb;
  bay text;
  ending timestamptz;
  beginning timestamptz;
  next_status text;
  ordinal bigint;
  changed boolean := false;
begin
  select * into w from public.workspace_state where id = 1 for update skip locked;
  if not found then return; end if;
  snapshot := (w.state ->> 'vehicle-parking-browser-state-v2')::jsonb;
  reservations := coalesce(snapshot -> 'reservations', '[]'::jsonb);
  bays := coalesce(snapshot -> 'locations', '[]'::jsonb);
  maintenance := coalesce((w.state ->> 'vplm-bay-management-v1')::jsonb, '{}'::jsonb);
  for current_reservation, ordinal in
    select value, ordinality from jsonb_array_elements(reservations) with ordinality
    where value ->> 'status' in ('Upcoming','Active') order by value ->> 'reservationDate', ordinality
  loop
    begin
      beginning := (current_reservation ->> 'reservationDate')::timestamptz;
      ending := coalesce((current_reservation ->> 'endDate')::timestamptz, beginning + interval '1 hour');
    exception when invalid_datetime_format or datetime_field_overflow then continue;
    end;
    bay := current_reservation ->> 'locationId';
    next_status := null;
    if ending <= now() then next_status := 'Expired';
    elsif beginning <= now() and current_reservation ->> 'status' = 'Upcoming'
      and exists(select 1 from jsonb_array_elements(bays) b where b ->> 'id' = bay and b ->> 'status' in ('Available','Reserved'))
      and not exists(select 1 from jsonb_array_elements(snapshot -> 'vehicles') v where v ->> 'currentLocationId' = bay
        and v ->> 'status' <> 'Delivered' and coalesce(v ->> 'xParking','No') <> 'Yes')
      and not exists(select 1 from jsonb_array_elements(reservations) r where r ->> 'locationId' = bay and r ->> 'status' = 'Active')
      and not exists(select 1 from jsonb_array_elements(maintenance -> 'reservations') r where r ->> 'bayId' = bay and r ->> 'status' <> 'Released')
      and not exists(select 1 from jsonb_array_elements(maintenance -> 'maintenance') m where m ->> 'bayId' = bay and m ->> 'status' = 'Active')
    then next_status := 'Active';
    end if;
    if next_status is null then continue; end if;
    changed := true;
    reservations := jsonb_set(reservations, array[(ordinal - 1)::text,'status'], to_jsonb(next_status));
    if next_status = 'Active' or (
      not exists(select 1 from jsonb_array_elements(reservations) r where r ->> 'locationId' = bay and r ->> 'status' = 'Active')
      and not exists(select 1 from jsonb_array_elements(snapshot -> 'vehicles') v where v ->> 'currentLocationId' = bay and v ->> 'status' <> 'Delivered')
      and not exists(select 1 from jsonb_array_elements(maintenance -> 'reservations') r where r ->> 'bayId' = bay and r ->> 'status' <> 'Released')
      and not exists(select 1 from jsonb_array_elements(maintenance -> 'maintenance') m where m ->> 'bayId' = bay and m ->> 'status' = 'Active')
    ) then
      select jsonb_agg(case when b ->> 'id' = bay and b ->> 'status' in ('Available','Reserved')
        then b || jsonb_build_object('status',case when next_status = 'Active' then 'Reserved' else 'Available' end)
        else b end order by ord) into bays from jsonb_array_elements(bays) with ordinality x(b,ord);
    end if;
    snapshot := jsonb_set(snapshot, '{auditEvents}', jsonb_build_array(jsonb_build_object(
      'id', 'audit-' || gen_random_uuid(), 'action', next_status, 'entity', 'Reservation', 'actor', 'Reservation scheduler',
      'timestamp', now(), 'detail', current_reservation ->> 'reservationId', 'toLocationId', bay
    )) || coalesce(snapshot -> 'auditEvents','[]'::jsonb), true);
  end loop;
  if changed then
    snapshot := snapshot || jsonb_build_object('reservations',reservations,'locations',bays,'savedAt',now());
    update public.workspace_state set state = w.state || jsonb_build_object('vehicle-parking-browser-state-v2',snapshot::text),
      revision = w.revision + 1, updated_at = now() where id = 1;
  end if;
end;
$$;
revoke all on function private.advance_vehicle_reservations() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('vplm-reservation-lifecycle', '* * * * *', 'select private.advance_vehicle_reservations()');

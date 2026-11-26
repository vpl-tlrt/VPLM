-- Include the locationless Unassigned Bay tray used by assignment and bulk transfer.
create or replace function vplm_internal.deliver_overdue_parked_vehicles()
returns integer
language plpgsql security definer
set search_path = pg_catalog
as $fn$
declare
  record_state jsonb;
  previous_revision bigint;
  workspace jsonb;
  vehicles jsonb;
  locations jsonb;
  road_tests jsonb;
  movements jsonb;
  rule_label constant text := '2-day Unassigned Bay rule';
  latest_movement jsonb;
  assigned_at timestamptz;
  next_vehicles jsonb := '[]'::jsonb;
  new_movements jsonb := '[]'::jsonb;
  new_audits jsonb := '[]'::jsonb;
  next_locations jsonb;
  v jsonb;
  loc jsonb;
  bay_label text;
  at_time text := to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  stay_since timestamptz;
  count_delivered integer := 0;
begin
  select state, revision into record_state, previous_revision
    from public.workspace_state where id = 1 for update;
  if record_state is null or record_state->>'vehicle-parking-browser-state-v2' is null then
    return 0;
  end if;
  workspace := (record_state->>'vehicle-parking-browser-state-v2')::jsonb;
  vehicles := coalesce(workspace->'vehicles','[]'::jsonb);
  locations := coalesce(workspace->'locations','[]'::jsonb);
  road_tests := coalesce(nullif(record_state->>'vplm-road-tests-v2','')::jsonb,'[]'::jsonb);
  movements := coalesce(workspace->'movements','[]'::jsonb);
  for v in select value from jsonb_array_elements(vehicles) loop
    if v->>'status' in ('Assigned','Transferred')
      and v->>'operationalStatus' is distinct from 'Checked Out'
      and v->>'operationalStatus' is distinct from 'Delivered'
    then
      stay_since := null;
      loc := null;
      if nullif(trim(v->>'currentLocationId'),'') is null then
        -- Direct check-in sets assignedDate. Batch transfers also record a
        -- movement whose snapshot explicitly names the numberless tray.
        if pg_input_is_valid(v->>'assignedDate', 'timestamp with time zone') then
          assigned_at := (v->>'assignedDate')::timestamptz;
          select m.value into latest_movement
            from jsonb_array_elements(movements) with ordinality m(value, position)
            where m.value->>'vehicleId' = v->>'id'
              and pg_input_is_valid(m.value->>'actionDateTime', 'timestamp with time zone')
            order by (m.value->>'actionDateTime')::timestamptz desc, m.position
            limit 1;
          if latest_movement->>'movementType' in ('Assign','Transfer')
            and nullif(trim(latest_movement->>'toLocationId'),'') is null
            and latest_movement #>> '{snapshot,toLocationLabel}' = 'Unassigned Bay'
          then
            stay_since := greatest(assigned_at, (latest_movement->>'actionDateTime')::timestamptz);
          elsif v->>'status' = 'Assigned' and
            (latest_movement is null or assigned_at > (latest_movement->>'actionDateTime')::timestamptz)
          then
            stay_since := assigned_at;
          end if;
        end if;
      else
        select l.value into loc
          from jsonb_array_elements(locations) l(value)
          where lower(trim(l.value->>'id')) = lower(trim(v->>'currentLocationId')) limit 1;
        if loc->>'zone' = 'Unassigned Bay' then
          select max((m.value->>'actionDateTime')::timestamptz) into stay_since
            from jsonb_array_elements(movements) m(value)
            where m.value->>'vehicleId' = v->>'id'
              and lower(trim(m.value->>'toLocationId')) = lower(trim(v->>'currentLocationId'))
              and pg_input_is_valid(m.value->>'actionDateTime', 'timestamp with time zone');
          if stay_since is null
            and pg_input_is_valid(v->>'assignedDate', 'timestamp with time zone')
            and not exists (
              select 1 from jsonb_array_elements(movements) m(value)
              where m.value->>'vehicleId' = v->>'id'
            )
          then
            stay_since := (v->>'assignedDate')::timestamptz;
          end if;
        end if;
      end if;
      if stay_since < now() - interval '48 hours'
        and not exists (select 1 from public.pickup_requests p where
          p.vehicle_id = v->>'id' and p.status in ('Requested','Accepted','In Transit'))
        and not exists (select 1 from jsonb_array_elements(road_tests) rt
          where rt.value->>'vehicleId' = v->>'id' and rt.value->>'status' = 'In Road Test')
      then
        bay_label := 'Unassigned Bay' || case
          when coalesce(loc->>'bayNumber','') = '' then '' else '-' || (loc->>'bayNumber') end;
        new_movements := new_movements || jsonb_build_array(jsonb_build_object(
          'id','mov-'||gen_random_uuid()::text,'vehicleId',v->>'id',
          'fromLocationId',v->>'currentLocationId','movementType','Delivered',
          'actionDateTime',at_time,'performedBy','VPLM Automatic Delivery',
          'notes','Automatically delivered under ' || rule_label));
        new_audits := new_audits || jsonb_build_array(jsonb_build_object(
          'id','audit-'||gen_random_uuid()::text,'action','Automatic Delivery (' || rule_label || ')',
          'entity','Vehicle','detail',(v->>'plateNumber')||' · final bay '||bay_label,
          'actor','VPLM Automatic Delivery','timestamp',at_time,'recordId',v->>'id',
          'fromLocationId',v->>'currentLocationId'));
        v := (v - 'currentLocationId') || jsonb_build_object(
          'status','Delivered','operationalStatus','Delivered','deliveredAt',at_time,
          'deliveredBy','VPLM Automatic Delivery (' || rule_label || ')',
          'finalParkingBay',bay_label,'checkOutAt',at_time);
        count_delivered := count_delivered+1;
      end if;
    end if;
    next_vehicles := next_vehicles || jsonb_build_array(v);
  end loop;
  if count_delivered = 0 then return 0; end if;
  select coalesce(jsonb_agg(
    case
      when l.value->>'status' in ('Reserved','Maintenance') then l.value
      when not exists (select 1 from jsonb_array_elements(new_movements) m(value)
        where lower(trim(m.value->>'fromLocationId')) = lower(trim(l.value->>'id'))) then l.value
      when exists (select 1 from jsonb_array_elements(next_vehicles) as item(value)
        where item.value->>'status' not in ('Delivered','Released')
          and item.value->>'xParking' is distinct from 'Yes'
          and lower(trim(item.value->>'currentLocationId')) = lower(trim(l.value->>'id')))
        then jsonb_set(l.value,'{status}','"Occupied"'::jsonb,true)
      else jsonb_set(l.value,'{status}','"Available"'::jsonb,true)
    end order by l.ordinality), '[]'::jsonb) into next_locations
  from jsonb_array_elements(locations) with ordinality as l(value, ordinality);
  workspace := workspace || jsonb_build_object(
    'vehicles',next_vehicles,'locations',next_locations,
    'movements',new_movements || coalesce(workspace->'movements','[]'::jsonb),
    'auditEvents',new_audits || coalesce(workspace->'auditEvents','[]'::jsonb),
    'savedAt',at_time);
  insert into vplm_internal.delivery_run_backups(affected_count, workspace_revision, before_state)
    values (count_delivered, previous_revision, record_state);
  record_state := jsonb_set(record_state,'{vehicle-parking-browser-state-v2}',to_jsonb(workspace::text),true);
  update public.workspace_state set state=record_state, revision=revision+1, updated_at=now()
    where id=1;
  return count_delivered;
end;
$fn$;
revoke all on function vplm_internal.deliver_overdue_parked_vehicles() from public, anon, authenticated;


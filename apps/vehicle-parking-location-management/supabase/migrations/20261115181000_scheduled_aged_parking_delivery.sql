-- Server-side lifecycle: marking vehicles Delivered after >10 full days in a named bay.
-- This updates the SAME revision-controlled workspace snapshot as the VPLM app.
-- It never deletes vehicle, movement or audit records.
create schema if not exists vplm_internal;
revoke all on schema vplm_internal from public, anon, authenticated;

create or replace function vplm_internal.deliver_overdue_parked_vehicles()
returns integer
language plpgsql security definer
set search_path = pg_catalog
as $fn$
declare
  record_state jsonb;
  workspace jsonb;
  vehicles jsonb;
  locations jsonb;
  road_tests jsonb;
  next_vehicles jsonb := '[]'::jsonb;
  new_movements jsonb := '[]'::jsonb;
  new_audits jsonb := '[]'::jsonb;
  next_locations jsonb;
  v jsonb;
  loc jsonb;
  area text;
  bay_label text;
  at_time text := to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  stay_since timestamptz;
  count_delivered integer := 0;
begin
  select state into record_state
    from public.workspace_state where id = 1 for update;
  if record_state is null or record_state->>'vehicle-parking-browser-state-v2' is null then
    return 0;
  end if;
  workspace := (record_state->>'vehicle-parking-browser-state-v2')::jsonb;
  vehicles := coalesce(workspace->'vehicles','[]'::jsonb);
  locations := coalesce(workspace->'locations','[]'::jsonb);
  road_tests := coalesce(nullif(record_state->>'vplm-road-tests-v2','')::jsonb,'[]'::jsonb);
  for v in select value from jsonb_array_elements(vehicles) loop
    if v->>'status' not in ('Delivered','Released')
      and nullif(v->>'currentLocationId','') is not null
      and nullif(v->>'assignedDate','') is not null
      and v->>'operationalStatus' is distinct from 'Checked Out'
    then
      select value into loc from jsonb_array_elements(locations) as l(value)
        where lower(trim(l.value->>'id')) = lower(trim(v->>'currentLocationId')) limit 1;
      if loc is not null and loc->>'zone' <> 'Unassigned Bay' then
        stay_since := null;
        begin stay_since := (v->>'assignedDate')::timestamptz;
        exception when invalid_datetime_format or datetime_field_overflow then stay_since := null;
        end;
        if stay_since is not null and stay_since < now() - interval '10 days'
          and not exists (select 1 from public.pickup_requests p where
            p.vehicle_id = v->>'id' and p.status in ('Requested','Accepted','In Transit'))
          and not exists (select 1 from jsonb_array_elements(road_tests) rt
            where rt->>'vehicleId' = v->>'id' and rt->>'status' = 'In Road Test')
        then
          area := loc->>'zone';
          bay_label := area || case when coalesce(loc->>'bayNumber','')='' then '' else '-' || loc->>'bayNumber' end;
          new_movements := new_movements || jsonb_build_array(jsonb_build_object(
            'id','mov-'||gen_random_uuid()::text,'vehicleId',v->>'id',
            'fromLocationId',v->>'currentLocationId','movementType','Delivered',
            'actionDateTime',at_time,'performedBy','VPLM Automatic Delivery',
            'notes','Automatically delivered after more than 10 full days in assigned bay'));
          new_audits := new_audits || jsonb_build_array(jsonb_build_object(
            'id','audit-'||gen_random_uuid()::text,'action','Automatic Delivery (10 days)',
            'entity','Vehicle','detail',(v->>'plateNumber')||' · final bay '||bay_label,
            'actor','VPLM Automatic Delivery','timestamp',at_time,'recordId',v->>'id',
            'fromLocationId',v->>'currentLocationId'));
          v := (v - 'currentLocationId') || jsonb_build_object(
            'status','Delivered','operationalStatus','Delivered','deliveredAt',at_time,
            'deliveredBy','VPLM Automatic Delivery (10-day rule)',
            'finalParkingBay',bay_label,'checkOutAt',at_time);
          count_delivered := count_delivered+1;
        end if;
      end if;
    end if;
    next_vehicles := next_vehicles || jsonb_build_array(v);
    loc := null;
  end loop;
  if count_delivered = 0 then return 0; end if;
  select coalesce(jsonb_agg(
    case
      when l.value->>'status' in ('Reserved','Maintenance') then l.value
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
  record_state := jsonb_set(record_state,'{vehicle-parking-browser-state-v2}',to_jsonb(workspace::text),true);
  update public.workspace_state set state=record_state, revision=revision+1, updated_at=now()
    where id=1;
  return count_delivered;
end;
$fn$;
revoke all on function vplm_internal.deliver_overdue_parked_vehicles() from public, anon, authenticated;

-- Frequent small checks avoid dependence on an open admin browser.
select cron.schedule('vplm-aged-vehicle-delivery', '*/15 * * * *',
  'select vplm_internal.deliver_overdue_parked_vehicles();');

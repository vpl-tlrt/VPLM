-- Extend the existing 15-minute automatic-delivery job with a 48-hour Unassigned Bay rule.
-- Retains the 10-day assigned-bay rule and atomic snapshot/audit backup semantics.
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
  delivery_window interval;
  rule_label text;
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
    if v->>'status' not in ('Delivered','Released')
      and nullif(v->>'currentLocationId','') is not null
      and nullif(v->>'assignedDate','') is not null
      and v->>'operationalStatus' is distinct from 'Checked Out'
    then
      select value into loc from jsonb_array_elements(locations) as l(value)
        where lower(trim(l.value->>'id')) = lower(trim(v->>'currentLocationId')) limit 1;
      if loc is not null then
        stay_since := null;
        if loc->>'zone' = 'Unassigned Bay' then
          delivery_window := interval '2 days';
          rule_label := '2-day Unassigned Bay rule';
          -- Use the most recent recorded arrival to this specific unassigned slot.
          -- Never treat the original vehicle registration time as its stay start.
          select max((m.value->>'actionDateTime')::timestamptz) into stay_since
            from jsonb_array_elements(movements) m(value)
            where m.value->>'vehicleId' = v->>'id'
              and lower(trim(m.value->>'toLocationId')) = lower(trim(v->>'currentLocationId'))
              and pg_catalog.pg_input_is_valid(m.value->>'actionDateTime', 'timestamp with time zone');
          -- Legacy entries with no movement at all may use their assignment date.
          if stay_since is null and not exists (
            select 1 from jsonb_array_elements(movements) m(value)
            where m.value->>'vehicleId' = v->>'id'
          ) then
            begin stay_since := (v->>'assignedDate')::timestamptz;
            exception when invalid_datetime_format or datetime_field_overflow then stay_since := null;
            end;
          end if;
        else
          delivery_window := interval '10 days';
          rule_label := '10-day assigned bay rule';
          begin stay_since := (v->>'assignedDate')::timestamptz;
          exception when invalid_datetime_format or datetime_field_overflow then stay_since := null;
          end;
        end if;
        if stay_since is not null and stay_since < now() - delivery_window
          and not exists (select 1 from public.pickup_requests p where
            p.vehicle_id = v->>'id' and p.status in ('Requested','Accepted','In Transit'))
          and not exists (select 1 from jsonb_array_elements(road_tests) rt
            where rt.value->>'vehicleId' = v->>'id' and rt.value->>'status' = 'In Road Test')
        then
          area := loc->>'zone';
          bay_label := area || case when coalesce(loc->>'bayNumber','')='' then '' else '-' || (loc->>'bayNumber') end;
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
  insert into vplm_internal.delivery_run_backups(affected_count, workspace_revision, before_state)
    values (count_delivered, previous_revision, record_state);
  record_state := jsonb_set(record_state,'{vehicle-parking-browser-state-v2}',to_jsonb(workspace::text),true);
  update public.workspace_state set state=record_state, revision=revision+1, updated_at=now()
    where id=1;
  return count_delivered;
end;
$fn$;
revoke all on function vplm_internal.deliver_overdue_parked_vehicles() from public, anon, authenticated;


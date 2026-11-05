-- Limit Realtime event payloads to operational identifiers and parking status.
-- Existing workspace vehicle data (VIN, photos, GPS, customers) is not modified.
create or replace function private.vplm_minimize_vehicle_delta()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.record is not null then
    new.record := jsonb_strip_nulls(jsonb_build_object(
      'id', new.record->'id',
      'plateNumber', new.record->'plateNumber',
      'model', new.record->'model',
      'currentLocationId', new.record->'currentLocationId',
      'xParking', new.record->'xParking',
      'status', new.record->'status',
      'operationalStatus', new.record->'operationalStatus'
    ));
  end if;
  return new;
end;
$$;
revoke all on function private.vplm_minimize_vehicle_delta() from public, anon, authenticated;
drop trigger if exists vplm_vehicle_delta_minimize_trg on public.vplm_vehicle_delta_events;
create trigger vplm_vehicle_delta_minimize_trg
  before insert or update of record on public.vplm_vehicle_delta_events
  for each row execute function private.vplm_minimize_vehicle_delta();
update public.vplm_vehicle_delta_events set record = record where record is not null;

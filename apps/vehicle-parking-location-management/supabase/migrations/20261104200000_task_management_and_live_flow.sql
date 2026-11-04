alter table public.pickup_requests add column if not exists management_revision bigint not null default 0;

grant delete on public.pickup_requests to authenticated;
drop policy if exists "Managers can delete pickup requests" on public.pickup_requests;
create policy "Managers can delete pickup requests"
  on public.pickup_requests for delete to authenticated
  using (exists (
    select 1 from public.workspace_members
    where user_id = (select auth.uid()) and role in ('Administrator', 'Supervisor')
  ));

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

create or replace function private.bump_pickup_management_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.management_revision := old.management_revision + 1;
  return new;
end;
$$;

drop trigger if exists zz_pickup_management_revision on public.pickup_requests;
create trigger zz_pickup_management_revision before update on public.pickup_requests
  for each row execute function private.bump_pickup_management_revision();

create table if not exists public.application_flow_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  source text not null,
  action text not null,
  reference text not null
);

alter table public.application_flow_events enable row level security;
revoke all on public.application_flow_events from anon, authenticated;
grant select on public.application_flow_events to authenticated;
drop policy if exists "Administrators can view application flow" on public.application_flow_events;
create policy "Administrators can view application flow" on public.application_flow_events for select to authenticated
  using (exists (
    select 1 from public.workspace_members
    where user_id = (select auth.uid()) and role = 'Administrator'
  ));

create or replace function private.record_application_flow()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  event_action text;
  event_reference text;
  newest_id bigint;
  previous_state jsonb;
  next_state jsonb;
begin
  if tg_table_name = 'pickup_requests' then
    if tg_op = 'DELETE' then
      event_action := 'Deleted';
      event_reference := old.plate_number;
    else
      event_action := case when tg_op = 'INSERT' then 'Requested'
        when new.status = old.status then 'Edited' else new.status end;
      event_reference := new.plate_number;
    end if;
  else
    event_action := 'Workspace synced';
    event_reference := 'Revision ' || new.revision;
    if tg_op = 'UPDATE' then
      begin
        previous_state := (old.state ->> 'vehicle-parking-browser-state-v2')::jsonb;
        next_state := (new.state ->> 'vehicle-parking-browser-state-v2')::jsonb;
        insert into public.application_flow_events(source, action, reference)
          select left(coalesce(entry ->> 'entity', 'Workspace'), 60),
            left(coalesce(entry ->> 'action', 'Updated'), 60),
            left(coalesce(entry ->> 'recordId', entry ->> 'id', '—'), 100)
          from jsonb_array_elements(next_state -> 'auditEvents') with ordinality as incoming(entry, position)
          where not exists (select 1 from jsonb_array_elements(previous_state -> 'auditEvents') as previous(item)
            where previous.item ->> 'id' = incoming.entry ->> 'id')
          order by position desc;
        insert into public.application_flow_events(source, action, reference)
          select 'Road test', left(coalesce(entry ->> 'action', 'Updated'), 60),
            left(coalesce(entry ->> 'roadTestId', '—'), 100)
          from jsonb_array_elements((new.state ->> 'vplm-road-test-audit-v2')::jsonb) with ordinality as incoming(entry, position)
          where not exists (select 1 from jsonb_array_elements((old.state ->> 'vplm-road-test-audit-v2')::jsonb) as previous(item)
            where previous.item ->> 'id' = incoming.entry ->> 'id')
          order by position desc;
      exception when invalid_text_representation or invalid_parameter_value then
        -- A malformed legacy snapshot must not interrupt a workspace save.
        null;
      end;
    end if;
  end if;

  insert into public.application_flow_events(source, action, reference)
    values (case when tg_table_name = 'pickup_requests' then 'Pickup' else 'Workspace' end,
      event_action, left(event_reference, 100))
    returning id into newest_id;
  if newest_id % 100 = 0 or tg_table_name = 'workspace_state' then
    delete from public.application_flow_events where id < newest_id - 2000;
  end if;
  return null;
end;
$$;

revoke all on function private.record_application_flow() from public, anon, authenticated;
drop trigger if exists record_pickup_application_flow on public.pickup_requests;
create trigger record_pickup_application_flow after insert or update or delete on public.pickup_requests
  for each row execute function private.record_application_flow();
drop trigger if exists record_workspace_application_flow on public.workspace_state;
create trigger record_workspace_application_flow after insert or update on public.workspace_state
  for each row execute function private.record_application_flow();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'application_flow_events') then
    alter publication supabase_realtime add table public.application_flow_events;
  end if;
end;
$$;

-- Sidecar incremental event stream. Existing workspace_state remains authoritative.
-- This migration does not alter, reset, delete or rewrite vehicle records.
create table if not exists public.vplm_vehicle_delta_events (
  id bigint generated always as identity primary key,
  workspace_revision bigint not null,
  vehicle_id text not null,
  operation text not null check (operation in ('insert','update','delete','snapshot')),
  record jsonb,
  emitted_at timestamptz not null default now(),
  unique (workspace_revision, vehicle_id)
);
create index if not exists vplm_vehicle_delta_revision_idx
  on public.vplm_vehicle_delta_events (workspace_revision, id);
alter table public.vplm_vehicle_delta_events enable row level security;
revoke all on public.vplm_vehicle_delta_events from anon, authenticated;
grant select on public.vplm_vehicle_delta_events to authenticated;
grant all on public.vplm_vehicle_delta_events to service_role;
drop policy if exists "Workspace members can read vehicle deltas" on public.vplm_vehicle_delta_events;
create policy "Workspace members can read vehicle deltas"
  on public.vplm_vehicle_delta_events for select to authenticated
  using (exists (select 1 from public.workspace_members where user_id = (select auth.uid())));

create or replace function private.vplm_capture_vehicle_delta()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  old_vehicles jsonb := '[]'::jsonb;
  new_vehicles jsonb := '[]'::jsonb;
begin
  if old.state->>'vehicle-parking-browser-state-v2'
       is not distinct from new.state->>'vehicle-parking-browser-state-v2' then
    return new;
  end if;
  begin
    old_vehicles := coalesce((old.state->>'vehicle-parking-browser-state-v2')::jsonb->'vehicles', '[]'::jsonb);
    new_vehicles := coalesce((new.state->>'vehicle-parking-browser-state-v2')::jsonb->'vehicles', '[]'::jsonb);
    if jsonb_typeof(old_vehicles) <> 'array' or jsonb_typeof(new_vehicles) <> 'array' then
      return new;
    end if;
    with previous as (
      select value->>'id' vehicle_id, value payload from jsonb_array_elements(old_vehicles)
    ), current_rows as (
      select value->>'id' vehicle_id, value payload from jsonb_array_elements(new_vehicles)
    )
    insert into public.vplm_vehicle_delta_events(workspace_revision, vehicle_id, operation, record)
    select new.revision, coalesce(c.vehicle_id,p.vehicle_id),
      case when p.vehicle_id is null then 'insert'
           when c.vehicle_id is null then 'delete'
           else 'update' end,
      c.payload
    from previous p full join current_rows c on p.vehicle_id = c.vehicle_id
    where coalesce(c.vehicle_id,p.vehicle_id) is not null
      and p.payload is distinct from c.payload
    on conflict (workspace_revision,vehicle_id) do nothing;
  exception when others then
    -- Delta notifications must never interrupt the existing snapshot writer.
    raise warning 'Vehicle delta sidecar event failed for workspace revision %: %', new.revision, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function private.vplm_capture_vehicle_delta() from public, anon, authenticated;
drop trigger if exists vplm_vehicle_delta_trg on public.workspace_state;
create trigger vplm_vehicle_delta_trg
  after update of state on public.workspace_state
  for each row execute function private.vplm_capture_vehicle_delta();

-- Backfill the incremental read index; do not touch workspace_state.
insert into public.vplm_vehicle_delta_events(workspace_revision, vehicle_id, operation, record)
select w.revision, v.value->>'id', 'snapshot', v.value
from public.workspace_state w
cross join lateral jsonb_array_elements(
  coalesce((w.state->>'vehicle-parking-browser-state-v2')::jsonb->'vehicles','[]'::jsonb)
) as v(value)
where w.id=1 and v.value->>'id' is not null
on conflict (workspace_revision,vehicle_id) do nothing;

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname='public' and tablename='vplm_vehicle_delta_events') then
    alter publication supabase_realtime add table public.vplm_vehicle_delta_events;
  end if;
end;
$$;

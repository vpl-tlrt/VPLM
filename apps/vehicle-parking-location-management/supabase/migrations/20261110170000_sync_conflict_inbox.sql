-- Durable, reviewable sync-conflict inbox. No existing workspace records are changed.
create table if not exists public.vplm_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  submitted_by uuid not null references auth.users(id),
  device_id text not null,
  vehicle_id text not null,
  plate_number text not null,
  action_type text not null,
  client_action_at timestamptz not null,
  received_at timestamptz not null default now(),
  baseline_revision bigint,
  current_revision bigint not null,
  before_data jsonb not null default '{}'::jsonb,
  proposed_data jsonb not null default '{}'::jsonb,
  current_data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected','stale')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_reason text,
  constraint sync_conflict_device_id_nonempty check (length(trim(device_id)) > 0),
  constraint sync_conflict_plate_nonempty check (length(trim(plate_number)) > 0)
);
create index if not exists vplm_sync_conflicts_pending_idx on public.vplm_sync_conflicts(status,received_at desc);
create index if not exists vplm_sync_conflicts_vehicle_idx on public.vplm_sync_conflicts(vehicle_id,received_at desc);
alter table public.vplm_sync_conflicts enable row level security;
revoke all on public.vplm_sync_conflicts from anon, authenticated;
grant select on public.vplm_sync_conflicts to authenticated;
create policy "conflicts readable by submitter or managers" on public.vplm_sync_conflicts
for select to authenticated using (
 submitted_by = (select auth.uid()) or exists (
  select 1 from public.workspace_members m where m.user_id = (select auth.uid())
  and m.role in ('Administrator','Supervisor')
 )
);
-- Submission is a SECURITY DEFINER RPC: clients cannot forge actor/reviewer or current revision.
create or replace function public.vplm_submit_sync_conflict(
 p_operation_id uuid, p_device_id text, p_vehicle_id text, p_plate_number text,
 p_action_type text, p_client_action_at timestamptz, p_baseline_revision bigint,
 p_before_data jsonb, p_proposed_data jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_revision bigint; v_current jsonb; v_id uuid;
begin
 if v_actor is null or not exists (select 1 from public.workspace_members where user_id=v_actor and role <> 'Guest Users') then
  raise exception 'Workspace membership with write permission required';
 end if;
 if p_operation_id is null or nullif(trim(p_device_id),'') is null or nullif(trim(p_vehicle_id),'') is null
 or nullif(trim(p_plate_number),'') is null or p_client_action_at is null
 or p_action_type not in ('assign','transfer','release','deliver','pickup','road_test','other')
 or jsonb_typeof(p_before_data) <> 'object' or jsonb_typeof(p_proposed_data) <> 'object' then
  raise exception 'Invalid sync conflict submission';
 end if;
 select revision, coalesce((
   select vehicle from jsonb_array_elements(coalesce((state->>'vehicle-parking-browser-state-v2')::jsonb->'vehicles','[]'::jsonb)) vehicle
   where vehicle->>'id'=p_vehicle_id limit 1
 ), '{}'::jsonb) into v_revision, v_current from public.workspace_state where id=1;
 if v_revision is null then raise exception 'Workspace unavailable'; end if;
 insert into public.vplm_sync_conflicts
 (operation_id,submitted_by,device_id,vehicle_id,plate_number,action_type,client_action_at,baseline_revision,current_revision,before_data,proposed_data,current_data)
 values (p_operation_id,v_actor,p_device_id,p_vehicle_id,p_plate_number,p_action_type,p_client_action_at,p_baseline_revision,v_revision,p_before_data,p_proposed_data,v_current)
 on conflict (operation_id) do nothing returning id into v_id;
 if v_id is null then
  select id into v_id from public.vplm_sync_conflicts where operation_id=p_operation_id and submitted_by=v_actor;
  if v_id is null then raise exception 'Operation ID already used by another account'; end if;
 end if;
 return v_id;
end $$;
revoke all on function public.vplm_submit_sync_conflict(uuid,text,text,text,text,timestamptz,bigint,jsonb,jsonb) from public, anon;
grant execute on function public.vplm_submit_sync_conflict(uuid,text,text,text,text,timestamptz,bigint,jsonb,jsonb) to authenticated;

-- Rejecting a proposal never changes parking data. Approval records a review decision,
-- but intentionally does NOT move a vehicle: a separate validated movement transaction is required.
create or replace function public.vplm_review_sync_conflict(
 p_conflict_id uuid, p_decision text, p_reason text default null
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_row public.vplm_sync_conflicts%rowtype; v_revision bigint; v_current jsonb;
begin
 if v_actor is null or not exists (select 1 from public.workspace_members where user_id=v_actor and role in ('Administrator','Supervisor')) then
  raise exception 'Administrator or Supervisor required';
 end if;
 if p_decision not in ('rejected','approved') then raise exception 'Invalid review decision'; end if;
 select * into v_row from public.vplm_sync_conflicts where id=p_conflict_id for update;
 if not found then raise exception 'Conflict not found'; end if;
 if v_row.status <> 'pending' then raise exception 'Conflict already reviewed'; end if;
 select revision, coalesce((
   select vehicle from jsonb_array_elements(coalesce((state->>'vehicle-parking-browser-state-v2')::jsonb->'vehicles','[]'::jsonb)) vehicle
   where vehicle->>'id'=v_row.vehicle_id limit 1
 ), '{}'::jsonb) into v_revision,v_current from public.workspace_state where id=1;
 if p_decision='approved' and (v_current is distinct from v_row.current_data) then
  update public.vplm_sync_conflicts set status='stale',reviewed_by=v_actor,reviewed_at=now(),
  review_reason='Current vehicle data changed since conflict was submitted. Review again.' where id=p_conflict_id;
  return 'stale';
 end if;
 update public.vplm_sync_conflicts set status=p_decision,reviewed_by=v_actor,reviewed_at=now(),
 review_reason=nullif(trim(p_reason),'') where id=p_conflict_id;
 return p_decision;
end $$;
revoke all on function public.vplm_review_sync_conflict(uuid,text,text) from public, anon;
grant execute on function public.vplm_review_sync_conflict(uuid,text,text) to authenticated;

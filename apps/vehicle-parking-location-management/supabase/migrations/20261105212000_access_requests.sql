create table if not exists public.workspace_access_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  reason text not null check (char_length(reason) between 1 and 500),
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  assigned_role text
);
alter table public.workspace_access_requests enable row level security;
revoke all on public.workspace_access_requests from public, anon, authenticated;
grant select on public.workspace_access_requests to authenticated;
grant insert(user_id, name, reason) on public.workspace_access_requests to authenticated;
create policy "Requesters and managers read access requests" on public.workspace_access_requests
  for select to authenticated using (user_id = (select auth.uid()) or exists (
    select 1 from public.workspace_members where user_id = (select auth.uid()) and role in ('Administrator','Supervisor')
  ));
create policy "Signed-in users request their own access" on public.workspace_access_requests
  for insert to authenticated with check (user_id = (select auth.uid()) and not exists (
    select 1 from public.workspace_members where user_id = (select auth.uid())
  ));

create or replace function public.review_workspace_access(target uuid, decision text, desired_role text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  manager text;
  request public.workspace_access_requests%rowtype;
begin
  select role into manager from public.workspace_members where user_id = auth.uid();
  if manager is null or manager not in ('Administrator','Supervisor') then
    raise exception 'Management access is required.';
  end if;
  if decision is null or decision not in ('Approved','Rejected') then raise exception 'Invalid decision.'; end if;
  select * into request from public.workspace_access_requests where user_id = target for update;
  if not found or request.status <> 'Pending' then raise exception 'This request is no longer pending.'; end if;
  if decision = 'Approved' then
    if desired_role is null or (desired_role not in ('Operator','TechnicalLeader','Drivers','Technician','Guest Users')
      and not (manager = 'Administrator' and desired_role = 'Supervisor')) then
      raise exception 'Choose a role you are authorized to grant.';
    end if;
    insert into public.workspace_members(user_id, user_name, role) values(target, request.name, desired_role);
  end if;
  update public.workspace_access_requests set status = decision, reviewed_at = now(), reviewed_by = auth.uid(),
    assigned_role = case when decision = 'Approved' then desired_role end where user_id = target;
end;
$$;
revoke all on function public.review_workspace_access(uuid,text,text) from public, anon;
grant execute on function public.review_workspace_access(uuid,text,text) to authenticated;

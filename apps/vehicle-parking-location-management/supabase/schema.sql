create table if not exists public.workspace_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('Administrator', 'Supervisor', 'TechnicalLeader', 'Operator', 'Drivers', 'Guest Users', 'Others')),
  login_id text,
  user_name text,
  mobile_number text,
  created_at timestamptz not null default now()
);

alter table public.workspace_members
  add column if not exists login_id text,
  add column if not exists user_name text,
  add column if not exists mobile_number text;

alter table public.workspace_members
  drop constraint if exists workspace_members_role_check;
alter table public.workspace_members
  add constraint workspace_members_role_check
  check (role in ('Administrator', 'Supervisor', 'TechnicalLeader', 'Operator', 'Drivers', 'Guest Users', 'Others'));

create unique index if not exists workspace_members_login_id_unique
  on public.workspace_members (lower(login_id))
  where login_id is not null;

create unique index if not exists workspace_members_mobile_number_unique
  on public.workspace_members (mobile_number)
  where mobile_number is not null;

create table if not exists public.workspace_state (
  id smallint primary key check (id = 1),
  state jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

alter table public.workspace_members enable row level security;
alter table public.workspace_state enable row level security;

drop policy if exists "Members can read their own membership" on public.workspace_members;
drop policy if exists "Only AAMOTORS" on public.workspace_members;
create policy "Members can read their own membership"
  on public.workspace_members for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Workspace members can read shared state" on public.workspace_state;
create policy "Workspace members can read shared state"
  on public.workspace_state for select to authenticated
  using (exists (
    select 1 from public.workspace_members
    where user_id = (select auth.uid())
  ));

drop policy if exists "Workspace members can create shared state" on public.workspace_state;
drop policy if exists "Workspace members can save shared state" on public.workspace_state;

drop policy if exists "Workspace members can update shared state" on public.workspace_state;
drop policy if exists "Administrators can create shared state" on public.workspace_state;
drop policy if exists "Administrators can update shared state" on public.workspace_state;

revoke all on public.workspace_members from anon, authenticated;
grant select on public.workspace_members to authenticated;
revoke all on public.workspace_state from anon, authenticated;
grant select on public.workspace_state to authenticated;
grant all on public.workspace_state to service_role;

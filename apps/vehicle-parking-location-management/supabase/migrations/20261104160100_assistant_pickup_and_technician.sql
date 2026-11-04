alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check
  check (role in ('Administrator', 'Supervisor', 'TechnicalLeader', 'Operator', 'Drivers', 'Technician', 'Guest Users', 'Others'));

alter table public.pickup_requests add column if not exists centre_bay_vehicle_id text;

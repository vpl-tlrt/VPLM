-- Add Technical Advisor role without altering any existing users.
alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check
  check (role in ('Administrator', 'Supervisor', 'TechnicalLeader', 'TechnicalAdvisor', 'Operator', 'Drivers', 'Technician', 'Guest Users', 'Others'));

-- Preserve all existing access checks and extend the allowed role list only.
CREATE OR REPLACE FUNCTION public.review_workspace_access(target uuid, decision text, desired_role text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    if desired_role is null or (desired_role not in ('Operator','TechnicalLeader','TechnicalAdvisor','Drivers','Technician','Guest Users')
      and not (manager = 'Administrator' and desired_role = 'Supervisor')) then
      raise exception 'Choose a role you are authorized to grant.';
    end if;
    insert into public.workspace_members(user_id, user_name, role) values(target, request.name, desired_role);
  end if;
  update public.workspace_access_requests set status = decision, reviewed_at = now(), reviewed_by = auth.uid(),
    assigned_role = case when decision = 'Approved' then desired_role end where user_id = target;
end;
$function$;

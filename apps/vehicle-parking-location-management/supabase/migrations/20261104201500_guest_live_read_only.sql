drop policy if exists "Guests cannot create pickup requests" on public.pickup_requests;
create policy "Guests cannot create pickup requests"
  on public.pickup_requests as restrictive for insert to authenticated
  with check (exists (
    select 1 from public.workspace_members
    where user_id = (select auth.uid()) and role <> 'Guest Users'
  ));

drop policy if exists "Guests cannot update pickup requests" on public.pickup_requests;
create policy "Guests cannot update pickup requests"
  on public.pickup_requests as restrictive for update to authenticated
  using (exists (
    select 1 from public.workspace_members
    where user_id = (select auth.uid()) and role <> 'Guest Users'
  ))
  with check (exists (
    select 1 from public.workspace_members
    where user_id = (select auth.uid()) and role <> 'Guest Users'
  ));

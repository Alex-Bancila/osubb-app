-- #632: sync auth.users.email → profiles.email after a confirmed email change.
--
-- Supabase Auth's double-confirm flow (config.toml: double_confirm_changes = true)
-- lets a Member change their sign-in address from the profile page. Once both
-- addresses confirm, Auth updates auth.users.email. This trigger writes the
-- normalized value into public.profiles.email so the two never drift.
--
-- security definer: the trigger fires as supabase_auth_admin on auth.users, but
-- the UPDATE targets public.profiles — which has RLS enabled. A definer function
-- owned by postgres bypasses RLS, exactly like the provisioning path does.
-- The guard trigger (guard_profile_privileged_columns) admits non-client roles
-- (`current_user not in ('authenticated', 'anon')`), so no grant changes needed.

create or replace function private.sync_profile_email() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
       set email = lower(trim(new.email))
     where id = new.id;
  end if;
  return new;
end;
$$;

comment on function private.sync_profile_email() is
  'After Auth confirms an email change, sync the normalized address into profiles.email (#632).';

-- House rule 4: executable by nobody except the trigger machinery (postgres)
-- and supabase_auth_admin, which is the role GoTrue uses to update auth.users.
revoke all on function private.sync_profile_email() from public, anon, authenticated, service_role;
grant execute on function private.sync_profile_email() to supabase_auth_admin;

create trigger users_sync_profile_email
  after update of email on auth.users
  for each row
  execute function private.sync_profile_email();

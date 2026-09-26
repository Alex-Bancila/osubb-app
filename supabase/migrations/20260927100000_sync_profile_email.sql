-- #632: profiles.email follows auth.users.email after a confirmed email change.
--
-- A Member changes their sign-in address from Profil through Supabase Auth
-- (`updateUser({ email })`). With secure email change on
-- (config.toml `double_confirm_changes = true`; the hosted switch is in
-- docs/backend/auth-config.md) GoTrue writes only `email_change` while the
-- change is pending, and sets `auth.users.email` once BOTH addresses have
-- confirmed. This trigger then writes the normalised address into
-- `public.profiles.email`, so the two never drift and `invite-member`'s
-- "already a Member" check keeps reading the right column.
--
-- security definer, owned by postgres: GoTrue updates auth.users as
-- supabase_auth_admin, which has no privilege on public.profiles and would be
-- stopped by its RLS. As postgres, the privileged-column guard
-- (public.guard_profile_privileged_columns) admits the write, because
-- current_user is not a client role -- the same path provisioning takes.
-- Client write access to profiles.email is unchanged: BC only.
--
-- A null or blank Auth address is skipped rather than written: profiles.email
-- is `not null`, and a failing trigger would roll back GoTrue's own update.

create function private.sync_profile_email() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_email text := lower(trim(new.email));
begin
  if v_email is null or v_email = '' then
    return new;
  end if;

  update public.profiles
     set email = v_email
   where id = new.id
     and email is distinct from v_email;

  return new;
end;
$$;

comment on function private.sync_profile_email() is
  'Trigger body (#632): after Auth confirms an email change, writes the trimmed, lowercased auth.users.email into public.profiles.email for the same id.';

-- House rule 4 / conventions §4: a trigger function gets no grant back.
-- EXECUTE is checked when the trigger is created, never when it fires, so
-- GoTrue's supabase_auth_admin needs none.
revoke execute on function private.sync_profile_email()
  from public, anon, authenticated, service_role;

create trigger users_sync_profile_email
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function private.sync_profile_email();

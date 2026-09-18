-- #160: profiles.joined_at, the exact join date the Recrut -> Voluntar tenure rule needs; backfilled from joined_year as January 1.
-- `date`, not timestamptz, on purpose: a join date is a calendar fact with no
-- instant behind it (conventions section 7 governs instants). Null means unknown.
alter table public.profiles add column joined_at date;
comment on column public.profiles.joined_at is
  'Exact join date. Null when genuinely unknown; #160 backfilled known members as January 1 of joined_year.';

update public.profiles
   set joined_at = make_date(joined_year, 1, 1)
 where joined_year is not null
   and joined_at is null;

-- Same visibility as joined_year: members read it; only BC (or a server-side
-- caller) writes it, enforced by the existing privileged-column guard.
grant select (joined_at) on public.profiles to authenticated;
grant update (joined_at) on public.profiles to authenticated;

create or replace view public.profiles_directory with (security_invoker = on) as
  select id, full_name, role, status, avatar_color, tier, joined_year, created_at, joined_at
    from public.profiles;

create or replace function public.guard_profile_privileged_columns() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.role            is not distinct from old.role
     and new.status      is not distinct from old.status
     and new.email       is not distinct from old.email
     and new.tier        is not distinct from old.tier
     and new.joined_year is not distinct from old.joined_year
     and new.joined_at   is not distinct from old.joined_at then
    return new;
  end if;
  if public.auth_level() >= 6 or current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  raise exception
    'Only BC (level >= 6) may change role, status, email, tier, joined_year or joined_at on a profile'
    using errcode = '42501';
end;
$$;

-- #991: the volunteer-base import -- profiles.invited_at, the import record, the per-row import command, its lookup, the invitation stamp and the "De invitat" read
--
-- Alex, 2026-10-02: OSUBB's existing volunteer base (the "Baza de date
-- oameni vechi" sheet) is imported in two steps. Step one creates every
-- account with its rank, phone, join date, Departments and positions and
-- sends NOTHING; BC reviews the result in a grid (#992); step two sends the
-- invitations in batches once the Auth email settings are ready.
--
-- 1. public.profiles.invited_at: when an invitation email was last actually
--    sent to the Member. invite-member, reinvite-member and send-invitations
--    stamp it through public.record_invitation_sent; an imported account
--    has none until its batch goes out. Backfilled from auth.users.invited_at,
--    which Auth stamps on every invitation it has sent so far. Not granted to
--    authenticated: profiles' column grants are explicit, and only the
--    level-6 read below shows it.
-- 2. public.member_imports: one row per imported Member -- the address and
--    sheet row it came from, and the problems the import noted for BC to
--    review (a missing Project, a Coordonator without a Department, a phone
--    that could not be read). RLS on with no policy and no client grant: the
--    import command writes it and the "De invitat" read shows it, both as
--    definer. Excluded from the live change broadcast (the grid refetches
--    after every import call it makes).
-- 3. public.import_member: one sheet row, atomically -- the Profile through
--    public.provision_profile (rank, joined_at), the phone, then every
--    Appointment through private.appoint_group_member (the one insert path)
--    with p_notify => false, so 600 accounts nobody has invited yet are not
--    handed a stack of Notifications. Re-running a row that was imported
--    before completes the Appointments it is missing and never creates a
--    second Profile. Service role only (the csv-import Edge Function, after
--    its own level-6 check), and the appointer is re-checked here, live.
-- 4. public.import_member_lookup: for each address in a file, the Member it
--    already belongs to (by Profile email, or by the address it was imported
--    under) and any Auth account left without a Profile by an interrupted
--    run, so the function reuses it instead of creating a second one.
-- 5. public.record_invitation_sent: the stamp, service role only.
-- 6. public.uninvited_members: the "De invitat" grid -- every activ Member
--    never invited and never signed in, with their contact details, rank,
--    roster rows and import notes. Level 6 only, like every provisioning path.

-- ---------------------------------------------------------------------------
-- 1. profiles.invited_at
-- ---------------------------------------------------------------------------
alter table public.profiles add column invited_at timestamptz;

comment on column public.profiles.invited_at is
  '#991: when an invitation email was last sent to this Member -- stamped by public.record_invitation_sent after Auth accepted the send (invite-member, reinvite-member, send-invitations). Null for an account created without one (the volunteer import, #991) until its batch is sent. Backfilled from auth.users.invited_at. Not readable by authenticated; public.uninvited_members is the level-6 read of who has none.';

update public.profiles as profile
   set invited_at = account.invited_at
  from auth.users as account
 where account.id = profile.id
   and account.invited_at is not null
   and profile.invited_at is null;

-- ---------------------------------------------------------------------------
-- 2. The import record
-- ---------------------------------------------------------------------------
create table public.member_imports (
  member_id   uuid primary key references public.profiles (id) on delete cascade,
  sheet_email text not null,
  sheet_row   integer not null,
  problems    text[] not null default '{}'::text[],
  imported_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint member_imports_sheet_email_ck
    check (sheet_email = lower(btrim(sheet_email)) and sheet_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  constraint member_imports_sheet_row_ck check (sheet_row between 2 and 100000),
  constraint member_imports_problems_ck check (cardinality(problems) <= 20),
  constraint member_imports_updated_at_ck check (updated_at >= created_at)
);
create unique index member_imports_sheet_email_uidx on public.member_imports (sheet_email);

alter table public.member_imports enable row level security;
revoke all on table public.member_imports from public, anon, authenticated, service_role;

create trigger member_imports_set_updated_at
before update on public.member_imports
for each row execute function private.set_updated_at();

comment on table public.member_imports is
  '#991: one row per Member created by the volunteer-base import -- the address (sheet_email, lower-cased) and sheet row they came from, who imported them, and the problems the import noted for BC (problems: at most 20 short Romanian notes such as "proiect lipsă: Gala"). Written only by public.import_member, read only by public.uninvited_members (both definer); RLS on with no policy and no client grant. sheet_email keeps the imported address after BC corrects the Profile''s, so a re-run of the same file finds the Member instead of creating a second account.';

-- ---------------------------------------------------------------------------
-- 3. import_member
-- ---------------------------------------------------------------------------
create function public.import_member(
  p_user_id     uuid,
  p_full_name   text,
  p_email       text,
  p_role        public.member_role,
  p_phone       text,
  p_joined_at   date,
  p_placements  jsonb,
  p_problems    text[],
  p_sheet_row   integer,
  p_imported_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email      text := lower(btrim(p_email));
  v_outcome    text;
  v_place      record;
  v_group_id   bigint;
  v_role       text;
  v_title      text;
  v_current    public.group_members%rowtype;
  v_status     text;
  v_placements jsonb := '[]'::jsonb;
begin
  -- 1. Malformed for every caller (conventions section 2).
  if p_user_id is null then
    raise sqlstate 'PT400' using message = 'member_id_required';
  end if;
  if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise sqlstate 'PT400' using message = 'invalid_email';
  end if;
  if p_sheet_row is null or p_sheet_row not between 2 and 100000 then
    raise sqlstate 'PT400' using message = 'invalid_sheet_row';
  end if;
  -- A placement is {group_id, group_role, position_title?}; each Group once,
  -- at most 20. The title rules themselves are the Appointment core's.
  if p_placements is null
     or jsonb_typeof(p_placements) <> 'array'
     or jsonb_array_length(p_placements) > 20
     or exists (
       select 1
         from jsonb_array_elements(p_placements) as placement
        where jsonb_typeof(placement) <> 'object'
           or coalesce(placement ->> 'group_id', '') !~ '^[1-9][0-9]{0,17}$'
           or coalesce(placement ->> 'group_role', '') not in ('manager', 'responsible', 'member')
           or coalesce(jsonb_typeof(placement -> 'position_title'), 'null') not in ('string', 'null'))
     or (select count(distinct placement ->> 'group_id') <> count(*)
           from jsonb_array_elements(p_placements) as placement) then
    raise sqlstate 'PT400' using message = 'invalid_placements';
  end if;
  if cardinality(coalesce(p_problems, '{}'::text[])) > 20
     or exists (select 1 from unnest(p_problems) as problem
                 where problem is null or problem !~ '[^[:space:]]'
                    or char_length(problem) > 200) then
    raise sqlstate 'PT400' using message = 'invalid_problems';
  end if;

  -- 2. The importer: a live activ BC or Moderator, held FOR SHARE so a
  --    concurrent demotion or deactivation waits for this row.
  perform 1
     from public.profiles as importer
     join public.roles as role on role.id = importer.role
    where importer.id = p_imported_by
      and importer.status = 'activ'
      and role.level >= 6
      for share of importer;
  if not found then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  -- 3. Every Group this row names, locked once in ascending id order, so two
  --    concurrent rows naming the same Groups in different orders queue
  --    instead of deadlocking. The core's own FOR NO KEY UPDATE below is then
  --    a lock already held.
  perform 1
     from public.groups as grp
    where grp.id in (select (placement ->> 'group_id')::bigint
                       from jsonb_array_elements(p_placements) as placement)
    order by grp.id
      for no key update;

  -- 4. The Profile: created once; a re-run completes it.
  if exists (select 1 from public.profiles as profile where profile.id = p_user_id) then
    -- Only an account this import created is completed: an existing Member
    -- who happens to be on the sheet is never touched.
    if not exists (select 1 from public.member_imports as import
                    where import.member_id = p_user_id) then
      raise sqlstate 'PT409' using message = 'member_not_imported';
    end if;
    v_outcome := 'completed';
  else
    -- Rank, email and join date through the one provisioning path, which
    -- also re-checks a bc/moderator rank against the importer. No Group yet:
    -- the Appointments below need their own role, title and order.
    perform public.provision_profile(
      p_user_id      => p_user_id,
      p_full_name    => btrim(p_full_name),
      p_email        => v_email,
      p_role         => p_role,
      p_group_ids    => '{}'::bigint[],
      p_appointed_by => p_imported_by,
      p_joined_at    => p_joined_at);
    if nullif(btrim(p_phone), '') is not null then
      -- profiles_normalize_phone stores it in E.164 or refuses phone_invalid.
      update public.profiles as profile
         set phone = btrim(p_phone)
       where profile.id = p_user_id;
    end if;
    v_outcome := 'created';
  end if;

  -- 5. The Appointments, in the sheet's order: the principal Department
  --    first, so it is the Member's chip (R17: the earliest roster row on a
  --    top-level Group). One transaction stamps every row with the same
  --    now(), so each new row's created_at is moved on by its position, in
  --    microseconds, to keep that order readable.
  for v_place in
    select placement, ordinality
      from jsonb_array_elements(p_placements) with ordinality as entry(placement, ordinality)
     order by ordinality
  loop
    v_group_id := (v_place.placement ->> 'group_id')::bigint;
    v_role     := v_place.placement ->> 'group_role';
    v_title    := v_place.placement ->> 'position_title';

    select membership.* into v_current
      from public.group_members as membership
     where membership.group_id = v_group_id
       and membership.member_id = p_user_id;

    if found then
      -- Already on the roster from an earlier run, or placed by hand since:
      -- left exactly as it is, and reported.
      v_status := case
                    when v_current.group_role = v_role
                     and v_current.position_title is not distinct from nullif(btrim(v_title), '')
                    then 'present'
                    else 'conflict'
                  end;
    else
      perform private.appoint_group_member(
        v_group_id, p_user_id, p_imported_by, v_role, v_title, false);
      update public.group_members as membership
         set created_at = now() + make_interval(secs => v_place.ordinality / 1000000.0)
       where membership.group_id = v_group_id
         and membership.member_id = p_user_id;
      v_status := 'appointed';
    end if;

    v_placements := v_placements || jsonb_build_object(
      'group_id',       v_group_id,
      'group_role',     v_role,
      'position_title', nullif(btrim(v_title), ''),
      'status',         v_status);
  end loop;

  -- 6. The import record: the latest run's notes; the address and the
  --    importer of the first run stay.
  insert into public.member_imports as import (member_id, sheet_email, sheet_row, problems, imported_by)
  values (p_user_id, v_email, p_sheet_row, coalesce(p_problems, '{}'::text[]), p_imported_by)
  on conflict (member_id) do update
     set sheet_row = excluded.sheet_row,
         problems  = excluded.problems;

  return jsonb_build_object(
    'member_id',  p_user_id,
    'outcome',    v_outcome,
    'placements', v_placements);
end;
$function$;

revoke execute on function public.import_member(uuid, text, text, public.member_role, text, date, jsonb, text[], integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.import_member(uuid, text, text, public.member_role, text, date, jsonb, text[], integer, uuid)
  to service_role;

comment on function public.import_member(uuid, text, text, public.member_role, text, date, jsonb, text[], integer, uuid) is
  '#991: imports one row of the volunteer sheet for an Auth account the csv-import Edge Function created WITHOUT sending mail, in one transaction. Step 1, malformed for everyone: PT400 member_id_required, invalid_email, invalid_sheet_row (2-100000), invalid_placements (not an array of at most 20 objects {group_id: positive integer, group_role: manager|responsible|member, position_title: string|null}, or one Group twice), invalid_problems (more than 20 notes, or one blank or over 200 characters). Then 42501 member_manage_forbidden unless p_imported_by is a live activ Member of level 6 or more (FOR SHARE). Locks every named Group FOR NO KEY UPDATE in ascending id order. A new p_user_id is provisioned through public.provision_profile (rank, lower-cased email, p_joined_at; a bc/moderator rank re-checked against the importer) and gets p_phone (normalised by profiles_normalize_phone, 23514 phone_invalid otherwise): outcome created. An existing Profile is completed only when this import created it (a member_imports row), otherwise PT409 member_not_imported: outcome completed, and its name, email, rank and phone are left as they are. Each placement, in the given order, is reported present (the same role and title already held), conflict (a different role or title already held: left untouched) or appointed through private.appoint_group_member with p_notify => false -- every core refusal (group_archived, group_member_below_min_level, position_title_required, ...) fails the whole row -- and a new row''s created_at is moved on by its position in microseconds, so the first placement (the principal Department) is the Member''s R17 chip. Upserts public.member_imports (the latest problems and sheet row; the first run''s address and importer stay). Returns {member_id, outcome, placements: [{group_id, group_role, position_title, status}]}. Writes no Notification. Service role only.';

-- ---------------------------------------------------------------------------
-- 4. import_member_lookup
-- ---------------------------------------------------------------------------
create function public.import_member_lookup(p_emails text[])
returns table (email text, member_id uuid, imported boolean, orphan_user_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if cardinality(coalesce(p_emails, '{}'::text[])) > 2000 then
    raise sqlstate 'PT400' using message = 'too_many_emails';
  end if;

  return query
  with wanted as (
    select distinct lower(btrim(address)) as address
      from unnest(coalesce(p_emails, '{}'::text[])) as address
     where address is not null and btrim(address) <> ''
  ),
  matched as (
    select wanted.address,
           coalesce(by_import.member_id, by_profile.id) as member_id
      from wanted
      left join public.member_imports as by_import on by_import.sheet_email = wanted.address
      left join lateral (
        select profile.id
          from public.profiles as profile
         where lower(profile.email) = wanted.address
         -- profiles.email is unique only as written: should two spellings
         -- of one address ever exist, the exact one, then the oldest, wins.
         order by (profile.email = wanted.address) desc, profile.created_at, profile.id
         limit 1
      ) as by_profile on true
  )
  select matched.address,
         matched.member_id,
         exists (select 1 from public.member_imports as import
                  where import.member_id = matched.member_id),
         case when matched.member_id is null then (
           -- An Auth account an interrupted run left without a Profile:
           -- never confirmed, never signed in, so nobody but the import made it.
           select account.id
             from auth.users as account
            where lower(account.email) = matched.address
              and account.email_confirmed_at is null
              and account.last_sign_in_at is null
              and not exists (select 1 from public.profiles as profile
                               where profile.id = account.id)
            order by account.created_at
            limit 1)
         end
    from matched
   where matched.member_id is not null
      or exists (select 1 from auth.users as account
                  where lower(account.email) = matched.address);
end;
$function$;

revoke execute on function public.import_member_lookup(text[])
  from public, anon, authenticated, service_role;
grant execute on function public.import_member_lookup(text[]) to service_role;

comment on function public.import_member_lookup(text[]) is
  '#991: for the addresses of a volunteer sheet (at most 2000, else PT400 too_many_emails; trimmed and lower-cased), one row per address that is already known: member_id -- the Member it was imported under (member_imports.sheet_email, so a corrected address still finds them) or whose Profile uses it; imported -- whether public.import_member created that Member (a re-run completes them; any other Member on the sheet is skipped); orphan_user_id -- for an address with no Member, an Auth account with no Profile, never confirmed and never signed in, which an interrupted import left behind and the next run reuses instead of creating a second account. An address with a confirmed or signed-in Auth account and no Profile is returned with all three empty, so the import reports it rather than creating anything. Security definer to read auth.users; service role only.';

-- ---------------------------------------------------------------------------
-- 5. record_invitation_sent
-- ---------------------------------------------------------------------------
create function public.record_invitation_sent(p_member_id uuid)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_at timestamptz;
begin
  update public.profiles as profile
     set invited_at = now()
   where profile.id = p_member_id
  returning profile.invited_at into v_at;
  if not found then
    raise sqlstate 'PT404' using message = 'member_not_found';
  end if;
  return v_at;
end;
$function$;

revoke execute on function public.record_invitation_sent(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.record_invitation_sent(uuid) to service_role;

comment on function public.record_invitation_sent(uuid) is
  '#991: stamps profiles.invited_at = now() for a Member whose invitation email Auth has just accepted, and returns it; PT404 member_not_found for an unknown id. Called by invite-member, reinvite-member and send-invitations after the send, never before. Service role only (security invoker: service_role already updates profiles).';

-- ---------------------------------------------------------------------------
-- 6. uninvited_members -- the "De invitat" grid
-- ---------------------------------------------------------------------------
create function private.uninvited_members_impl()
returns table (
  member_id          uuid,
  full_name          text,
  email              text,
  phone              text,
  role               public.member_role,
  joined_at          date,
  created_at         timestamptz,
  imported_at        timestamptz,
  sheet_row          integer,
  problems           text[],
  primary_group_id   bigint,
  primary_group_name text,
  memberships        jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  -- Level 6 from the live Profile (security pass M4), beside the claims guard.
  if not coalesce(public.auth_is_member(), false)
     or coalesce((select private.caller_level()), -1) < 6 then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  return query
  select profile.id,
         profile.full_name,
         profile.email,
         profile.phone,
         profile.role,
         profile.joined_at,
         profile.created_at,
         import.created_at,
         import.sheet_row,
         coalesce(import.problems, '{}'::text[]),
         primary_row.group_id,
         primary_row.name,
         coalesce((
           select jsonb_agg(
                    jsonb_build_object(
                      'group_id',       membership.group_id,
                      'name',           member_group.name,
                      'parent_id',      member_group.parent_id,
                      'group_role',     membership.group_role,
                      'position_title', membership.position_title)
                    order by membership.created_at, membership.group_id)
             from public.group_members as membership
             join public.groups as member_group on member_group.id = membership.group_id
            where membership.member_id = profile.id
              and member_group.status = 'active'
              and not member_group.is_organization
         ), '[]'::jsonb)
    from public.profiles as profile
    join auth.users as account on account.id = profile.id
    left join public.member_imports as import on import.member_id = profile.id
    left join lateral (
      -- R17's chip: the earliest roster row on an active top-level Group
      -- that is not the Organization Group.
      select membership.group_id, member_group.name
        from public.group_members as membership
        join public.groups as member_group on member_group.id = membership.group_id
       where membership.member_id = profile.id
         and member_group.parent_id is null
         and member_group.status = 'active'
         and not member_group.is_organization
       order by membership.created_at, membership.group_id
       limit 1
    ) as primary_row on true
   where profile.status = 'activ'
     and profile.invited_at is null
     and account.last_sign_in_at is null
   order by import.sheet_row nulls last, profile.full_name, profile.id;
end;
$function$;

revoke execute on function private.uninvited_members_impl()
  from public, anon, authenticated, service_role;
grant execute on function private.uninvited_members_impl() to authenticated;

comment on function private.uninvited_members_impl() is
  '#991: body of public.uninvited_members. 42501 member_manage_forbidden without organization claims or below live level 6 (private.caller_level). Otherwise every activ Member with profiles.invited_at null whose Auth account never signed in -- the volunteer import''s accounts, and any other never-invited one -- with email and phone, rank, join date, the import record (imported_at, sheet_row, problems; null/empty for a Member not imported), the R17 chip (the earliest roster row on an active top-level Group that is not the Organization Group) and every explicit roster row on an active non-Organization Group in roster order, Private Groups included (level 6 sees every Group). Ordered by sheet row, then name. Security definer to read auth.users and the hidden import record.';

create function public.uninvited_members()
returns table (
  member_id          uuid,
  full_name          text,
  email              text,
  phone              text,
  role               public.member_role,
  joined_at          date,
  created_at         timestamptz,
  imported_at        timestamptz,
  sheet_row          integer,
  problems           text[],
  primary_group_id   bigint,
  primary_group_name text,
  memberships        jsonb
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select * from private.uninvited_members_impl();
$function$;

revoke execute on function public.uninvited_members()
  from public, anon, authenticated, service_role;
grant execute on function public.uninvited_members() to authenticated;

comment on function public.uninvited_members() is
  '#991: the "De invitat" grid of Administrare > Membri (#992) -- every activ Member never invited (profiles.invited_at null) who never signed in, with contact details, rank, Groups and the volunteer import''s notes. BC and the Moderator only (live level >= 6), 42501 member_manage_forbidden otherwise. A Member leaves it when send-invitations stamps their invitation.';

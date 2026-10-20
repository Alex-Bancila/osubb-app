-- #1087: Member Deletion (ruling R59) -- BC and the Moderator delete for good a Member with no history.
--
-- Spec: docs/superpowers/specs/2026-10-20-member-deletion-design.md.
--
-- profiles.id cascades from auth.users, and seventeen tables cascade from
-- profiles, points_ledger and task_assignments among them, so an unchecked
-- delete of a login would erase a credited Member's Task Points and
-- Assignment History without a word. delete_member therefore decides, under
-- the Profile's lock, that nothing beyond the account's own rows names the
-- Member, and only then deletes the auth.users row and lets the cascade take
-- the rest. Nothing survives: no audit row (R59 decision 6).
--
-- "History" is read from the catalog, not from a list: every foreign key into
-- profiles or auth.users outside the auth schema holds the account, except the
-- columns named below as the account's own. A table added later therefore
-- holds accounts until someone decides its rows go with them.

-- ==================== The account's own rows ====================

create function private.member_deletion_goes(p_member_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(goes.kind, goes.n) filter (where goes.n > 0), '{}'::jsonb)
    from (values
      ('announcement_reads',              (select count(*) from public.announcement_reads where member_id = p_member_id)),
      ('deal_code_reveals',               (select count(*) from public.deal_code_reveals where member_id = p_member_id)),
      ('email_digests',                   (select count(*) from private.email_digests where member_id = p_member_id)),
      -- An ordinary membership only: a Group position is history.
      ('group_members',                   (select count(*) from public.group_members
                                            where member_id = p_member_id and group_role = 'member')),
      ('member_group_unselected',         (select count(*) from public.member_group_unselected where member_id = p_member_id)),
      ('member_imports',                  (select count(*) from public.member_imports where member_id = p_member_id)),
      ('notification_email_preferences',  (select count(*) from public.notification_email_preferences where member_id = p_member_id)),
      ('notification_push_preferences',   (select count(*) from public.notification_push_preferences where member_id = p_member_id)),
      ('notifications',                   (select count(*) from public.notifications where member_id = p_member_id)),
      ('privacy_notice_acknowledgements', (select count(*) from public.privacy_notice_acknowledgements where member_id = p_member_id)),
      ('push_tokens',                     (select count(*) from public.push_tokens where member_id = p_member_id)),
      -- The Role and Status History about the Member, an earlier deactivation
      -- included (R59 decision 2).
      ('role_history',                    (select count(*) from public.role_history where member_id = p_member_id))
    ) as goes(kind, n);
$$;

comment on function private.member_deletion_goes(uuid) is
  'R59 (#1087): the rows that go with a deleted account, counted by table, only the non-zero ones. These columns are the only foreign keys into profiles that private.member_deletion_holds does not count.';

-- ==================== History ====================

create function private.member_deletion_holds(p_member_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_fk    record;
  v_n     bigint;
  v_holds jsonb := '{}'::jsonb;
begin
  for v_fk in
    select namespace.nspname as schema_name,
           relation.relname  as table_name,
           attribute.attname as column_name
      from pg_catalog.pg_constraint as fk
      join pg_catalog.pg_class as relation on relation.oid = fk.conrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      join pg_catalog.pg_attribute as attribute
        on attribute.attrelid = fk.conrelid and attribute.attnum = fk.conkey[1]
     where fk.contype = 'f'
       and fk.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
       -- Auth's own tables, and the key profiles.id -> auth.users itself, are
       -- the account. Any other column of profiles naming a Member counts.
       and namespace.nspname <> 'auth'
       and not (fk.conrelid = 'public.profiles'::regclass
                and fk.confrelid = 'auth.users'::regclass)
       and (namespace.nspname, relation.relname, attribute.attname) not in (
         ('public',  'announcement_reads',              'member_id'),
         ('public',  'deal_code_reveals',               'member_id'),
         ('private', 'email_digests',                   'member_id'),
         ('public',  'member_group_unselected',         'member_id'),
         ('public',  'member_imports',                  'member_id'),
         ('public',  'notification_email_preferences',  'member_id'),
         ('public',  'notification_push_preferences',   'member_id'),
         ('public',  'notifications',                   'member_id'),
         ('public',  'privacy_notice_acknowledgements', 'member_id'),
         ('public',  'push_tokens',                     'member_id'),
         ('public',  'role_history',                    'member_id'))
     order by 1, 2, 3
  loop
    if (v_fk.schema_name, v_fk.table_name, v_fk.column_name) = ('public', 'group_members', 'member_id') then
      -- A Group Manager or Group Responsible position holds the account; an
      -- ordinary membership goes with it.
      select count(*) into v_n
        from public.group_members
       where member_id = p_member_id and group_role <> 'member';
    elsif (v_fk.schema_name, v_fk.table_name) = ('public', 'profiles') then
      -- A column of profiles naming the Member on their own row goes with
      -- that row; naming them on someone else's holds the account.
      execute format('select count(*) from public.profiles where %I = $1 and id <> $1',
                     v_fk.column_name)
         into v_n
        using p_member_id;
    elsif (v_fk.schema_name, v_fk.table_name, v_fk.column_name) = ('public', 'role_history', 'changed_by') then
      -- A Role change the Member decided for someone else; a row about the
      -- Member themselves goes with them.
      select count(*) into v_n
        from public.role_history
       where changed_by = p_member_id and member_id <> p_member_id;
    else
      execute format('select count(*) from %I.%I where %I = $1',
                     v_fk.schema_name, v_fk.table_name, v_fk.column_name)
         into v_n
        using p_member_id;
    end if;
    if v_n > 0 then
      v_holds := v_holds || jsonb_build_object(
        case when v_fk.schema_name = 'public' then '' else v_fk.schema_name || '.' end
          || v_fk.table_name || '.' || v_fk.column_name,
        v_n);
    end if;
  end loop;
  return v_holds;
end;
$$;

comment on function private.member_deletion_holds(uuid) is
  'R59 (#1087): what holds an account, one key per referencing column ("tasks.created_by") with its count, only the non-zero ones. Read from the catalog: every foreign key into profiles or auth.users outside the auth schema counts, a SET NULL actor column and any other column of profiles included, except the login key profiles.id itself, the account''s own columns (private.member_deletion_goes), an ordinary Group membership, the Role History about the Member and a profiles column naming the Member on their own row.';

-- ==================== The last active holder ====================

create function private.member_last_holder(p_member_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select profile.role::text
    from public.profiles as profile
   where profile.id = p_member_id
     and profile.status = 'activ'
     and profile.role in ('bc', 'moderator')
     and not exists (select 1
                       from public.profiles as other
                      where other.role = profile.role
                        and other.status = 'activ'
                        and other.id <> profile.id);
$$;

comment on function private.member_last_holder(uuid) is
  'R59 (#1087): ''bc'' or ''moderator'' when the Member is the last active holder of that rank (ruling R31''s last-holder rule), else null. A deletion names no replacement, so it refuses.';

-- ==================== Authority ====================

create function private.can_delete_member(p_actor uuid, p_member uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  -- BC and the Moderator, live, never on themselves. The one place to widen
  -- who may delete (Alex, 2026-10-20: "different members that could delete a
  -- volunteer later").
  select p_actor is not null
     and p_member is not null
     and p_actor <> p_member
     and coalesce(private.actor_level(p_actor), -1) >= 6;
$$;

comment on function private.can_delete_member(uuid, uuid) is
  'R59 (#1087): who may delete a Member for good. Live activ level 6 and up (BC, the Moderator), never oneself.';

create function private.require_member_deleter(p_member_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  -- One reason for every denial (conventions section 3): claimless, inactive,
  -- below level 6, or oneself.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end;
  if not private.can_delete_member(v_actor, p_member_id) then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;
  return v_actor;
end;
$$;

-- ==================== The preview ====================

create function private.member_delete_preview_impl(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_member_id is null then
    raise sqlstate 'PT400' using message = 'invalid_member';
  end if;
  perform private.require_member_deleter(p_member_id);
  if not exists (select 1 from public.profiles where id = p_member_id) then
    raise sqlstate 'PT404' using message = 'member_not_found';
  end if;
  return jsonb_build_object(
    'holds',       private.member_deletion_holds(p_member_id),
    'goes',        private.member_deletion_goes(p_member_id),
    'last_holder', private.member_last_holder(p_member_id));
end;
$$;

create function public.member_delete_preview(p_member_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.member_delete_preview_impl(p_member_id);
$$;

comment on function public.member_delete_preview(uuid) is
  'R59 (#1087): what a Member Deletion would meet, for BC and the Moderator: { holds, goes, last_holder }. Deletable when holds is empty and last_holder is null. Locks nothing; delete_member decides again under the lock.';

-- ==================== The command ====================

create function private.delete_member_impl(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_last  text;
  v_holds jsonb;
begin
  -- 1. Malformed for everyone.
  if p_member_id is null then
    raise sqlstate 'PT400' using message = 'invalid_member';
  end if;

  -- 2. Authority.
  v_actor := private.require_member_deleter(p_member_id);

  -- 3. Locks, in one statement ordered by id: the target, the actor and every
  --    live holder of bc and moderator (set_member_role's set, so the two
  --    commands serialize in the same order). FOR UPDATE, not FOR NO KEY
  --    UPDATE: the key itself is deleted, and only FOR UPDATE conflicts with
  --    the FOR KEY SHARE every foreign-key insert takes on the Profile. A
  --    concurrent write naming the Member therefore either commits first and
  --    is counted in step 5, or waits and then fails on the missing key; the
  --    cascade never takes a row nobody counted.
  perform 1
     from public.profiles as profile
    where profile.id = p_member_id
       or profile.id = v_actor
       or (profile.role in ('bc', 'moderator') and profile.status = 'activ')
    order by profile.id
      for update;
  --    Then the login, for the same reason: a table outside auth may name
  --    auth.users directly, and its insert takes FOR KEY SHARE there, not on
  --    the Profile. Always after the Profiles, so the order is one.
  perform 1 from auth.users where id = p_member_id for update;

  -- 4. The target, and the actor re-read under the lock: a demotion or
  --    deactivation that committed after the gate is seen here.
  if not exists (select 1 from public.profiles where id = p_member_id) then
    raise sqlstate 'PT404' using message = 'member_not_found';
  end if;
  if not private.can_delete_member(v_actor, p_member_id) then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  -- 5. The organization keeps a BC member and a Moderator; then history.
  v_last := private.member_last_holder(p_member_id);
  if v_last is not null then
    raise sqlstate 'PT409' using message = 'member_is_last_' || v_last;
  end if;
  v_holds := private.member_deletion_holds(p_member_id);
  if v_holds <> '{}'::jsonb then
    raise sqlstate 'PT409' using
      message = 'member_has_history',
      detail = (select string_agg(held.key || '=' || held.value, ', ' order by held.key)
                  from jsonb_each_text(v_holds) as held);
  end if;

  -- 6. Nothing survives. Other Members' Notifications that name the account
  --    (the re-invite notice carries its name and email), then the Role
  --    History about it -- immutable, so the guard admits these rows alone
  --    while the setting names them -- then Auth's PKCE flows (no foreign
  --    key), then the login, whose cascade takes the Profile and every row
  --    private.member_deletion_goes counted.
  delete from public.notifications
   where link = '/administrare/membri/' || p_member_id::text
      or subject in ('promotion_candidate:' || p_member_id::text,
                     'retention_signal:' || p_member_id::text);
  perform set_config('osubb.deleting_member_id', p_member_id::text, true);
  delete from public.role_history where member_id = p_member_id;
  perform set_config('osubb.deleting_member_id', '', true);
  delete from auth.flow_state where user_id = p_member_id;
  delete from auth.users where id = p_member_id;

  return jsonb_build_object('member_id', p_member_id);
end;
$$;

create function public.delete_member(p_member_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.delete_member_impl(p_member_id);
$$;

comment on function public.delete_member(uuid) is
  'R59 (#1087): Member Deletion. BC or the Moderator deletes for good a Member with no history, sign-in included; nothing survives. 42501 member_manage_forbidden, PT400 invalid_member, PT404 member_not_found, PT409 member_is_last_bc / member_is_last_moderator, PT409 member_has_history (DETAIL lists each holding column with its count).';

-- ==================== role_history admits the deleted Member's rows ====================
-- Rebuilt from 20260919155643_role_history_audit.sql, the latest body on main,
-- with one DELETE exception. No client role holds DELETE on role_history, so
-- only a definer command that names the Member in the transaction-local
-- setting reaches it, and only for that Member's own rows.

create or replace function private.guard_role_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE'
     and old.member_id::text = nullif(current_setting('osubb.deleting_member_id', true), '') then
    return old;
  end if;
  if tg_op <> 'INSERT' then
    raise exception using errcode = '23514', message = 'role_history_immutable';
  end if;
  if (new.from_role = 'vot' or new.to_role = 'vot')
     and (new.changed_by is null or coalesce(private.actor_level(new.changed_by), -1) < 6) then
    raise exception using errcode = '23514', message = 'voting_role_requires_bc_actor';
  end if;
  return new;
end;
$function$;

-- ==================== Grants ====================

revoke execute on function private.member_deletion_goes(uuid)          from public, anon, authenticated, service_role;
revoke execute on function private.member_deletion_holds(uuid)         from public, anon, authenticated, service_role;
revoke execute on function private.member_last_holder(uuid)            from public, anon, authenticated, service_role;
revoke execute on function private.can_delete_member(uuid, uuid)       from public, anon, authenticated, service_role;
revoke execute on function private.require_member_deleter(uuid)        from public, anon, authenticated, service_role;
revoke execute on function private.member_delete_preview_impl(uuid)    from public, anon, authenticated, service_role;
revoke execute on function public.member_delete_preview(uuid)          from public, anon, authenticated, service_role;
revoke execute on function private.delete_member_impl(uuid)            from public, anon, authenticated, service_role;
revoke execute on function public.delete_member(uuid)                  from public, anon, authenticated, service_role;

grant execute on function private.member_delete_preview_impl(uuid) to authenticated;
grant execute on function public.member_delete_preview(uuid)       to authenticated;
grant execute on function private.delete_member_impl(uuid)         to authenticated;
grant execute on function public.delete_member(uuid)               to authenticated;

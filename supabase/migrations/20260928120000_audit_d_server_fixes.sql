-- #861: Audit D server fixes -- finished Task's Executor, archived Group off the Cup, Announcement reads, one acceptance Notification.
-- Frontend QA pass 2026-09-28, Audit D: the server fixes the functional
-- walkthrough found, in one migration.
--
--   D-1  A finished Task still names the Member who did it.
--        private.visible_task_executors returned only an open Assignment, and
--        an Evaluation ends it (end_reason completed / failed), so every
--        completed or unfulfilled Task read "Neatribuit" -- even to the
--        manager who had just evaluated it. For a completed or unfulfilled
--        Task it now returns the member of the latest Assignment that ended
--        completed or failed, flagged is_current = false. Nothing else of
--        the Assignment History, and nothing for a cancelled Task.
--   D-10 An archived Group leaves the Departments Cup: department_cup_rows
--        (and so public.department_cup and the dept_cup view) lists only
--        active competing Groups, for every date range and Campaign.
--   D-12 The author has read their own Announcement: the fan-out trigger
--        writes the author's announcement_reads row when the author is in
--        the Announcement's read audience (the announcements_read rule, for
--        the author rather than the caller). A global writer who posts
--        outside their own audience gets no row.
--   D-20 Reading an Announcement marks its "Anunț nou" Notification read:
--        the fan-out passes the dedupe key announcement:<id>, and a new
--        trigger on announcement_reads marks that member's unread row with
--        that key read. The rows already delivered are keyed from their
--        /anunturi?anunt=<id> link (#843) and marked read where the member
--        has already read the Announcement.
--   D-20 Accepting an Application writes one Notification ("Cerere
--        acceptată: <Group>"), not two: decide_group_application_impl calls
--        the Appointment core with p_notify => false. Every other caller of
--        private.appoint_group_member keeps the default and its Notification.
--
-- Every function below is rebuilt from main's latest body (pg_get_functiondef
-- after a db reset at 20260928110000); only the lines marked #861 differ.

-- ---------------------------------------------------------------------------
-- 1. The Executor of a finished Task (D-1). The return type gains is_current,
--    so both functions are dropped and recreated with their grants, their
--    200-id cap and their comments (conventions section 4).
-- ---------------------------------------------------------------------------
drop function public.visible_task_executors(bigint[]);
drop function private.visible_task_executors(bigint[]);

create function private.visible_task_executors(p_task_ids bigint[])
returns table (
  task_id bigint,
  member_id uuid,
  full_name text,
  nickname text,
  is_current boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if cardinality(p_task_ids) > 200 then
    raise sqlstate 'PT400' using
      message = 'too_many_ids',
      detail = 'visible_task_executors: at most 200 Task ids per call';
  end if;

  -- One row per readable Task at most: its open Assignment (is_current), or
  -- (#861, Audit D-1) for a completed or unfulfilled Task the latest
  -- Assignment its Evaluation ended (completed / failed). A cancelled Task
  -- and every other Assignment History row stay private.
  return query
  select task.id, executor.member_id, profile.full_name, profile.nickname, executor.is_current
    from public.tasks as task
    cross join lateral (
      select assignment.member_id, assignment.ended_at is null as is_current
        from public.task_assignments as assignment
       where assignment.task_id = task.id
         and (assignment.ended_at is null
              or (task.status in ('completed', 'unfulfilled')
                  and assignment.end_reason in ('completed', 'failed')))
       order by assignment.ended_at desc nulls first, assignment.id desc
       limit 1
    ) as executor
    left join public.profiles as profile on profile.id = executor.member_id
   where coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and task.id = any(coalesce(p_task_ids, array[]::bigint[]))
     and private.can_read_task(task.id)
   order by task.id;
end;
$$;

comment on function private.visible_task_executors(bigint[]) is
  'Least-privilege #499 read implementation: for each Task the live caller may already read, returns only the Executor identity (id, full name, Nickname) -- the open Assignment''s member with is_current = true, or, for a completed or unfulfilled Task, the member of the latest Assignment its Evaluation ended (completed / failed) with is_current = false (#861, Audit D-1). While the Task was open the same identity was already visible to the same readers. Nothing for a cancelled Task; the rest of the Assignment History and contact fields remain private. At most 200 Task ids per call (PT400 too_many_ids, security pass I1).';

create function public.visible_task_executors(p_task_ids bigint[])
returns table (
  task_id bigint,
  member_id uuid,
  full_name text,
  nickname text,
  is_current boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select executor.task_id, executor.member_id, executor.full_name, executor.nickname, executor.is_current
    from private.visible_task_executors(p_task_ids) as executor;
$$;

comment on function public.visible_task_executors(bigint[]) is
  'Authenticated RPC for #499. Accepts at most 200 Task ids (PT400 too_many_ids) and returns, for each readable Task, its current Executor (is_current true) or, once the Task is completed or unfulfilled, the Executor who finished it (is_current false, #861): id, full name and Nickname only.';

revoke execute on function private.visible_task_executors(bigint[])
  from public, anon, authenticated, service_role;
revoke execute on function public.visible_task_executors(bigint[])
  from public, anon, authenticated, service_role;
grant execute on function private.visible_task_executors(bigint[]) to authenticated;
grant execute on function public.visible_task_executors(bigint[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. An archived Group leaves the Cup (D-10). Same signature and return type:
--    grants and the dept_cup view carry over.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.department_cup_rows(p_campaign_id bigint, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(group_id bigint, name text, points integer, members bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.require_date_range(p_from, p_to);

  with task_points as (
    select cup.id as cup_group_id, sum(entry.delta)::int as points
      from public.points_ledger as entry
      join public.task_evaluations as evaluation on evaluation.id = entry.evaluation_id
      join public.tasks as task on task.id = entry.task_id
      join public.groups as task_group on task_group.id = task.group_id
      join lateral (
        select competing.id, ancestor.depth
          from unnest(task_group.path) with ordinality as ancestor(id, depth)
          join public.groups as competing on competing.id = ancestor.id and competing.competes_in_cup
         order by ancestor.depth desc
         limit 1
      ) as cup on true
     where entry.reason in ('task', 'task_reversal')
       and (p_campaign_id is null or task.campaign_id = p_campaign_id)
       and (p_from is null or evaluation.evaluated_at >= p_from)
       and (p_to is null or evaluation.evaluated_at < p_to)
       and not exists (
         select 1 from unnest(task_group.path) with ordinality as link(id, depth)
           join public.groups as node on node.id = link.id
          where link.depth > cup.depth and not node.counts_toward_parent_cup)
     group by cup.id
  ), active_members as (
    select membership.group_id, count(*)::bigint as members
      from public.group_members as membership
      join public.profiles as member on member.id = membership.member_id
     where member.status = 'activ'
     group by membership.group_id
  )
  select grp.id, grp.name,
         coalesce(task_points.points, 0), coalesce(active_members.members, 0)
    from public.groups as grp
    left join task_points on task_points.cup_group_id = grp.id
    left join active_members on active_members.group_id = grp.id
   where public.auth_level() >= 5
     and (select private.caller_level()) >= 5
     and exists (
       select 1
         from public.profiles as caller
        where caller.id = (select auth.uid())
          and caller.status = 'activ'
     )
     and grp.competes_in_cup
     -- #861 (Audit D-10): an archived Group has left the Cup.
     and grp.status = 'active'
   order by coalesce(task_points.points, 0) desc, grp.name asc;
$function$;

comment on function private.department_cup_rows(bigint, timestamptz, timestamptz) is
  'Live BCE+ Cup rows from active competing Group settings -- an archived Group has left the Cup (#861, Audit D-10). Task/reversal ledger points reach the nearest competing ancestor only when every lower link counts. Members are the active explicit roster of the competitor itself. The date range (#677) reads the award instant -- task_evaluations.evaluated_at through points_ledger.evaluation_id -- half-open [p_from, p_to); PT400 invalid_date_range first when p_to < p_from.';

-- ---------------------------------------------------------------------------
-- 3. Announcements: the author's read (D-12) and the dedupe key (D-20)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.fan_out_announcement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_audience_group bigint;
  v_recipients uuid[];
  v_actor uuid;
begin
  v_actor := coalesce((select auth.uid()), new.created_by);
  if new.audience = 'org' then
    select id into v_audience_group from public.groups where is_organization;
  else
    v_audience_group := new.group_id;
  end if;

  select array_agg(recipient.member_id order by recipient.member_id)
    into v_recipients
    from private.group_audience(v_audience_group) as recipient(member_id)
    join public.profiles as profile on profile.id = recipient.member_id
   where not exists (
     select 1 from public.notif_suppression as suppression
      where suppression.role = profile.role and suppression.kind = 'announce'
   )
     -- #756: an organization-wide Announcement of a Private Group reaches
     -- only those who can see the Group (announcements_read agrees).
     and private.can_see_group(new.group_id, recipient.member_id);

  -- #635: a critical Announcement's Notification is critical, so it still
  -- pushes to a Member who muted 'announce'.
  -- #861 (Audit D-20): keyed announcement:<id>, so reading the Announcement
  -- (private.mark_announcement_notification_read) finds and clears it.
  perform private.notify(v_recipients, 'announce',
    'Anunț nou: ' || new.title, new.body, null, 'announcement:' || new.id::text, v_actor,
    '/anunturi?anunt=' || new.id::text,
    new.priority = 'critical');

  -- #861 (Audit D-12): the author has read what they wrote. The
  -- announcements_read rule (private.can_read_announcement), judged for the
  -- author instead of the caller: a live Member who can see the Group and,
  -- for a local Audience, one in its Group Audience or holding a Manager /
  -- Responsible position on its path. A global writer who posts outside
  -- their own audience gets no row, as they could not write one themselves.
  if new.created_by is not null
     and private.actor_level(new.created_by) is not null
     and private.can_see_group(new.group_id, new.created_by)
     and (new.audience = 'org'
          or (new.audience = 'local' and (
              new.created_by in (select private.group_audience(new.group_id))
              or private.group_role_of(new.group_id, new.created_by) in ('manager', 'responsible')))) then
    insert into public.announcement_reads (announcement_id, member_id)
    values (new.id, new.created_by)
    on conflict do nothing;
  end if;
  return new;
end;
$function$;

comment on function private.fan_out_announcement() is
  'Broadcasts one in-app Notification per active Group Audience recipient after an Announcement insert (#68), keyed announcement:<id> (#861) so reading the Announcement marks it read. Local Audience uses its Origin Group; org Audience uses the Organization Group. The data-driven notif_suppression lookup filters broadcast kinds before private.notify removes duplicates, inactive recipients and the actual authenticated actor (or created_by for server-side inserts). Task notifications remain direct and unsuppressed. It also writes the author''s own announcement_reads row when the author is in the Announcement''s read audience (the announcements_read rule judged for created_by, #861), so the author''s own Announcement never counts as unread.';

-- ---------------------------------------------------------------------------
-- 4. Reading an Announcement marks its Notification read (D-20)
-- ---------------------------------------------------------------------------
create function private.mark_announcement_notification_read()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only the reader's own rows, only while unread: the one keyed
  -- announcement:<id>, and any older duplicate the backfill below left
  -- unkeyed (the partial unique index admits one unread row per key), found
  -- by the link every "Anunț nou" carries since #843.
  update public.notifications as notification
     set read = true
   where notification.member_id = new.member_id
     and not notification.read
     and (notification.dedupe_key = 'announcement:' || new.announcement_id::text
          or (notification.kind = 'announce'
              and notification.link = '/anunturi?anunt=' || new.announcement_id::text));
  return new;
end;
$$;

comment on function private.mark_announcement_notification_read() is
  'After-insert trigger on announcement_reads (#861, Audit D-20): marks the reader''s own unread "Anunț nou" Notifications for that Announcement (dedupe key announcement:<id>, or an unkeyed older duplicate linked /anunturi?anunt=<id>) read, and nobody else''s. Executable by no client role.';

revoke execute on function private.mark_announcement_notification_read()
  from public, anon, authenticated, service_role;

create trigger announcement_reads_mark_notification_read
  after insert on public.announcement_reads
  for each row execute function private.mark_announcement_notification_read();

-- The rows already delivered. #843 linked every announce row it could match
-- to /anunturi?anunt=<id>; the id in that link is the key. First the rows
-- whose member has already read the Announcement are marked read, then every
-- remaining row takes the key -- where a member somehow holds two unread rows
-- for one Announcement only the newest does, since the partial unique index
-- admits one unread row per key.
update public.notifications as notification
   set read = true
  from public.announcement_reads as reading
 where notification.kind = 'announce'
   and not notification.read
   and notification.link ~ '^/anunturi\?anunt=[0-9]+$'
   and reading.member_id = notification.member_id
   and reading.announcement_id = substring(notification.link from '^/anunturi\?anunt=([0-9]+)$')::bigint;

update public.notifications as notification
   set dedupe_key = 'announcement:' || substring(notification.link from '^/anunturi\?anunt=([0-9]+)$')
 where notification.kind = 'announce'
   and notification.dedupe_key is null
   and notification.link ~ '^/anunturi\?anunt=[0-9]+$'
   and (notification.read
        or not exists (
          select 1
            from public.notifications as newer
           where newer.member_id = notification.member_id
             and newer.kind = 'announce'
             and not newer.read
             and newer.link = notification.link
             and newer.id > notification.id));

-- ---------------------------------------------------------------------------
-- 5. One Notification when an Application is accepted (D-20). The Appointment
--    core gains p_notify (default true); a new argument changes the
--    signature, so it is dropped and recreated with its grant and comment.
--    Every caller names it positionally with three or five arguments and is
--    unchanged; only the accept path passes p_notify => false.
-- ---------------------------------------------------------------------------
drop function private.appoint_group_member(bigint, uuid, uuid, text, text);

create function private.appoint_group_member(p_group_id bigint, p_member_id uuid, p_actor uuid, p_group_role text DEFAULT 'member'::text, p_position_title text DEFAULT NULL::text, p_notify boolean DEFAULT true)
 RETURNS group_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_group   public.groups%rowtype;
  v_title   text := nullif(btrim(p_position_title), '');
  v_row     public.group_members%rowtype;
  v_display text;
begin
  -- No gate of its own (#582's private.cancel_event_effect established the
  -- shape): every caller brings its own authority — add_group_member_impl the
  -- work tier, set_group_role_impl the Manager tier, create_group_impl the
  -- parent's Managers, #602's provisioning the inviting BC's level. What lives
  -- here is what must be true of the ROSTER ROW whoever writes it, so that no
  -- second path can ever be a shortcut past it.
  --
  -- Malformed arguments first, as in every command (conventions section 2).
  -- set_group_role_impl has already answered these for a client call; a
  -- programmatic caller such as provisioning has not.
  if p_group_role is null or p_group_role not in ('manager', 'responsible', 'member') then
    raise sqlstate 'PT400' using message = 'invalid_group_role';
  end if;
  if p_position_title is not null and v_title is null then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;
  -- Security pass 2026-09-27 (L1): group_members_position_title_length_ck.
  perform private.require_text_length('position_title', v_title, null, 80);
  if p_group_role = 'responsible' and v_title is null then
    raise sqlstate 'PT400' using message = 'position_title_required';
  end if;
  if p_group_role <> 'responsible' and v_title is not null then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;

  select grp.* into v_group
    from public.groups as grp
   where grp.id = p_group_id
   for no key update;
  if not found then
    -- Non-disclosing, like every other refusal in this family: an unknown
    -- Group, an archived one below level 6 and one the caller may not touch
    -- are a single answer.
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

  -- The Member's profile is held FOR SHARE before a roster row names it, so a
  -- concurrent deactivation serializes behind this decision instead of
  -- committing underneath it (conventions section 2).
  perform 1 from public.profiles as target
    where target.id = p_member_id and target.status = 'activ'
    for share of target;
  if not found then
    raise sqlstate 'PT400' using message = 'group_member_not_eligible';
  end if;
  if coalesce(private.actor_level(p_member_id), -1) < v_group.min_level then
    raise sqlstate 'PT400' using message = 'group_member_below_min_level';
  end if;

  -- Shape 5: a Group whose roster follows the rank holds no ordinary rows.
  if p_group_role = 'member' and v_group.automatic_membership then
    raise sqlstate 'PT409' using message = 'automatic_group_has_no_roster_members';
  end if;

  if exists (select 1 from public.group_members as existing
              where existing.group_id = p_group_id
                and existing.member_id = p_member_id) then
    raise sqlstate 'PT409' using message = 'already_group_member';
  end if;

  insert into public.group_members (group_id, member_id, group_role, position_title)
  values (p_group_id, p_member_id, p_group_role, v_title)
  returning * into v_row;

  -- #861 (Audit D-20): a caller whose own Notification already tells the
  -- target (decide_group_application's "Cerere acceptată: <Group>") passes
  -- p_notify => false, so the target hears about one decision once. Every
  -- other caller keeps the default and this Notification.
  if p_notify is false then
    return v_row;
  end if;

  -- One direct Notification to the TARGET, in the same transaction, never to
  -- the actor (ruling R25 — private.notify drops the actor from the recipient
  -- array by itself, so an actor appointing themselves is told nothing). The
  -- link is the member-facing Group page (#589).
  if p_group_role = 'member' then
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Ai fost adăugat în ' || v_group.name,
      -- #843 (B36): the title says it all.
      null,
      null, null, p_actor, '/grupuri/' || p_group_id::text);
  else
    v_display := coalesce(v_title, nullif(btrim(v_group.manager_title), ''), 'coordonator de grup');
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Numire în ' || v_group.name,
      'Ai fost numit ' || v_display || ' în grupul ' || v_group.name || '.',
      null, null, p_actor, '/grupuri/' || p_group_id::text);
  end if;

  return v_row;
end;
$function$;

revoke execute on function private.appoint_group_member(bigint, uuid, uuid, text, text, boolean)
  from public, anon, authenticated, service_role;

comment on function private.appoint_group_member(bigint, uuid, uuid, text, text, boolean) is
  'The Appointment core (#583, rulings R6/R27): the ONLY insert path into public.group_members outside migrations'' own backfills, the Wave 1 mirror writers (dropped by #586) and rolled-back test fixtures. It carries no authority check of its own — like private.cancel_event_effect (#582), the gates stay with the callers: private.add_group_member_impl brings the work tier, private.set_group_role_impl the Manager tier, private.create_group_impl the parent''s Managers, and #602''s provisioning the inviting BC''s level, passed as p_actor. What it carries is everything that must be true of the roster row whoever writes it: the Group exists (42501 group_manage_forbidden, non-disclosing) and is active (PT409 group_archived); the Member is live (PT400 group_member_not_eligible — an unknown or inactive target) and at or above the Group''s Minimum Level (PT400 group_member_below_min_level); the Group Role is one of the three (PT400 invalid_group_role) with a display name exactly when it is responsible (PT400 position_title_required / invalid_position_title); an Automatic-Membership Group takes no ordinary row (PT409 automatic_group_has_no_roster_members); and the Member is not already on the roster (PT409 already_group_member). It holds the Group FOR NO KEY UPDATE and the target''s profiles row FOR SHARE, so a concurrent Minimum-Level raise or deactivation serializes behind the decision. It writes exactly one direct system Notification to the target with link /grupuri/<group_id> — added to the Group, or appointed under the position''s display name (the Group Responsible''s own title, or the Group setting groups.manager_title for a Group Manager) — and private.notify drops the actor, so appointing yourself notifies nobody. With p_notify => false it writes none (#861, Audit D-20): private.decide_group_application_impl passes it because its own "Cerere acceptată: <Group>" already tells the applicant. Executable by no client role.';

-- ---------------------------------------------------------------------------
-- 6. The accept path: the Appointment without its own Notification (D-20)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.decide_group_application_impl(p_application_id bigint, p_accept boolean, p_note text DEFAULT NULL::text)
 RETURNS group_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor    uuid;
  v_group_id bigint;
  v_group    public.groups%rowtype;
  v_row      public.group_applications%rowtype;
  v_note     text := nullif(btrim(p_note), '');
begin
  -- 1. Malformed for every caller, so it is answered ahead of any authority
  --    verdict (conventions section 2). There is no third answer to an
  --    Application: a caller that sends null has not decided anything.
  if p_accept is null then
    raise sqlstate 'PT400' using message = 'invalid_application_decision';
  end if;
  if p_note is not null and v_note is null then
    raise sqlstate 'PT400' using message = 'invalid_decision_note';
  end if;
  -- #724 (ruling R8): the decision note, measured as it is stored (trimmed).
  perform private.require_text_length('note', v_note, null, 1000);

  -- 2. Which Group's authority decides. Read unlocked first, because the gate
  --    must run before any lock on public.groups (#583's shape 6) and the gate
  --    needs the Group id; the row itself is re-read under its own lock at
  --    step 4, where the status that matters is the one under the lock.
  select application.group_id into v_group_id
    from public.group_applications as application
   where application.id = p_application_id;
  if not found then
    raise sqlstate 'PT404' using message = 'application_not_found';
  end if;

  -- Accepting an Application is a Group Responsible's power as much as a
  -- Group Manager's (ADR-0009 Entry paths), exactly like add_group_member —
  -- so this is the work tier, not #582's Manager tier.
  v_actor := private.require_group_work_manager(v_group_id);

  -- 3. Gate -> groups FOR NO KEY UPDATE -> the Application row FOR UPDATE, the
  --    same order every Group command takes.
  select grp.* into v_group
    from public.groups as grp
   where grp.id = v_group_id
   for no key update;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

  select application.* into v_row
    from public.group_applications as application
   where application.id = p_application_id
   for update of application;
  if not found then
    raise sqlstate 'PT404' using message = 'application_not_found';
  end if;
  if v_row.status <> 'pending' then
    raise sqlstate 'PT409' using message = 'application_not_pending';
  end if;

  -- 4. An accept is an Appointment and goes through the one insert path
  --    (shape 4): the applicant's live rank is judged against the Group's
  --    live Minimum Level there, so an Application filed before a demotion or
  --    a Minimum-Level raise answers PT400 group_member_below_min_level
  --    rather than placing a Member the Group no longer admits. The same call
  --    answers group_member_not_eligible for an applicant deactivated while
  --    pending, already_group_member if they were appointed in the meantime,
  --    and writes the new Member's own Notification.
  if p_accept then
    -- #861 (Audit D-20): without the Appointment core's own "Ai fost adăugat
    -- în …": "Cerere acceptată: <Group>" below is the one Notification the
    -- applicant gets for this decision.
    perform private.appoint_group_member(v_row.group_id, v_row.member_id, v_actor,
                                         p_notify => false);
  end if;

  update public.group_applications as application
     set status        = case when p_accept then 'accepted' else 'declined' end,
         decided_by    = v_actor,
         decided_at    = clock_timestamp(),
         decision_note = v_note
   where application.id = p_application_id
  returning * into v_row;

  -- 5. The applicant hears the answer. The link is the MEMBER-facing Group
  --    page (#589, ruling R8), not Administrare: an applicant has no reason
  --    and usually no right to open /administrare/grupuri/<id>. The dedupe
  --    key is the same 'application:<id>' the filing used, which collides with
  --    nothing — the filing went to the deciders, never to the applicant.
  perform private.notify(
    array[v_row.member_id], 'system'::public.noti_kind,
    case when p_accept then 'Cerere acceptată: ' || v_group.name
                       else 'Cerere respinsă: ' || v_group.name end,
    case when p_accept then 'Cererea ta de înscriere în grupul ' || v_group.name
                              || ' a fost acceptată.'
                       else 'Cererea ta de înscriere în grupul ' || v_group.name
                              || ' a fost respinsă.' end
      || case when v_note is null then '' else ' „' || v_note || '”' end,
    null, 'application:' || v_row.id::text, v_actor,
    '/grupuri/' || v_row.group_id::text);

  return v_row;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. The comments that promised the second Notification. Each sentence is
--    replaced in place; a sentence that is not there fails the migration
--    rather than leaving a stale comment behind.
-- ---------------------------------------------------------------------------
do $$
declare
  v_edit record;
  v_old  text;
begin
  for v_edit in
    select * from (values
      ('public.decide_group_application(bigint,boolean,text)',
       'and it writes the new Member''s own Appointment Notification.',
       'and it writes no Appointment Notification of its own (p_notify => false, #861): the decision''s Notification is the one the applicant gets.'),
      ('private.decide_group_application_impl(bigint,boolean,text)',
       'the Appointment on accept, and the applicant''s Notification.',
       'the Appointment on accept (without the Appointment core''s own Notification, #861), and the applicant''s one Notification.')
    ) as edit (fn, old_text, new_text)
  loop
    v_old := obj_description(v_edit.fn::regprocedure, 'pg_proc');
    if v_old is null or strpos(v_old, v_edit.old_text) = 0 then
      raise exception 'comment on % does not contain %', v_edit.fn, v_edit.old_text;
    end if;
    execute format('comment on function %s is %L', v_edit.fn,
                   replace(v_old, v_edit.old_text, v_edit.new_text));
  end loop;
end;
$$;

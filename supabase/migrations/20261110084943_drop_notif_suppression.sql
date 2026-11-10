-- #1181: drop public.notif_suppression, which no Fan-out applies (audit L30, decision 3 of #1144).
--
-- Its six seeded rows mute bc and bce for the task, event and deadline kinds,
-- but its one live reader, private.announcement_recipients, asks only for kind
-- 'announce', which no row has. BCE have heard every Event notice of their
-- Groups all along; what keeps BC and the Moderator out of a Group's notices is
-- R32 (no Notification through membership) and what lets a BC member back in is
-- R42 (a Group position), both in private.group_notification_audience_unmuted.
-- Nobody's recipients change: the filter never matched.

-- 1. The one live reader, rebuilt from 20261014153142_edit_notices.sql without
--    the lookup. Its join to public.profiles existed only to read the role the
--    lookup compared; every recipient comes from a Group roster, the Automatic
--    Membership of a Group or a BC position, all of them Profiles, so the join
--    dropped nobody and goes with it.
create or replace function private.announcement_recipients(p_row public.announcements)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_audience_group bigint;
  v_recipients uuid[];
  v_critical boolean := p_row.priority = 'critical';
begin
  if p_row.audience = 'org' then
    select id into v_audience_group from public.groups where is_organization;
  else
    v_audience_group := p_row.group_id;
  end if;

  -- #929 (R32): never a BC member or the Moderator through membership; R42: a BC
  -- member whose position reaches the audience Group or, for an organization-wide
  -- Announcement, its Origin -- it is still that Group's Announcement. R43: a
  -- Member who unselected the audience Group is left out (the Organization Group
  -- is locked, so an organization-wide Announcement reaches them), unless the
  -- Announcement is critical. R45: a Deal is organization-wide, so it follows
  -- exactly that rule.
  select array_agg(recipient.member_id order by recipient.member_id)
    into v_recipients
    from (select audience.member_id
            from private.group_notification_audience(v_audience_group) as audience(member_id)
           where not v_critical
          union
          select audience.member_id
            from private.group_notification_audience_unmuted(v_audience_group) as audience(member_id)
           where v_critical
          union
          select holder.member_id
            from private.board_position_holders(p_row.group_id) as holder(member_id)) as recipient
     -- #756: an organization-wide Announcement of a Private Group reaches
     -- only those who can see the Group (announcements_read agrees).
   where private.can_see_group(p_row.group_id, recipient.member_id)
     -- #909: no Notification to a Member below the Minimum Level, who cannot
     -- read the Announcement (announcements_read agrees).
     and coalesce(private.actor_level(recipient.member_id), -1) >= p_row.min_level
     -- R45: a Deal past its Termen reads only for the OSUBB Deals team and BC /
     -- the Moderator (announcements_read agrees), so nobody else is told of it
     -- (CodeRabbit on #1061: an edit of an expired Deal).
     and (p_row.kind is distinct from 'deal'
          or p_row.deadline is null
          or p_row.deadline >= now()
          or coalesce(private.actor_level(recipient.member_id), -1) >= 6
          or private.assignment_team_role('osubb_deals', recipient.member_id) is not null);
  return v_recipients;
end;
$$;
revoke execute on function private.announcement_recipients(public.announcements) from public, anon, authenticated, service_role;
comment on function private.announcement_recipients(public.announcements) is
  'R53: everyone a notice about this Announcement reaches -- the fan-out''s audience rule (R32, R42, R43, R45, #756, #909), moved here verbatim, and an expired Deal only to the OSUBB Deals team and BC / the Moderator and shared by the first notice, an edit notice and the Termen reminder. #1181 dropped the notif_suppression lookup, which no row matched. Granted to nobody.';

-- 2. The comments that still describe the table as applied. Each edit refuses
--    to run when the sentence it replaces is not there, so a comment rewritten
--    since cannot be skipped silently.
create function pg_temp.edit_comment(p_function regprocedure, p_old text, p_new text)
returns void
language plpgsql
as $fn$
declare
  v_comment text := obj_description(p_function, 'pg_proc');
begin
  if v_comment is null or strpos(v_comment, p_old) = 0 then
    raise exception 'the comment on % no longer says: %', p_function, p_old;
  end if;
  execute format('comment on function %s is %L', p_function, replace(v_comment, p_old, p_new));
end;
$fn$;

select pg_temp.edit_comment(
  'private.notify(uuid[], public.noti_kind, text, text, bigint, text, uuid, text, boolean)'::regprocedure,
  ' Task Notifications are direct and are never suppressed -- notif_suppression applies only to the broadcast/announcement fan-out (#68), not here.',
  ' Every recipient the caller names is written: who hears of what is decided by the caller.');

select pg_temp.edit_comment(
  'private.enqueue_push_deliveries()'::regprocedure,
  ' Suppression is already applied where the Notification row was written, so it is never re-applied here (ADR-0010) -- re-applying notif_suppression would silence BC''s direct Task Notifications.',
  ' Who receives a Notification is decided where its row is written (ADR-0010), never here.');

select pg_temp.edit_comment(
  'private.fan_out_announcement()'::regprocedure,
  ' The data-driven notif_suppression lookup filters broadcast kinds, then Private Group visibility (#756) and the Minimum Level (#909),',
  ' Private Group visibility (#756) and the Minimum Level (#909) filter them,');

select pg_temp.edit_comment(
  'private.fan_out_announcement()'::regprocedure,
  ' Task notifications remain direct and unsuppressed.',
  ' Task notifications remain direct.');

drop function pg_temp.edit_comment(regprocedure, text, text);

-- 3. The table, with its read policy and grants. It carries no broadcast_change
--    trigger (live_changes.test.sql excluded it by name).
drop table public.notif_suppression;

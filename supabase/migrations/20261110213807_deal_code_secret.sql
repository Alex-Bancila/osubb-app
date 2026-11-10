-- #1152: the Deal Code leaves the server only through public.reveal_deal_code,
-- which records the reveal -- and, for whoever may edit the Deal, through
-- public.deal_code_for_edit, which records nothing.
--
-- authenticated read every column of public.announcements through a
-- table-wide SELECT grant, so any Member could read a Deal's code straight
-- from the row (select=code) and no reveal was ever recorded. A column-level
-- `revoke select (code)` is a no-op while the table-wide grant stands (a table
-- grant implies every column -- 20260822225003_profiles_read_policies.sql met
-- the same rule), so the table grant goes and every other column comes back
-- by name. From here on a new announcements column is unreadable by
-- authenticated until its own migration grants it, as for profiles.
--
-- has_code (stored generated: code is not null) is what the Deal read selects
-- to draw the hidden stub. Not a view: a security_invoker view runs as the
-- reader, who can no longer read code, and an owner-rights view is a Security
-- Advisor ERROR (conventions §4). Not a computed field: PostgREST passes it
-- the whole row, and a whole-row reference needs SELECT on every column,
-- code included. A generated column is granted like any other column, is
-- kept in step by Postgres on every write, and costs one byte a row.
--
-- private.stamp_approval (restated from 20261014160759_reminders.sql) skips
-- has_code: Postgres computes a stored generated column after the BEFORE
-- triggers, so NEW.has_code is null inside one, and the whole-row compare
-- would read every write below BC to an approved organisation-wide
-- Announcement as a content change. code itself is still compared.
--
-- public.reveal_deal_code is unchanged: it already recorded the reveal once
-- (on conflict do nothing) and returned the code. public.approve_announcement
-- and public.reject_announcement still return a whole announcements row,
-- code included, from their definer bodies: a Deal is never pending (the stamp
-- publishes it at once) and only BC and the Moderator get past their gate,
-- who may edit, and so read, every Deal's code anyway.

-- 1. has_code
alter table public.announcements
  add column has_code boolean not null generated always as (code is not null) stored;

comment on column public.announcements.has_code is
  '#1152: whether the row carries a Deal Code (code is not null), computed by Postgres on every write. The Deal read selects it to draw the hidden stub; the code itself is never readable by authenticated.';

comment on column public.announcements.code is
  'R45: a Deal''s optional Deal Code (at most 80 characters, trimmed). #1152: not readable by authenticated -- the table grant is per column and leaves it out. A reader gets it from public.reveal_deal_code, which records the reveal; whoever may edit the Deal (private.can_manage_deal) from public.deal_code_for_edit, which records nothing. Writable with the row under announcements_create / announcements_update.';

-- 2. Every column but code, by name.
revoke select on table public.announcements from authenticated;
grant select (id, title, body, priority, pinned, form_label, form_url, published_at, created_by,
              group_id, audience, deadline, min_level, links, kind, approval_status,
              approval_decided_by, approval_decided_at, rejection_reason, event_id, from_event,
              has_code)
  on table public.announcements to authenticated;

-- 3. The approval stamp: has_code is never content.
CREATE OR REPLACE FUNCTION private.stamp_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_level integer;
  v_org boolean;
  -- A Campaign is a reporting label, never content (ADR-0007): changing or
  -- clearing it -- a Campaign manager's deletion does -- asks nobody again (M4).
  v_skip constant text[] := array['approval_status', 'approval_decided_by', 'approval_decided_at', 'rejection_reason',
                                  'updated_at', 'pinned', 'cancelled_at', 'cancel_reason', 'announce_on_approval',
                                  'campaign_id',
                                  -- R53: the Event an Announcement was written for is
                                  -- bookkeeping, never content -- its link being written or
                                  -- cleared (the Event deleted) asks nobody again.
                                  'event_id', 'from_event',
                                  -- #1152: computed from code after this trigger, so null
                                  -- in NEW here; code is compared itself.
                                  'has_code'];
  v_was_org boolean;
  v_changed boolean;
begin
  -- The decision commands write the approval columns themselves -- on an
  -- update only: an insert is always judged (M7).
  if tg_op = 'UPDATE' and coalesce(current_setting('osubb.deciding_approval', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- A client value is ignored: the stamp decides.
    new.approval_status := 'approved';
    new.approval_decided_by := null;
    new.approval_decided_at := null;
    new.rejection_reason := null;
    if v_actor is null then
      return new;  -- migrations, seed, jobs: published
    end if;
    -- A Deal (R45) is the OSUBB Deals team's own publication, never a request.
    if tg_table_name = 'announcements' and (to_jsonb(new) ->> 'kind') = 'deal' then
      return new;
    end if;
    select grp.is_organization into v_org from public.groups as grp where grp.id = new.group_id;
    -- OSUBB-wide: the Organization Group, or an Announcement whose Audience is
    -- the whole organisation from any Group (security review of 2026-10-11).
    v_org := coalesce(v_org, false)
             or (tg_table_name = 'announcements' and (to_jsonb(new) ->> 'audience') = 'org');
    v_level := coalesce(private.actor_level(v_actor), 0);
    if v_org and v_level < 6 then
      new.approval_status := 'pending';
    end if;
    return new;
  end if;
  -- UPDATE: the approval columns are kept; an author's content edit of a
  -- decided OSUBB-wide row re-enters review.
  new.approval_status := old.approval_status;
  new.approval_decided_by := old.approval_decided_by;
  new.approval_decided_at := old.approval_decided_at;
  new.rejection_reason := old.rejection_reason;
  if v_actor is null then
    return new;
  end if;
  if tg_table_name = 'announcements' and (to_jsonb(new) ->> 'kind') = 'deal' then
    return new;
  end if;
  select grp.is_organization into v_org from public.groups as grp where grp.id = new.group_id;
  v_org := coalesce(v_org, false)
           or (tg_table_name = 'announcements' and (to_jsonb(new) ->> 'audience') = 'org');
  if not v_org then
    -- No longer OSUBB-wide -- moved to a local Group, or the Audience narrowed:
    -- there is nothing to approve, so a pending or rejected row is published
    -- by the change itself (I2). An Announcement it asked for is not written:
    -- a local Event's Announcement is its author's to post.
    if old.approval_status <> 'approved' then
      new.approval_status := 'approved';
      new.approval_decided_by := null;
      new.approval_decided_at := null;
      new.rejection_reason := null;
      if tg_table_name = 'events' then
        new.announce_on_approval := false;
      end if;
    end if;
    return new;
  end if;
  v_level := coalesce(private.actor_level(v_actor), 0);
  if v_level >= 6 then
    return new;
  end if;
  -- Became OSUBB-wide by this very change -- a local Event moved onto the
  -- Organization Group, an Audience widened -- below BC: a request, whoever
  -- made it (a Group Manager may move a member's Event; security review of
  -- 2026-10-13).
  select grp.is_organization into v_was_org from public.groups as grp where grp.id = old.group_id;
  v_was_org := coalesce(v_was_org, false)
               or (tg_table_name = 'announcements' and (to_jsonb(old) ->> 'audience') = 'org');
  if not v_was_org then
    new.approval_status := 'pending';
    new.approval_decided_by := null;
    new.approval_decided_at := null;
    new.rejection_reason := null;
    return new;
  end if;
  -- A content change by any writer below BC asks again.
  v_changed := (to_jsonb(new) - v_skip) is distinct from (to_jsonb(old) - v_skip);
  if v_changed and old.approval_status in ('approved', 'rejected') then
    new.approval_status := 'pending';
    new.approval_decided_by := null;
    new.approval_decided_at := null;
    new.rejection_reason := null;
  end if;
  return new;
end;
$function$;

comment on function private.stamp_approval() is
  'announcements_stamp_approval / events_stamp_approval (before insert or update; spec 2026-10-11): on insert the status is pending for a row on the Organization Group -- or an Announcement with the organisation Audience from any Group -- by a signed-in writer below level 6 and approved otherwise (a client value is ignored; a write with no auth.uid() publishes); on update the approval columns are kept, except that a writer below level 6 changing the content of a decided OSUBB-wide row (anything but the approval columns, updated_at, pinned, cancelled_at, cancel_reason, announce_on_approval and campaign_id -- a Campaign is a label) sends it back to pending with the decision cleared, that a row which becomes OSUBB-wide by an update below level 6 (a move onto the Organization Group, an Audience widened) is pending whoever made the change, and that a pending or rejected row which stops being OSUBB-wide (moved to a local Group, or its Audience narrowed) is published by that change, its announce_on_approval dropped (final review of 2026-10-13). A Deal (kind deal, R45) is never pending: the OSUBB Deals team publishes it at once. The decision commands set osubb.deciding_approval = on for their own update; an insert is always judged. R53 (2026-10-14): announcements.event_id and from_event -- the Event an Announcement was written for -- are bookkeeping too, so writing or clearing them (the Event deleted) asks nobody again. #1152: announcements.has_code, which Postgres computes from code after the BEFORE triggers (so it is null in NEW here), is skipped too; code itself is still compared.';

-- 4. The edit sheets' read: the code, for whoever may edit the Deal.
create function private.deal_code_for_edit_impl(p_announcement_id bigint)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_deal  public.announcements%rowtype;
begin
  if v_actor is null or not coalesce(public.auth_is_member(), false)
     or private.actor_level(v_actor) is null then
    raise exception using errcode = '42501', message = 'deal_code_forbidden';
  end if;
  select * into v_deal from public.announcements as announcement
   where announcement.id = p_announcement_id and announcement.kind = 'deal';
  -- Hidden and missing are one answer, as for the reveal.
  if not found
     or not private.can_read_announcement(v_deal.group_id, v_deal.audience, v_deal.min_level,
                                          v_deal.created_by, v_deal.kind, v_deal.deadline) then
    raise sqlstate 'PT404' using message = 'deal_not_found';
  end if;
  -- The edit's own rule (announcements_update on a Deal).
  if not private.can_manage_deal(v_deal.created_by) then
    raise exception using errcode = '42501', message = 'deal_code_forbidden';
  end if;
  return v_deal.code;
end;
$$;

comment on function private.deal_code_for_edit_impl(bigint) is
  '#1152: body of public.deal_code_for_edit. 42501 deal_code_forbidden without organization claims or a live activ Profile; PT404 deal_not_found for a missing Announcement, one that is not a Deal, or a Deal the caller cannot read (private.can_read_announcement); 42501 deal_code_forbidden unless private.can_manage_deal(created_by) -- the rule announcements_update applies to a Deal. Returns the code (null when the Deal has none) and records nothing.';

create function public.deal_code_for_edit(p_announcement_id bigint)
returns text
language sql
stable
set search_path = ''
as $$
  select private.deal_code_for_edit_impl(p_announcement_id);
$$;

comment on function public.deal_code_for_edit(bigint) is
  '#1152: a Deal''s code for its edit sheet, to whoever may edit the Deal (BC and the Moderator any Deal, the Coordonator any, the Responsabil their own -- private.can_manage_deal). Not a reveal: nothing is recorded in deal_code_reveals, so the team''s count stays the Members''. Reasons: 42501 deal_code_forbidden, PT404 deal_not_found.';

revoke execute on function private.deal_code_for_edit_impl(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.deal_code_for_edit(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.deal_code_for_edit_impl(bigint) to authenticated;
grant execute on function public.deal_code_for_edit(bigint) to authenticated;

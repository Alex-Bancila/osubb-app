-- Ruling R50 (Alex, 2026-10-13): only BC and the Moderator pin an
-- organisation-wide Announcement -- one on the Organization Group, or one with
-- the organisation Audience from any Group. R48 stands otherwise: its author
-- still edits and deletes it; a local Announcement is pinned by whoever
-- manages it. The rule is a guard on the pin itself, so announcements_update
-- (R48's author arm) is unchanged and a pin by BC never re-enters review
-- (private.stamp_approval keeps pinned out of its content comparison).

create function private.guard_announcement_pin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org boolean;
begin
  if v_actor is null or new.kind = 'deal' then
    return new;  -- a migration / seed / job; a Deal is never pinned by R45's own constraint
  end if;
  -- A pin: pinned changing on an update, or a row written already pinned
  -- (security review of 2026-10-13: the compose sheet offers the pin at
  -- creation).
  if tg_op = 'UPDATE' and new.pinned is not distinct from old.pinned then
    return new;
  end if;
  if tg_op = 'INSERT' and not coalesce(new.pinned, false) then
    return new;
  end if;
  select grp.is_organization into v_org from public.groups as grp where grp.id = new.group_id;
  v_org := coalesce(v_org, false) or new.audience = 'org';
  if v_org and coalesce(private.actor_level(v_actor), 0) < 6 then
    raise exception using errcode = '42501', message = 'announcement_pin_forbidden';
  end if;
  return new;
end;
$$;
comment on function private.guard_announcement_pin() is
  'announcements_guard_pin (before insert, and before update of pinned; ruling R50, 2026-10-13): a pin -- pinned changing, or a row inserted already pinned -- on an organisation-wide Announcement -- the Organization Group, or the organisation Audience from any Group -- by a signed-in writer below level 6 is 42501 announcement_pin_forbidden; BC and the Moderator pin it, its author edits and deletes it (R48), and a local Announcement is pinned by whoever manages it. A write with no auth.uid() passes; a Deal (kind deal) is left to R45''s own constraint.';
revoke execute on function private.guard_announcement_pin() from public, anon, authenticated, service_role;

create trigger announcements_guard_pin
  before insert or update of pinned on public.announcements
  for each row execute function private.guard_announcement_pin();

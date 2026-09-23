-- #68: broadcast announcements through the shared Group Audience and notify helpers.
create function private.fan_out_announcement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
   );

  perform private.notify(v_recipients, 'announce',
    'Anunț nou: ' || new.title, new.body, null, null, v_actor, '/anunturi');
  return new;
end;
$$;

create trigger announcements_fan_out
  after insert on public.announcements
  for each row execute function private.fan_out_announcement();

revoke execute on function private.fan_out_announcement()
  from public, anon, authenticated, service_role;

comment on function private.fan_out_announcement() is
  'Broadcasts one in-app Notification per active Group Audience recipient after an Announcement insert (#68). Local Audience uses its Origin Group; org Audience uses the Organization Group. The data-driven notif_suppression lookup filters broadcast kinds before private.notify removes duplicates, inactive recipients and the actual authenticated actor (or created_by for server-side inserts). Task notifications remain direct and unsuppressed.';

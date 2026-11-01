-- #1149: public.group_archive_preview -- what archiving a Group would act on, read before the confirmation as group_delete_preview is read before a delete.
--
-- Audit 2026-10-30, finding M21. The archive dialogs said only "Grupul nu mai
-- poate primi taskuri, evenimente sau membri noi. Istoricul rămâne.", while
-- private.archive_group_impl cancels every future Event of the subtree (a
-- fan-out to every attendee), declines every pending Application (the
-- applicants notified) and archives every descendant -- and unarchive_group
-- (R65) restores none of it. The delete dialog already lists its consequences
-- from public.group_delete_preview; archiving gets its own preview, one per
-- command, so the dialog can show the counts and say "Dezarhivarea nu le
-- readuce." before anything is cancelled.
--
-- The preview reads, it never locks a Group, Event or Application row:
-- private.require_group_remover is archive_group's own authority (a top-level
-- Group is BC's and the Moderator's, a Child Group its Managers'), then the
-- #1129 refusal (PT409 group_protected) the archive itself would answer, then
-- the three counts over `path @> array[id]`. archive_group_impl is untouched.

create function private.group_archive_preview_impl(p_group_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_group_remover(p_group_id);
  if private.is_protected_group(p_group_id) then
    raise sqlstate 'PT409' using message = 'group_protected';
  end if;
  return (
    with subtree as (
      select grp.id from public.groups as grp where grp.path @> array[p_group_id]
    )
    select jsonb_build_object(
      'subgroups',    (select count(*) - 1 from subtree),
      'events',       (select count(*) from public.events as event
                        where event.group_id in (select subtree.id from subtree)
                          and event.cancelled_at is null
                          and event.starts_at > now()),
      'applications', (select count(*) from public.group_applications as application
                        where application.group_id in (select subtree.id from subtree)
                          and application.status = 'pending')));
end;
$$;

create function public.group_archive_preview(p_group_id bigint)
returns jsonb
language sql
set search_path = ''
as $$
  select private.group_archive_preview_impl(p_group_id);
$$;

comment on function private.group_archive_preview_impl(bigint) is
  '#1149: body of public.group_archive_preview: private.require_group_remover (archive_group''s authority), PT409 group_protected for a Group archive_group refuses (#1129, private.is_protected_group), then the counts. Reads only; no Group, Event or Application row is locked.';
comment on function public.group_archive_preview(bigint) is
  '#1149 (audit M21): what archiving a Group would act on, read by the archive confirmation as group_delete_preview is read by the delete dialog: subgroups (every Group below it, archived with it), events (the subtree''s future Events still standing, each cancelled with a Notification to its attendees) and applications (the subtree''s pending Applications, each declined with a Notification to the applicant) -- none of which unarchive_group (R65) restores. Callable by whoever may archive the Group (42501 group_manage_forbidden otherwise, an unknown id included); PT409 group_protected for the Organization Group, an Automatic-Membership Group, the board or AG Group set in Setări or a Group above one. Body: private.group_archive_preview_impl.';

revoke execute on function private.group_archive_preview_impl(bigint) from public, anon, authenticated, service_role;
revoke execute on function public.group_archive_preview(bigint) from public, anon, authenticated, service_role;
grant execute on function private.group_archive_preview_impl(bigint) to authenticated;
grant execute on function public.group_archive_preview(bigint) to authenticated;

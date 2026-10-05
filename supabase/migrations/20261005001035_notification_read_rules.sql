-- #1012: a Notification is read when it is opened from outside the app or acted on; mark-all for level >= 5.
--
-- Ruling R37 (Alex, 2026-10-05) amends R16 ("read only when opened in
-- Notificări, no mark-all"):
--
--   1. A push tap or an Email Digest link opens the target with the
--      Notification's id, and the app marks that one row read (the single-row
--      update #65 already grants). Nothing on the server: the app and the
--      service worker carry it.
--   2. Opening or acting on what a Notification is about marks the Member's
--      own unread Notifications about that thing read. Every Notification
--      about one thing now carries a stable SUBJECT naming it --
--      task:<id>, event:<id>, announcement:<id>, completed_work_request:<id>,
--      group_application:<id>, promotion_candidate:<member>,
--      retention_signal:<member> -- and
--        * public.mark_notifications_read_for(subject) marks the caller's own
--          (the app calls it when a screen opens the thing);
--        * the commands that act on a thing mark their ACTOR's own, through
--          triggers on the rows those commands write: a Task's activity row,
--          an Application's or a Completed-work Request's decision, a
--          Promotion Candidate's decision and an RSVP. Reading an
--          Announcement already did so (#861, D-20) and is unchanged.
--      Another decider's copy stays unread in every case: a trigger marks
--      only the row's actor, and only when that actor is the signed-in
--      caller, so no command marks another Member's Notifications.
--   3. public.mark_all_notifications_read() for a live level >= 5 (BCE, BC,
--      the Moderator); anyone else gets 42501.
--
-- The subject is derived, never passed: a BEFORE INSERT trigger on
-- notifications computes it from the row's task_id, dedupe_key and link
-- (private.notification_subject), so none of the ~35 writers of
-- private.notify changes. The one writer whose row named nothing derivable --
-- the "Cerere respinsă" Notification to a Request's requester -- now carries
-- the dedupe key request:<id> that "Cerere nouă" already uses; it is rebuilt
-- from main's latest body (20260928100000_notification_links.sql), and only
-- that argument differs. The requester is never one of the Request's deciders
-- (private.require_request_decider), so the key collides with no unread row.
--
-- Notifications with no subject stay so: Role and Group membership changes,
-- push health, delivery problems -- nothing to open or act on but the
-- Notification itself.
--
-- The rows already delivered are backfilled by the same rule, from their
-- task_id, dedupe key and link (#843's links); the update names no Member and
-- carries no personal data. A "Cerere respinsă" delivered before this
-- migration named no Request and keeps a null subject.

-- ---------------------------------------------------------------------------
-- 1. The subject
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column subject text,
  add constraint notifications_subject_length_ck
    check (subject is null or char_length(subject) <= 120);

comment on column public.notifications.subject is
  '#1012 (R37): the thing this Notification is about -- task:<id>, event:<id>, announcement:<id>, completed_work_request:<id>, group_application:<id>, promotion_candidate:<member>, retention_signal:<member> -- or null when it is about nothing but itself. Derived on insert by private.notification_subject from task_id, dedupe_key and link; opening or acting on the thing marks the Member''s own unread rows with that subject read.';

create function private.notification_subject(p_task_id bigint, p_dedupe_key text, p_link text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    'task:' || p_task_id::text,
    case
      when p_dedupe_key ~ '^task:[0-9]+(:|$)'
        then 'task:' || substring(p_dedupe_key from '^task:([0-9]+)')
      when p_dedupe_key ~ '^event:[0-9]+(:|$)'
        then 'event:' || substring(p_dedupe_key from '^event:([0-9]+)')
      when p_dedupe_key ~ '^announcement:[0-9]+$'
        then p_dedupe_key
      when p_dedupe_key ~ '^request:[0-9]+$'
        then 'completed_work_request:' || substring(p_dedupe_key from '^request:([0-9]+)$')
      when p_dedupe_key ~ '^application:[0-9]+$'
        then 'group_application:' || substring(p_dedupe_key from '^application:([0-9]+)$')
      when p_dedupe_key ~ '^promotion_candidate:(live|[0-9]+):[0-9a-f-]{36}$'
        then 'promotion_candidate:' || substring(p_dedupe_key from '([0-9a-f-]{36})$')
      when p_dedupe_key ~ '^retention_signal:[0-9]+:[0-9a-f-]{36}$'
        then 'retention_signal:' || substring(p_dedupe_key from '([0-9a-f-]{36})$')
    end,
    case
      when p_link ~ '^/tracker\?task=[0-9]+$'
        then 'task:' || substring(p_link from '^/tracker\?task=([0-9]+)$')
      when p_link ~ '^/tracker/[0-9]+$'
        then 'task:' || substring(p_link from '^/tracker/([0-9]+)$')
      when p_link ~ '^/calendar\?event=[0-9]+$'
        then 'event:' || substring(p_link from '^/calendar\?event=([0-9]+)$')
      when p_link ~ '^/anunturi\?anunt=[0-9]+$'
        then 'announcement:' || substring(p_link from '^/anunturi\?anunt=([0-9]+)$')
    end
  );
$$;

comment on function private.notification_subject(bigint, text, text) is
  '#1012 (R37): the subject a Notification row is about, from its task_id (task:<id>), else its dedupe key (task:/event:<id>:<field>, announcement:<id>, request:<id> -> completed_work_request:<id>, application:<id> -> group_application:<id>, promotion_candidate:<run|live>:<member> -> promotion_candidate:<member>, retention_signal:<run>:<member> -> retention_signal:<member>), else its link (/tracker?task=, /tracker/<id>, /calendar?event=, /anunturi?anunt=), else null. Pure; used by the insert trigger and the backfill. Executable by no client role.';

revoke execute on function private.notification_subject(bigint, text, text)
  from public, anon, authenticated, service_role;

create function private.derive_notification_subject()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.subject := coalesce(new.subject,
    private.notification_subject(new.task_id, new.dedupe_key, new.link));
  return new;
end;
$$;

comment on function private.derive_notification_subject() is
  '#1012 (R37): before-insert trigger on notifications -- fills subject from private.notification_subject when the writer left it null. Executable by no client role.';

revoke execute on function private.derive_notification_subject()
  from public, anon, authenticated, service_role;

create trigger notifications_derive_subject
  before insert on public.notifications
  for each row execute function private.derive_notification_subject();

-- The rows already delivered: the same rule, nothing per Member.
update public.notifications
   set subject = private.notification_subject(task_id, dedupe_key, link)
 where subject is null
   and private.notification_subject(task_id, dedupe_key, link) is not null;

-- Every read-for and act-on write looks for one Member's unread rows about
-- one thing.
create index notifications_member_subject_unread_idx
  on public.notifications (member_id, subject)
  where not read and subject is not null;

-- ---------------------------------------------------------------------------
-- 2. The one shared write: a Member's own unread rows about one subject
-- ---------------------------------------------------------------------------
create function private.mark_own_notifications_read(p_member_id uuid, p_subject text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.notifications as notification
     set read = true
   where notification.member_id = p_member_id
     and notification.subject = p_subject
     and not notification.read;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function private.mark_own_notifications_read(uuid, text) is
  '#1012 (R37): marks one Member''s unread Notifications with one subject read and returns how many. Called only by mark_notifications_read_for_impl (for the caller) and the act-on triggers (for the row''s actor when that actor is the caller). Executable by no client role.';

revoke execute on function private.mark_own_notifications_read(uuid, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Opening a thing: public.mark_notifications_read_for(subject)
-- ---------------------------------------------------------------------------
create function private.mark_notifications_read_for_impl(p_subject text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_count integer;
begin
  -- 1. Malformed for everyone: an exact subject, or the bare word
  --    promotion_candidate for the Promotion Candidates list, which shows
  --    every candidate at once.
  if p_subject is null
     or not (
       p_subject ~ '^(task|event|announcement|completed_work_request|group_application):[1-9][0-9]{0,18}$'
       or p_subject ~ '^(promotion_candidate|retention_signal):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or p_subject = 'promotion_candidate'
     ) then
    raise sqlstate 'PT400' using message = 'invalid_subject';
  end if;

  -- 2. Gate: a live Member, own rows only.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'notification_read_forbidden';
  end;

  if p_subject = 'promotion_candidate' then
    update public.notifications as notification
       set read = true
     where notification.member_id = v_actor
       and notification.subject like 'promotion\_candidate:%'
       and not notification.read;
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  return private.mark_own_notifications_read(v_actor, p_subject);
end;
$$;

comment on function private.mark_notifications_read_for_impl(text) is
  '#1012 (R37): body of public.mark_notifications_read_for. PT400 invalid_subject unless the subject is task|event|announcement|completed_work_request|group_application:<id>, promotion_candidate|retention_signal:<member uuid>, or the bare promotion_candidate (the whole Promotion Candidates list); 42501 notification_read_forbidden without a live Profile. Marks only the caller''s own unread rows and returns how many.';

revoke execute on function private.mark_notifications_read_for_impl(text)
  from public, anon, authenticated, service_role;
grant execute on function private.mark_notifications_read_for_impl(text) to authenticated;

create function public.mark_notifications_read_for(p_subject text)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.mark_notifications_read_for_impl(p_subject);
$$;

comment on function public.mark_notifications_read_for(text) is
  '#1012 (R37): opening a thing reads its Notifications -- marks the caller''s own unread Notifications about one subject read, in one request, and returns how many.';

revoke execute on function public.mark_notifications_read_for(text)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_notifications_read_for(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Mark-all for BCE, BC and the Moderator
-- ---------------------------------------------------------------------------
create function private.mark_all_notifications_read_impl()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_count integer;
begin
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'notification_mark_all_forbidden';
  end;
  -- The live rank, never the token's: a demoted Member's claims keep the old
  -- level for up to an hour.
  if private.caller_level() < 5 then
    raise exception using errcode = '42501', message = 'notification_mark_all_forbidden';
  end if;

  update public.notifications as notification
     set read = true
   where notification.member_id = v_actor
     and not notification.read;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function private.mark_all_notifications_read_impl() is
  '#1012 (R37): body of public.mark_all_notifications_read. 42501 notification_mark_all_forbidden unless the caller is a live Member at level >= 5 (BCE, BC, the Moderator); one statement over the caller''s own unread rows; returns how many.';

revoke execute on function private.mark_all_notifications_read_impl()
  from public, anon, authenticated, service_role;
grant execute on function private.mark_all_notifications_read_impl() to authenticated;

create function public.mark_all_notifications_read()
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.mark_all_notifications_read_impl();
$$;

comment on function public.mark_all_notifications_read() is
  '#1012 (R37, amends R16): "Marchează toate ca citite" -- every unread Notification of the caller, for a live level >= 5 only.';

revoke execute on function public.mark_all_notifications_read()
  from public, anon, authenticated, service_role;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Acting on a thing reads the actor's own Notifications about it
-- ---------------------------------------------------------------------------
-- Each trigger marks the row's actor only, and only when that actor is the
-- signed-in caller: a job (no auth.uid()) or a manager writing someone else's
-- row marks nothing.

-- 5a. A Task: every activity row the actor writes on the Task itself -- the
--     queue, a selection or assignment, start, submission, review, return,
--     evaluation, reopening, cancellation, giving up, an edit. Not the side
--     rows a command writes on another Task: 'subtask_completed' (on the
--     Umbrella), a cascade ('cascade_from'), 'duplicated' (on the source) and
--     'created' (nobody has a Notification about a Task that did not exist).
create function private.mark_task_notifications_read_on_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.actor_id = (select auth.uid()) then
    perform private.mark_own_notifications_read(new.actor_id, 'task:' || new.task_id::text);
  end if;
  return null;
end;
$$;

comment on function private.mark_task_notifications_read_on_activity() is
  '#1012 (R37): after-insert trigger on task_activity -- the actor''s own unread task:<id> Notifications become read when they act on the Task (the trigger''s WHEN clause leaves out created, duplicated, subtask_completed and cascade rows). Only when the actor is the signed-in caller. Executable by no client role.';

revoke execute on function private.mark_task_notifications_read_on_activity()
  from public, anon, authenticated, service_role;

create trigger task_activity_mark_notifications_read
  after insert on public.task_activity
  for each row
  when (new.actor_id is not null
        and new.kind not in ('created', 'duplicated', 'subtask_completed')
        and not (new.details ? 'cascade_from'))
  execute function private.mark_task_notifications_read_on_activity();

-- 5b. An Application decided (accepted, declined, or declined by archiving
--     its Group): the decider's "Cerere de înscriere".
create function private.mark_application_notifications_read_on_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.decided_by = (select auth.uid()) then
    perform private.mark_own_notifications_read(new.decided_by, 'group_application:' || new.id::text);
  end if;
  return null;
end;
$$;

comment on function private.mark_application_notifications_read_on_decision() is
  '#1012 (R37): after-update trigger on group_applications -- when a pending Application is decided, the decider''s own unread group_application:<id> Notifications become read; other deciders'' copies stay unread. Only when the decider is the signed-in caller. Executable by no client role.';

revoke execute on function private.mark_application_notifications_read_on_decision()
  from public, anon, authenticated, service_role;

create trigger group_applications_mark_notifications_read
  after update of status on public.group_applications
  for each row
  when (old.status = 'pending' and new.status <> 'pending' and new.decided_by is not null)
  execute function private.mark_application_notifications_read_on_decision();

-- 5c. A Completed-work Request approved or rejected: the decider's
--     "Cerere nouă".
create function private.mark_request_notifications_read_on_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.decided_by = (select auth.uid()) then
    perform private.mark_own_notifications_read(new.decided_by, 'completed_work_request:' || new.id::text);
  end if;
  return null;
end;
$$;

comment on function private.mark_request_notifications_read_on_decision() is
  '#1012 (R37): after-update trigger on completed_work_requests -- when a pending Request is approved or rejected, the decider''s own unread completed_work_request:<id> Notifications become read; other deciders'' copies stay unread. Only when the decider is the signed-in caller. Executable by no client role.';

revoke execute on function private.mark_request_notifications_read_on_decision()
  from public, anon, authenticated, service_role;

create trigger completed_work_requests_mark_notifications_read
  after update of status on public.completed_work_requests
  for each row
  when (old.status = 'pending' and new.status <> 'pending' and new.decided_by is not null)
  execute function private.mark_request_notifications_read_on_decision();

-- 5d. A Promotion Candidate decided: rejected (reject_promotion_candidate) or
--     promoted (the BC who changed the Role, through the role_history
--     trigger). Superseding is no decision -- a run re-lists the Member, by
--     the BC who ran it -- and marks nothing.
create function private.mark_candidate_notifications_read_on_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.decided_by = (select auth.uid()) then
    perform private.mark_own_notifications_read(new.decided_by, 'promotion_candidate:' || new.member_id::text);
  end if;
  return null;
end;
$$;

comment on function private.mark_candidate_notifications_read_on_decision() is
  '#1012 (R37): after-update trigger on promotion_candidates -- when a candidate is promoted or rejected, the decider''s own unread promotion_candidate:<member> Notifications become read; the other BC members'' and the Moderator''s copies stay unread. Only when the decider is the signed-in caller. Executable by no client role.';

revoke execute on function private.mark_candidate_notifications_read_on_decision()
  from public, anon, authenticated, service_role;

create trigger promotion_candidates_mark_notifications_read
  after update of decision on public.promotion_candidates
  for each row
  when (old.decision is null and new.decision in ('promoted', 'rejected') and new.decided_by is not null)
  execute function private.mark_candidate_notifications_read_on_decision();

-- 5e. An RSVP: the Member's own Event Notifications. A manager recording
--     someone else's attendance marks nothing.
create function private.mark_event_notifications_read_on_rsvp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.member_id = (select auth.uid()) then
    perform private.mark_own_notifications_read(new.member_id, 'event:' || new.event_id::text);
  end if;
  return null;
end;
$$;

comment on function private.mark_event_notifications_read_on_rsvp() is
  '#1012 (R37): after-insert/update trigger on event_attendance -- an RSVP marks the Member''s own unread event:<id> Notifications read. Only for the signed-in Member''s own row. Executable by no client role.';

revoke execute on function private.mark_event_notifications_read_on_rsvp()
  from public, anon, authenticated, service_role;

create trigger event_attendance_mark_notifications_read
  after insert or update of status on public.event_attendance
  for each row
  execute function private.mark_event_notifications_read_on_rsvp();

-- ---------------------------------------------------------------------------
-- 6. "Cerere respinsă" names its Request (dedupe key request:<id>)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.reject_completed_work_request_impl(p_request_id bigint, p_note text)
 RETURNS completed_work_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor   uuid := (select auth.uid());
  v_note    text;
  v_request public.completed_work_requests%rowtype;
begin
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'note_required';
  end if;
  v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- #673 (R8): measured as stored (trimmed).
  perform private.require_text_length('note', v_note, null, 1000);
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'request_command_forbidden';
  end if;
  select * into v_request from public.completed_work_requests
   where id = p_request_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  if v_request.requester_id is distinct from v_actor
     and not coalesce(private.can_manage_group_work(v_request.group_id), false) then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  perform private.require_request_decider(p_request_id);
  if v_request.status <> 'pending' then
    raise sqlstate 'PT409' using message = 'request_not_pending';
  end if;
  update public.completed_work_requests
     set status        = 'rejected',
         decided_by    = v_actor,
         decided_at    = now(),
         decision_note = v_note
   where id = p_request_id;

  -- #1012 (R37): keyed request:<id>, so the requester's Notification carries
  -- the subject completed_work_request:<id> and opening the Request reads it.
  perform private.notify(array[v_request.requester_id], 'task'::public.noti_kind,
    'Cerere respinsă: ' || left(v_request.description, 60),
    v_note,
    null, 'request:' || p_request_id::text, v_actor, '/cereri');

  select * into v_request from public.completed_work_requests where id = p_request_id;
  return v_request;
end;
$function$;

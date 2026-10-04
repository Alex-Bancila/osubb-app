-- #1006: the Supabase Security and Performance Advisors report nothing actionable.
--
-- `supabase db advisors --type all --level info` on a database built from main
-- reported one ERROR, one WARN and 30 actionable INFO findings. This migration
-- fixes each one and changes no authority: every gate below keeps exactly the
-- rows and the viewers it had.
--
-- 1. security_definer_view (ERROR): public.profiles_contact ran with owner
--    rights because profiles.email and profiles.phone are revoked from
--    authenticated column by column, so a security_invoker view could never
--    read them. Its WHERE clause was the security boundary. The same gate now
--    lives in a security-definer read body, private.member_contacts_impl,
--    behind an invoker wrapper public.member_contacts -- the shape of
--    member_card / member_card_impl, so no security-definer function sits in
--    the exposed schema. The predicate is the view's own, copied verbatim
--    from 20260927180000_live_level_gates.sql (its latest definition):
--    the caller holds organisation claims, has a live `activ` Profile
--    (caller_level() >= 0), and the row is their own or their live level is
--    at least 5. The owner-rights view is then dropped, so the
--    security_invoker sweep in conventions.test.sql has no exception left.
--    A security_invoker view of the same name and columns takes its place
--    for one transition period: the PWA updates only when a Member accepts
--    the update prompt (registerType 'prompt'), so a bundle from before this
--    Release keeps reading profiles_contact for a while, and the Member Card
--    and Profil fail loudly when that read errors. The shim reads through
--    public.member_contacts() as the caller, so it answers exactly the same
--    rows and the advisor has nothing to report. Drop it once no bundle
--    older than this Release is in use.
-- 2. function_search_path_mutable (WARN): public.rating_mult pins
--    search_path. ALTER keeps its signature, body, volatility and grants.
-- 3. unindexed_foreign_keys (23): one covering btree index per foreign key,
--    named <table>_<cols>_idx. Created plainly, not concurrently: migrations
--    run in a transaction and every table here is small.
-- 4. no_primary_key: private.invitation_requests gains an identity primary
--    key. Its only writer (private.request_invitation_allowed_impl) and the
--    tests name their columns, so nothing else changes.
-- 5. rls_enabled_no_policy (5): the five tables written only by
--    security-definer bodies, cron jobs or the service role now say so with
--    one restrictive deny policy each. No client grant exists on any of them;
--    the policy makes the intent explicit and stays in force if a grant is
--    ever added by mistake. The service role bypasses RLS and the definer
--    bodies and cron jobs run as the table owner, so no writer is affected.
--    Policy names follow <table>_manage_<qualifier> (schema_naming.test.sql).
--
-- Not done: the unused_index findings. The local stack has no traffic and
-- production had two days of it when this was written; revisit them on
-- production after a month of use.

-- 1. ----------------------------------------------------------------------

create function private.member_contacts_impl(p_ids uuid[])
returns table (id uuid, email text, phone text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_ids is not null and cardinality(p_ids) > 200 then
    raise sqlstate 'PT400' using
      message = 'too_many_ids',
      detail = 'member_contacts: at most 200 Member ids per call';
  end if;

  return query
  select profiles.id, profiles.email, profiles.phone
    from public.profiles
   where public.auth_is_member()
     and (select private.caller_level()) >= 0
     and (profiles.id = (select auth.uid()) or (select private.caller_level()) >= 5)
     and (p_ids is null or profiles.id = any (p_ids))
   order by profiles.id;
end;
$$;

comment on function private.member_contacts_impl(uuid[]) is
  '#1006: the read body behind public.member_contacts. Returns id, email and phone for the caller''s own Profile, or for every Profile when the caller''s live level is at least 5 (spec section 4.3), and nothing without organisation claims or a live activ Profile. Security definer on purpose: email and phone are revoked from authenticated on profiles, so this predicate is the security boundary, not a filter. It is the former profiles_contact view''s WHERE clause unchanged. p_ids null means every row the caller may read; otherwise at most 200 ids (PT400 too_many_ids).';

create function public.member_contacts(p_ids uuid[] default null)
returns table (id uuid, email text, phone text)
language sql
stable
security invoker
set search_path = ''
as $$
  select contact.id, contact.email, contact.phone
    from private.member_contacts_impl(p_ids) as contact;
$$;

comment on function public.member_contacts(uuid[]) is
  '#1006: Members'' contact details (email, phone) for the caller''s own Profile, or for everyone when the caller''s live level is at least 5. Replaces the owner-rights profiles_contact view. Pass p_ids (at most 200, PT400 too_many_ids) to read only those Members; omit it for every row the caller may read.';

revoke execute on function private.member_contacts_impl(uuid[])
  from public, anon, authenticated, service_role;
revoke execute on function public.member_contacts(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function private.member_contacts_impl(uuid[]) to authenticated;
grant execute on function public.member_contacts(uuid[]) to authenticated;

drop view public.profiles_contact;

create view public.profiles_contact with (security_invoker = on) as
  select contact.id, contact.email, contact.phone
    from public.member_contacts() as contact;

comment on view public.profiles_contact is
  '#1006 transition shim, to be dropped once no app bundle older than #1006 is in use: the former owner-rights contact view, now security_invoker over public.member_contacts(), so it answers exactly that function''s rows to the same callers. New code calls public.member_contacts().';

revoke all on public.profiles_contact from public, anon, authenticated, service_role;
grant select on public.profiles_contact to authenticated;

-- 2. ----------------------------------------------------------------------

alter function public.rating_mult(int) set search_path = '';

-- 3. ----------------------------------------------------------------------

create index announcements_created_by_idx on public.announcements (created_by);
create index campaigns_created_by_idx on public.campaigns (created_by);
create index completed_work_requests_decided_by_idx on public.completed_work_requests (decided_by);
create index events_created_by_idx on public.events (created_by);
create index group_applications_decided_by_idx on public.group_applications (decided_by);
create index groups_created_by_idx on public.groups (created_by);
create index member_imports_imported_by_idx on public.member_imports (imported_by);
create index org_settings_updated_by_idx on public.org_settings (updated_by);
create index points_ledger_awarded_by_idx on public.points_ledger (awarded_by);
create index points_ledger_task_id_idx on public.points_ledger (task_id);
create index promotion_candidates_decided_by_idx on public.promotion_candidates (decided_by);
create index promotion_rules_to_role_idx on public.promotion_rules (to_role);
create index promotion_threshold_changes_changed_by_idx on public.promotion_threshold_changes (changed_by);
create index promotion_threshold_changes_role_evaluation_id_idx on public.promotion_threshold_changes (role_evaluation_id);
create index promotion_thresholds_updated_by_idx on public.promotion_thresholds (updated_by);
create index role_evaluations_run_by_idx on public.role_evaluations (run_by);
create index role_history_changed_by_idx on public.role_history (changed_by);
create index task_activity_assignment_id_idx on public.task_activity (assignment_id);
create index task_candidates_assignment_id_idx on public.task_candidates (assignment_id);
create index task_candidates_decided_by_idx on public.task_candidates (decided_by);
create index task_evaluations_assignment_id_task_id_idx on public.task_evaluations (assignment_id, task_id);
create index task_evaluations_reversed_by_idx on public.task_evaluations (reversed_by);
create index tasks_created_by_idx on public.tasks (created_by);

-- 4. ----------------------------------------------------------------------

alter table private.invitation_requests
  add column id bigint generated always as identity
  constraint invitation_requests_pkey primary key;

-- 5. ----------------------------------------------------------------------

create policy email_digests_manage_no_client on private.email_digests
  as restrictive for all to authenticated, anon using (false) with check (false);
create policy invitation_requests_manage_no_client on private.invitation_requests
  as restrictive for all to authenticated, anon using (false) with check (false);
create policy resend_webhook_deliveries_manage_no_client on private.resend_webhook_deliveries
  as restrictive for all to authenticated, anon using (false) with check (false);
create policy member_imports_manage_no_client on public.member_imports
  as restrictive for all to authenticated, anon using (false) with check (false);
create policy push_deliveries_manage_no_client on public.push_deliveries
  as restrictive for all to authenticated, anon using (false) with check (false);

comment on table private.email_digests is
  '#775: the Email Digest outbox -- one row per Member per Bucharest day at most (digest_day), with the ids of the Notifications it covers. pending -> sending (a 15-minute lease taken by public.claim_email_digests) -> sent / failed, or skipped when, at claim time, the Member has opted out, is no longer active, or has read every Notification in it. Written by private.enqueue_email_digests and the two send-digest commands; not exposed to PostgREST (private) and granted to nobody. #1006: one restrictive deny policy for authenticated and anon (email_digests_manage_no_client).';

comment on table private.invitation_requests is
  '#968: every request to re-send an invitation from the login page, as hashes only -- SHA-256 hex of the trimmed, lower-cased address and the request-invitation function''s 32-character hash of the caller''s IP (null when it had none). The check constraints refuse anything else, so a typed address can never be stored. Written only by private.request_invitation_allowed_impl, which counts these rows for its limits and purges rows older than 24 hours. Not exposed to PostgREST (private) and granted to nobody. #1006: an identity primary key (id) and one restrictive deny policy for authenticated and anon (invitation_requests_manage_no_client).';

comment on table private.resend_webhook_deliveries is
  '#776: every Resend webhook delivery (svix-id) already acted on, per recipient address -- one event can name several. Written only by private.notify_email_delivery_problem_impl, which skips a pair already here and purges rows older than seven days. Not exposed to PostgREST (private) and granted to nobody. #1006: one restrictive deny policy for authenticated and anon (resend_webhook_deliveries_manage_no_client).';

comment on table public.member_imports is
  '#991: one row per Member created by the volunteer-base import -- the address (sheet_email, lower-cased) and sheet row they came from, who imported them, and the problems the import noted for BC (problems: at most 20 short Romanian notes such as "proiect lipsă: Gala"). Written only by public.import_member, read only by public.uninvited_members (both definer); no client grant, and since #1006 one restrictive deny policy for authenticated and anon (member_imports_manage_no_client). sheet_email keeps the imported address after BC corrects the Profile''s, so a re-run of the same file finds the Member instead of creating a second account.';

comment on table public.push_deliveries is
  '#703: the Web Push outbox -- one row per Notification per registered web device. Inserted by the private.enqueue_push_deliveries trigger on notifications; claimed and settled by public.claim_push_deliveries and public.settle_push_delivery (security definer, executable by service_role alone, called by the send-push Edge Function); watched by the osubb-push-health job and pruned after seven days by the osubb-prune-push-deliveries cron job. No client grant; #1006: one restrictive deny policy for authenticated and anon (push_deliveries_manage_no_client).';

-- #1141: deciding or listing a Completed-work Request asks the decider rule once, for the caller, not once per active Member.
--
-- Finding M25 of the codebase audit of 2026-10-30
-- (docs/review/2026-10-30-codebase-audit.md). private.can_decide_request was
-- "auth.uid() in (select private.request_deciders(id))": request_deciders
-- -> private.work_deciders(group, requester) runs the definer
-- private.is_work_decider(group, requester, member) once per activ Profile,
-- and public.pending_request_decisions asked it once per pending Request,
-- approve and reject twice each (private.require_request_decider). With 600
-- active Members and 30 pending Requests the Cereri queue ran 18 000 decider
-- checks per open. The answer needed is one call: is_work_decider(group,
-- requester, caller). supabase/tests/completed_work_request_commands.test.sql,
-- section 15, pins that the answer did not move for any persona; the cost is
-- shown by explain analyze in the pull request, since a pure refactor cannot
-- be made to fail by removal.
--
-- can_decide_request is rebuilt from 20260919185516_commands_write_group_id
-- .sql with the one call; require_request_decider (same file) keeps its body,
-- which asks can_decide_request before and after the Group locks and is now
-- two calls instead of two passes -- only its comment is restated. work_
-- deciders and request_deciders stay as they are, for the fan-out: the set
-- that is notified and the predicate that decides still read one rule,
-- is_work_decider, untouched. Grants persist through create or replace.

create or replace function private.can_decide_request(p_request_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     -- #1141 (audit M25): the rule for the caller alone, not the whole set.
     and exists (
       select 1
         from public.completed_work_requests as request
        where request.id = p_request_id
          and private.is_work_decider(request.group_id, request.requester_id, (select auth.uid())));
$$;

comment on function private.can_decide_request(bigint) is
  'Claims and live membership gated: whether the caller is a decider of this Completed-work Request -- private.is_work_decider for the Request''s Group and Requester, asked once for the caller (#1141, audit M25 of 2026-10-30) instead of a pass over every activ Profile through private.request_deciders. The same answer as membership of that set, so the Members notified of a Request (private.work_deciders, the fan-out) and the one who may decide it still read one rule. Callable predicate, not a write path: pending_request_decisions and require_request_decider read it.';

comment on function private.require_request_decider(bigint) is
  'Caller holds Request FOR UPDATE. Revalidates decider membership -- private.can_decide_request, one is_work_decider call for the caller since #1141 -- before and after Group authority locks; requester never decides their own Request.';

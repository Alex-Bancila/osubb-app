-- #701: Evaluation Periods -- the open and close commands, the close stamping the Promotion Threshold and running the close-time promotions in one transaction.
--
-- Ruling R20 (2026-09-23 grill) and the glossary: an Evaluation Period is "a
-- named span of time opened and closed by BC", and the Promotion Threshold is
-- fixed at its close. #47 built public.evaluation_periods with no client
-- write path; these two commands are that path, in the shape of
-- public.set_member_role -> private.set_member_role_impl (conventions
-- section 2): an invoker wrapper that only calls a security-definer _impl,
-- the actor always (select auth.uid()).
--
--   * public.open_evaluation_period(p_name text) returns bigint -- the new
--     Period's id.
--   * public.close_evaluation_period(p_period_id bigint) returns void.
--
-- Gate. BC and the Moderator only (live level >= 6).
-- private.require_active_member() first -- organization claims and a live
-- activ Profile -- because private.caller_level() alone reads the Profile and
-- not the claims, so a claimless session would pass it. Every refusal,
-- require_active_member's own not_active_member included, is answered as one
-- reason: 42501 period_manage_forbidden.
--
-- Serialisation. Both commands take pg_advisory_xact_lock(47, 1) before they
-- read a Period (the pattern of private.remind_deadlines' (69, 1)): two opens,
-- or an open and a close, run one after the other, so the second open sees the
-- first one's row and answers PT409 period_already_open instead of tripping
-- #47's evaluation_periods_open_uidx. The one-open and no-overlap invariants
-- stay #47's constraints; the lock adds no second invariant. The close then
-- calls #52's private.apply_close_promotions, which takes (52, 1) itself --
-- the daily promotion job's lock -- always after (47, 1), and the daily job
-- never takes (47, 1), so the two orders cannot cross.
--
-- The open. opened_at is the transaction's now(), except when an earlier
-- Period's closed_at is later than it: an open that waited on the lock behind
-- a close that started after it has a now() earlier than that close, which
-- would put the new span inside the closed one (#47's
-- evaluation_periods_span_excl). It opens at the close instant instead --
-- adjacent, not overlapping. No Notification on open: R20 is silent.
--
-- The close, one transaction, never half-done:
--   1. the Period row, the command's target, locked `for update`;
--   2. closed_at = now(), closed_by = the actor -- first, because #47's
--      evaluation_periods_threshold_ck keeps closing_threshold null until
--      closed_at is set, and #52 dates "promoted at or after the close" by
--      that same now(), which its role_history rows share;
--   3. #49's private.stamp_closing_threshold(p_period_id) -- the command never
--      computes the boundary itself. It relocks the row `for no key update`
--      in the same transaction (free), and leaves closing_threshold null when
--      the Period ranked nobody (the threshold in force carries over);
--   4. #52's private.apply_close_promotions(p_period_id) -- the close-time
--      promotions and the Retention Signals. Every Notification of the close
--      is #52's; this command sends none of its own.
-- An error anywhere -- the stamp's promotion_rule_not_found, anything inside
-- #52's run -- rolls the whole close back: the Period stays open with
-- closed_at, closed_by and closing_threshold null. The human actor of the
-- close lives on the Period row (closed_by); #52's role_history rows carry
-- actor_kind 'automatic'.
--
-- Two error vocabularies meet here. The commands answer as #701 names them:
-- PT400 invalid_period_name / name_too_short / name_too_long (#673's
-- <field>_<rule> names through private.require_text_length, so #674's table
-- maps them once), 42501 period_manage_forbidden, PT404 period_not_found,
-- PT409 period_already_open / period_already_closed. The helpers they call
-- keep their own evaluation_period_* reasons (#49's stamp: PT404
-- evaluation_period_not_found, PT409 evaluation_period_open /
-- closing_threshold_stamped, PT404 promotion_rule_not_found; #51/#52:
-- evaluation_period_not_found / evaluation_period_open). Under these commands
-- only promotion_rule_not_found can reach a caller -- the row exists and is
-- closed and unstamped by the time either helper runs.
--
-- Boundary: no ranking, threshold computation, detection or promotion logic
-- (#49, #51, #52), no panel (#702), no reopening, renaming or deleting of a
-- closed Period. Nothing in app/ calls these yet: #702 is the first caller.

-- ---------------------------------------------------------------------------
-- The open.
-- ---------------------------------------------------------------------------
create function private.open_evaluation_period_impl(p_name text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name      text;
  v_actor     uuid;
  v_opened_at timestamptz;
  v_id        bigint;
begin
  -- 1. Malformed for every caller: answered before the gate (conventions
  --    section 2). Trimmed of every [[:space:]], as #47's
  --    evaluation_periods_name_trimmed_ck measures the stored name.
  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_period_name';
  end if;
  v_name := pg_catalog.regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  perform private.require_text_length('name', v_name, 3, 120);

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'period_manage_forbidden';
  end;
  if private.actor_level(v_actor) < 6 then
    raise exception using errcode = '42501', message = 'period_manage_forbidden';
  end if;

  -- 3. Opens and closes serialise here; the open Period is read after it.
  perform pg_catalog.pg_advisory_xact_lock(47, 1);
  if exists (select 1 from public.evaluation_periods as period where period.closed_at is null) then
    raise sqlstate 'PT409' using message = 'period_already_open';
  end if;

  -- 4. At now(), or at the latest close when that is later (see the header).
  select greatest(now(), max(period.closed_at)) into v_opened_at
    from public.evaluation_periods as period;

  insert into public.evaluation_periods (name, opened_at, opened_by)
  values (v_name, v_opened_at, v_actor)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function private.open_evaluation_period_impl(text) is
  '#701: body of public.open_evaluation_period. PT400 invalid_period_name (null or blank), name_too_short / name_too_long (trimmed, 3..120 characters) before the gate; then private.require_active_member() and live level >= 6 (BC, Moderator), every refusal 42501 period_manage_forbidden; then pg_advisory_xact_lock(47, 1), shared with close_evaluation_period, and PT409 period_already_open while a Period is open. Inserts the Period with opened_at now() (or the latest closed_at, when a close that committed while this open waited is later) and opened_by the actor; closed_at, closed_by and closing_threshold stay null. Returns the new id. Sends no Notification.';

create function public.open_evaluation_period(p_name text)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.open_evaluation_period_impl(p_name);
$$;

comment on function public.open_evaluation_period(text) is
  '#701 (ruling R20): opens a named Evaluation Period and returns its id. BC and the Moderator only (42501 period_manage_forbidden for anyone else, a claimless or deactivated session included). The name is trimmed and must be 3..120 characters (PT400 invalid_period_name when blank, name_too_short, name_too_long -- answered before the gate). PT409 period_already_open while a Period is open: at most one is open at a time. The Period is the audit record: opened_at and opened_by. Silent -- no Notification.';

-- ---------------------------------------------------------------------------
-- The close.
-- ---------------------------------------------------------------------------
create function private.close_evaluation_period_impl(p_period_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid;
  v_period public.evaluation_periods%rowtype;
begin
  -- 1. The gate, as the open's.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'period_manage_forbidden';
  end;
  if private.actor_level(v_actor) < 6 then
    raise exception using errcode = '42501', message = 'period_manage_forbidden';
  end if;

  -- 2. Serialised with every open and close, then the target under lock.
  perform pg_catalog.pg_advisory_xact_lock(47, 1);
  select * into v_period
    from public.evaluation_periods as period
   where period.id = p_period_id
   for update;
  if not found then
    raise sqlstate 'PT404' using message = 'period_not_found';
  end if;
  if v_period.closed_at is not null then
    raise sqlstate 'PT409' using message = 'period_already_closed';
  end if;

  -- 3. The instant and the actor first: closing_threshold may not be set
  --    before closed_at (evaluation_periods_threshold_ck).
  update public.evaluation_periods
     set closed_at = now(),
         closed_by = v_actor
   where id = p_period_id;

  -- 4. #49 fixes the Promotion Threshold; null when nobody ranked.
  perform private.stamp_closing_threshold(p_period_id);

  -- 5. #52: the close-time promotions and the Retention Signals, in this
  --    transaction. An error inside rolls the whole close back.
  perform private.apply_close_promotions(p_period_id);
end;
$$;

comment on function private.close_evaluation_period_impl(bigint) is
  '#701: body of public.close_evaluation_period. private.require_active_member() and live level >= 6 (BC, Moderator), every refusal 42501 period_manage_forbidden; pg_advisory_xact_lock(47, 1), shared with open_evaluation_period; the Period locked for update -- PT404 period_not_found, PT409 period_already_closed. Then, in one transaction: closed_at = now() and closed_by = the actor; #49''s private.stamp_closing_threshold (the Promotion Threshold -- left null when the Period ranked nobody); #52''s private.apply_close_promotions (the close-time promotions and the Retention Signal Notifications, taking pg_advisory_xact_lock(52, 1) after (47, 1)). Any error rolls the whole close back.';

create function public.close_evaluation_period(p_period_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.close_evaluation_period_impl(p_period_id);
$$;

comment on function public.close_evaluation_period(bigint) is
  '#701 (ruling R20): closes the open Evaluation Period. BC and the Moderator only (42501 period_manage_forbidden for anyone else, a claimless or deactivated session included). PT404 period_not_found, PT409 period_already_closed. Stamps closed_at and closed_by, fixes the Promotion Threshold (#49: closing_threshold, left null when the Period ranked nobody) and runs the close-time promotions and Retention Signals (#52) in the same transaction -- an error in any step leaves the Period open, never half-closed. Every Notification of the close is #52''s.';

-- ---------------------------------------------------------------------------
-- Grants (conventions sections 2 and 4): the wrappers and their _impls to
-- authenticated -- the invoker wrapper calls the _impl as the caller, and
-- private is not exposed to PostgREST.
-- ---------------------------------------------------------------------------
revoke execute on function private.open_evaluation_period_impl(text)
  from public, anon, authenticated, service_role;
revoke execute on function private.close_evaluation_period_impl(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.open_evaluation_period(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.close_evaluation_period(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.open_evaluation_period_impl(text) to authenticated;
grant execute on function private.close_evaluation_period_impl(bigint) to authenticated;
grant execute on function public.open_evaluation_period(text) to authenticated;
grant execute on function public.close_evaluation_period(bigint) to authenticated;

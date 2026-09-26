-- #702: set_promotion_rule -- BC seeds the initial Promotion Threshold before the first Evaluation Period closes.
--
-- #49 shipped public.promotion_rules with no client write path and named
-- #702's set_promotion_rule(p_rule_id, p_initial_threshold) as the one editor
-- it would get. Ruling R20 and the glossary: BC seeds the Promotion Threshold
-- "before the first Period closes"; from the first close on,
-- public.promotion_threshold_in_force() reads the last close's
-- closing_threshold and the initial value is inert. So the command writes
-- initial_threshold alone, on the top_percent rule alone, and only while no
-- Period has closed. The percentage, the tenure, the enabled flag and the
-- time rule stay the migration-seeded placeholders BC ratifies -- editing them
-- is in no ruling and out of scope.
--
-- Shape: #701's -- an invoker wrapper that only calls a security-definer
-- _impl, the actor always (select auth.uid()) (conventions section 2).
--
--   1. PT400 invalid_initial_threshold for a null value or one below 1 --
--      promotion_rules_initial_threshold_range_ck forbids it, so it is
--      malformed for every caller and answered before the gate. (The issue
--      says "null or negative"; 0 breaks the same constraint, so it is
--      answered the same way rather than as a raw 23514.)
--   2. The gate: private.require_active_member() -- organization claims and a
--      live activ Profile, because caller_level() alone would let a claimless
--      session through -- then live level >= 6 (BC, Moderator). Every refusal
--      is 42501 promotion_rule_manage_forbidden.
--   3. pg_advisory_xact_lock(47, 1), the lock #701's open and close take
--      before they read a Period. The close takes it first and only then
--      #49's stamp takes the top_percent rule `for share`; taking the same
--      advisory lock here, before the rule row, keeps one lock order (47, 1)
--      -> rule, so the two cannot deadlock, and the "no closed Period" check
--      below cannot pass while a first close is committing underneath it.
--   4. The rule row, the target, `for update`: PT404 promotion_rule_not_found;
--      PT409 promotion_rule_not_top_percent for any other kind (the time rule
--      has no threshold -- promotion_rules_time_shape_ck).
--   5. PT409 promotion_threshold_already_stamped once any Period has closed.
--   6. PT409 nothing_to_update for the value already stored.
--   7. Writes initial_threshold; promotion_rules_set_updated_at moves
--      updated_at.
--
-- Boundary: no other column, no other kind, no threshold computation (#49),
-- no Period command (#701). The Perioade de evaluare panel (#702) is the
-- caller.

create function private.set_promotion_rule_impl(p_rule_id bigint, p_initial_threshold integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_rule  public.promotion_rules%rowtype;
begin
  -- 1. Malformed for every caller (promotion_rules_initial_threshold_range_ck).
  if p_initial_threshold is null or p_initial_threshold < 1 then
    raise sqlstate 'PT400' using message = 'invalid_initial_threshold';
  end if;

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'promotion_rule_manage_forbidden';
  end;
  if private.actor_level(v_actor) < 6 then
    raise exception using errcode = '42501', message = 'promotion_rule_manage_forbidden';
  end if;

  -- 3. Serialised with #701's open and close, in their lock order.
  perform pg_catalog.pg_advisory_xact_lock(47, 1);

  -- 4. The target under lock.
  select * into v_rule
    from public.promotion_rules as rule
   where rule.id = p_rule_id
   for update;
  if not found then
    raise sqlstate 'PT404' using message = 'promotion_rule_not_found';
  end if;
  if v_rule.kind <> 'top_percent' then
    raise sqlstate 'PT409' using message = 'promotion_rule_not_top_percent';
  end if;

  -- 5. Before the first close only: afterwards the initial value is inert.
  if exists (select 1 from public.evaluation_periods as period where period.closed_at is not null) then
    raise sqlstate 'PT409' using message = 'promotion_threshold_already_stamped';
  end if;

  -- 6. State.
  if v_rule.initial_threshold is not distinct from p_initial_threshold then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 7. Write.
  update public.promotion_rules
     set initial_threshold = p_initial_threshold
   where id = p_rule_id;
end;
$$;

comment on function private.set_promotion_rule_impl(bigint, integer) is
  '#702: body of public.set_promotion_rule. PT400 invalid_initial_threshold (null or below 1) before the gate; private.require_active_member() and live level >= 6 (BC, Moderator), every refusal 42501 promotion_rule_manage_forbidden; pg_advisory_xact_lock(47, 1), shared with #701''s open and close; the rule locked for update -- PT404 promotion_rule_not_found, PT409 promotion_rule_not_top_percent; PT409 promotion_threshold_already_stamped once any Evaluation Period has closed; PT409 nothing_to_update for an unchanged value. Writes initial_threshold only.';

create function public.set_promotion_rule(p_rule_id bigint, p_initial_threshold integer)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_promotion_rule_impl(p_rule_id, p_initial_threshold);
$$;

comment on function public.set_promotion_rule(bigint, integer) is
  '#702 (ruling R20): BC or the Moderator seeds the initial Promotion Threshold -- initial_threshold of the top_percent Promotion Rule, a whole number of Task Points >= 1 -- before the first Evaluation Period closes; public.promotion_threshold_in_force() reads it until then. 42501 promotion_rule_manage_forbidden for anyone else (a claimless or deactivated session included). PT400 invalid_initial_threshold, PT404 promotion_rule_not_found, PT409 promotion_rule_not_top_percent, promotion_threshold_already_stamped (a Period has closed: the threshold in force now comes from the last close), nothing_to_update. No other column of the rule is writable.';

-- Grants (conventions sections 2 and 4): the wrapper and its _impl to
-- authenticated -- the invoker wrapper calls the _impl as the caller, and
-- private is not exposed to PostgREST.
revoke execute on function private.set_promotion_rule_impl(bigint, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.set_promotion_rule(bigint, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.set_promotion_rule_impl(bigint, integer) to authenticated;
grant execute on function public.set_promotion_rule(bigint, integer) to authenticated;

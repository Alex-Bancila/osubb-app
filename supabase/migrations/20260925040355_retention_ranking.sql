-- #48: the retention ranking -- which Voluntar Activ and Voluntar cu Drept de Vot holders a closed Evaluation Period leaves outside their Role's share.
--
-- ADR-0004 (amended 2026-09-21) and ADR-0009 §Promotion hooks: when a Period
-- closes, a Voluntar Activ below the top x% and a Voluntar cu Drept de Vot
-- below the top y% each produce a Retention Signal to BC, who may withdraw the
-- Role by hand. This migration builds the ranking those signals are read from
-- and the configuration of y. Nobody is demoted automatically.
--
-- Boundary. The ranking and its configuration only. Nothing here writes a
-- Role, profiles.role or a role_history row: #51's detect_retention_signals()
-- reads private.retention_ranking_rows, #52 notifies, BC withdraws a Role
-- through the role panel (#105) and #50 audits it; #702's Perioade de evaluare
-- panel renders public.retention_ranking.
--
-- The two percentages.
--   * Voluntar Activ (`activ`) reads the top_percent Promotion Rule's percent
--     (#49): the x% that promotes is the x% that retains, never configured
--     twice.
--   * Voluntar cu Drept de Vot (`vot`) reads y, the organization setting
--     vote_retention_percent (#681's org_settings; ruling R20 seeds the
--     placeholder BC ratifies: 25). BC or the Moderator changes it through
--     the existing public.set_org_setting -- no migration, no new command. It
--     is a whole percentage 1-100 and cannot be cleared: the ranking needs a
--     number. A table CHECK holds the shape for every writer; the command
--     answers PT400 invalid_org_setting_value in step 1.
--
-- The cohorts. A cohort is every live active Member (status activ) holding
-- the Role now -- `activ` or `vot` exactly; BCE, BC and the Moderator hold the
-- attributes of the Roles below them but are not subject to retention, and a
-- deactivated Member is not a Member BC withdraws a Role from. The Role read
-- is the one held when the ranking is read; #51 reads it inside #701's close
-- transaction, which is the Role at the close. A holder's Task Points are
-- their net total in the Period from #47's private.evaluation_period_ranking_rows;
-- a holder no in-Period Evaluation touched has none there and ranks with 0 --
-- earning nothing in the Period is exactly what the signal is for. Members
-- holding neither Role never appear.
--
-- The share and the boundary -- #49's rule, applied per cohort, so the stamp
-- and this ranking read "the top p%" the same way:
--   share = ceil(percent / 100 x cohort size)  -- 25 % of 5 is 2, not 1
--   rank  = rank() over the cohort by Task Points descending (ties share it)
--   inside = rank <= share
-- rank() gives Members tied with the share-th Member that Member's rank or a
-- better one, so every one of them is inside -- the same "task_points >= the
-- share-th Member's Task Points" #49's stamp reads, ties at the boundary
-- included; the share can hold more than ceil(...) Members, never fewer. A
-- consequence of the tie rule, not a special case: when the share-th holder
-- earned nothing, every holder tied with them at zero is inside too.
--
-- The Period must be closed: an open Period's ranking is still moving and no
-- signal is read from it (PT409 evaluation_period_open); an unknown id is
-- PT404 evaluation_period_not_found -- #49's reasons. A missing top_percent
-- rule is PT404 promotion_rule_not_found, a missing y row PT404
-- org_setting_not_found, so neither ever ranks against a null share.
--
-- Three functions, as #47's ranking has:
--   * private.retention_ranking_rows(p_period_id) -- every row, no visibility
--     rule, granted to nobody; #51's detection reads it from a
--     security-definer body.
--   * private.retention_ranking_impl(p_period_id) -- the same rows filtered for
--     the caller: nothing without organization claims or a live activ Profile
--     (house rule 12); the caller's own row -- their standing in their Role's
--     cohort -- for any live active Member (issue #48's acceptance: nothing
--     beyond their own row; #512 named this own-row branch for #48); every
--     row when #512's private.can_read_evaluation_rankings() holds -- BC,
--     Moderator, and the Group Managers and Group Responsibles of the Adunarea
--     Generală or of an ancestor of it.
--   * public.retention_ranking(p_period_id) -- the invoker wrapper PostgREST
--     publishes.
-- All three are `stable`, so none may lock: #701's close transaction holds
-- the Period, and any other reader sees one consistent snapshot.

-- ---------------------------------------------------------------------------
-- y: the Vote Retention Threshold, as an organization setting.
-- ---------------------------------------------------------------------------
alter table public.org_settings
  add constraint org_settings_vote_retention_percent_ck
  check (key <> 'vote_retention_percent' or (value is not null and value ~ '^([1-9][0-9]?|100)$'));

insert into public.org_settings (key, value) values ('vote_retention_percent', '25');

comment on table public.org_settings is
  '#681 (ruling R20): organization-wide settings BC sets from the app instead of a migration. Every live active Member reads every row; the only write path is public.set_org_setting (BC/Moderator). Keys are reference data seeded by migrations. adherence_form_url: the adherence form link #52''s promotion notification carries (null until BC sets it). adunarea_generala_group_id (#512): the id of the Group that is the Adunarea Generală -- its Group Managers and Group Responsibles, and those of its ancestors, read the full Evaluation Period ranking (private.can_read_evaluation_rankings); null until BC sets it. vote_retention_percent (#48): y, the Vote Retention Threshold -- the top share, a whole percentage 1-100, of the Voluntar cu Drept de Vot cohort a holder must reach in a closed Evaluation Period to stay inside it (public.retention_ranking); seeded 25 (R20''s placeholder BC ratifies), never null.';

-- ---------------------------------------------------------------------------
-- set_org_setting learns the new key. Rebuilt from #512's body
-- (20260925033941_evaluation_rankings_read.sql, the latest definition); what
-- is new is the vote_retention_percent shape in step 1.
-- ---------------------------------------------------------------------------
create or replace function private.set_org_setting_impl(p_key text, p_value text)
returns public.org_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_value       text;
  v_setting     public.org_settings%rowtype;
begin
  -- 1. Malformed for every caller, so answered ahead of any authority verdict.
  v_value := nullif(regexp_replace(coalesce(p_value, ''),
                                   '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_text_length('value', v_value, null, 2048);
  if p_key = 'adherence_form_url'
     and v_value is not null
     and not private.is_http_url(v_value) then
    raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
  end if;
  -- #512: a Group id is a positive integer that fits a bigint.
  if p_key = 'adunarea_generala_group_id'
     and v_value is not null
     and v_value !~ '^[1-9][0-9]{0,17}$' then
    raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
  end if;
  -- #48: y is a whole percentage 1-100 and is never cleared.
  if p_key = 'vote_retention_percent'
     and (v_value is null or v_value !~ '^([1-9][0-9]?|100)$') then
    raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
  end if;

  -- 2. Authority: BC or Moderator, live, held for the transaction.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'org_settings_manage_forbidden';
  end;

  select role.level into v_actor_level
    from public.profiles as actor
    join public.roles as role on role.id = actor.role
   where actor.id = v_actor
     and actor.status = 'activ'
   for share of actor;
  if coalesce(v_actor_level, -1) < 6 then
    raise exception using errcode = '42501', message = 'org_settings_manage_forbidden';
  end if;

  -- 3. Target under lock.
  select * into v_setting
    from public.org_settings
   where key = p_key
   for update;
  if not found then
    raise sqlstate 'PT404' using message = 'org_setting_not_found';
  end if;
  -- #512: the Adunarea Generală is an existing, active Group. `for key share`
  -- keeps the row from being deleted under the write without blocking the
  -- `for no key update` every Group command takes on a Group row.
  if p_key = 'adunarea_generala_group_id' and v_value is not null then
    perform 1
      from public.groups as grp
     where grp.id = v_value::bigint
       and grp.status = 'active'
       for key share;
    if not found then
      raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
    end if;
  end if;

  -- 4. State.
  if v_value is not distinct from v_setting.value then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 5. Write.
  update public.org_settings
     set value = v_value,
         updated_by = v_actor
   where key = p_key
  returning * into v_setting;

  return v_setting;
end;
$$;

comment on function private.set_org_setting_impl(text, text) is
  '#681, extended by #512 and #48: body of public.set_org_setting. Step 1 trims the value (blank -> null), PT400 value_too_long above 2048 characters, PT400 invalid_org_setting_value for an adherence_form_url that is not http(s), an adunarea_generala_group_id that is not a positive integer, or a vote_retention_percent that is not a whole number 1-100 (blank included: y is never cleared); then 42501 org_settings_manage_forbidden unless the caller is a live active BC or Moderator (level >= 6, Profile held for share); PT404 org_setting_not_found for an unseeded key; PT400 invalid_org_setting_value for an adunarea_generala_group_id naming no active Group (checked after the gate, so nobody below BC probes Group ids); PT409 nothing_to_update for an unchanged value.';

comment on function public.set_org_setting(text, text) is
  '#681 (ruling R20), extended by #512 and #48: BC or the Moderator sets one organization setting. The value is trimmed and a blank value clears it (null). adherence_form_url must be an http(s) address of at most 2048 characters; #52''s promotion notification reads it. adunarea_generala_group_id must be the id of an active Group -- the Adunarea Generală, whose Group Managers and Group Responsibles (and those of its ancestors) then read the full Evaluation Period ranking. vote_retention_percent must be a whole percentage 1-100 and cannot be cleared -- y, the share of the Voluntar cu Drept de Vot cohort public.retention_ranking marks inside. Records updated_by; the trigger moves updated_at. The Administrare "Perioade de evaluare" panel (#702) calls it. Keys are seeded by migrations: an unknown key is PT404 org_setting_not_found.';

-- ---------------------------------------------------------------------------
-- The retention ranking core: every row, no visibility rule.
-- ---------------------------------------------------------------------------
create function private.retention_ranking_rows(p_period_id bigint)
returns table (
  member_id   uuid,
  role        public.member_role,
  task_points integer,
  rank        integer,
  cohort_size integer,
  share_size  integer,
  inside      boolean
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_closed_at     timestamptz;
  v_activ_percent integer;
  v_vot_percent   integer;
begin
  select period.closed_at into v_closed_at
    from public.evaluation_periods as period
   where period.id = p_period_id;
  if not found then
    raise sqlstate 'PT404' using message = 'evaluation_period_not_found';
  end if;
  if v_closed_at is null then
    raise sqlstate 'PT409' using message = 'evaluation_period_open';
  end if;

  -- x: the Voluntar Activ share is the Promotion Rule's own percent (#49).
  select rule.percent into v_activ_percent
    from public.promotion_rules as rule
   where rule.kind = 'top_percent';
  if not found then
    raise sqlstate 'PT404' using message = 'promotion_rule_not_found';
  end if;

  -- y: the Vote Retention Threshold. org_settings_vote_retention_percent_ck
  -- keeps the value a whole 1-100, so the cast cannot fail.
  select setting.value::integer into v_vot_percent
    from public.org_settings as setting
   where setting.key = 'vote_retention_percent';
  if v_vot_percent is null then
    raise sqlstate 'PT404' using message = 'org_setting_not_found';
  end if;

  return query
  with holders as (
    select profile.id as member_id,
           profile.role as role,
           coalesce(ranked.task_points, 0) as task_points
      from public.profiles as profile
      left join private.evaluation_period_ranking_rows(p_period_id) as ranked
        on ranked.member_id = profile.id
     where profile.role in ('activ', 'vot')
       and profile.status = 'activ'
  ),
  cohorts as (
    select holder.member_id,
           holder.role,
           holder.task_points,
           (rank() over (partition by holder.role order by holder.task_points desc))::int as cohort_rank,
           (count(*) over (partition by holder.role))::int as cohort_count
      from holders as holder
  ),
  shares as (
    select cohort.member_id,
           cohort.role,
           cohort.task_points,
           cohort.cohort_rank,
           cohort.cohort_count,
           ceil(case cohort.role when 'activ' then v_activ_percent else v_vot_percent end
                * cohort.cohort_count / 100.0)::int as cohort_share
      from cohorts as cohort
  )
  select share.member_id,
         share.role,
         share.task_points,
         share.cohort_rank,
         share.cohort_count,
         share.cohort_share,
         share.cohort_rank <= share.cohort_share
    from shares as share
   order by share.role, share.cohort_rank, share.member_id;
end;
$$;

comment on function private.retention_ranking_rows(bigint) is
  '#48 (ADR-0004 amended 2026-09-21): the retention ranking of one closed Evaluation Period, every row. One row per live active Member holding Voluntar Activ (activ) or Voluntar cu Drept de Vot (vot) now -- nobody else -- with their net Task Points in the Period (#47''s private.evaluation_period_ranking_rows; 0 when no in-Period Evaluation touched them), their rank within their Role''s cohort by Task Points descending (ties share it), the cohort size, the share size ceil(percent / 100 x cohort size) and inside = rank <= share, so Members tied at the boundary are inside together -- #49''s stamp rule, per cohort. percent is the top_percent Promotion Rule''s percent (x) for activ and org_settings.vote_retention_percent (y) for vot. Ordered by role, rank, member_id. PT404 evaluation_period_not_found, PT409 evaluation_period_open, PT404 promotion_rule_not_found (no top_percent row), PT404 org_setting_not_found (no vote_retention_percent row). Writes nothing and changes no Role. No visibility rule and granted to nobody: #51''s detect_retention_signals() reads it from a security-definer body.';

revoke execute on function private.retention_ranking_rows(bigint)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The retention ranking the caller may read.
-- ---------------------------------------------------------------------------
create function private.retention_ranking_impl(p_period_id bigint)
returns table (
  member_id   uuid,
  role        public.member_role,
  task_points integer,
  rank        integer,
  cohort_size integer,
  share_size  integer,
  inside      boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller    uuid;
  v_full_read boolean;
begin
  -- Nothing without organization claims or a live activ Profile (house rule
  -- 12): answered before the Period is even looked up, so such a session
  -- learns nothing, not even which Period ids exist.
  if not (coalesce(public.auth_is_member(), false) and private.caller_level() >= 0) then
    return;
  end if;
  v_caller := auth.uid();
  v_full_read := private.can_read_evaluation_rankings();

  return query
  select ranked.member_id,
         ranked.role,
         ranked.task_points,
         ranked.rank,
         ranked.cohort_size,
         ranked.share_size,
         ranked.inside
    from private.retention_ranking_rows(p_period_id) as ranked
   where v_full_read
      or ranked.member_id = v_caller
   order by ranked.role, ranked.rank, ranked.member_id;
end;
$$;

comment on function private.retention_ranking_impl(bigint) is
  '#48: body of public.retention_ranking. private.retention_ranking_rows filtered for the caller: nothing -- and no error -- without organization claims or a live activ Profile (house rule 12, ADR-0003''s stale-token window); the caller''s own row, their standing in their Role''s cohort, for any live active Member who holds Voluntar Activ or Drept de Vot; every row when #512''s private.can_read_evaluation_rankings() holds -- BC and Moderator (live level >= 6), and the Group Managers and Group Responsibles of the Adunarea Generală or of an ancestor of it. PT404 evaluation_period_not_found / PT409 evaluation_period_open for a live Member.';

create function public.retention_ranking(p_period_id bigint)
returns table (
  member_id   uuid,
  role        public.member_role,
  task_points integer,
  rank        integer,
  cohort_size integer,
  share_size  integer,
  inside      boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
    from private.retention_ranking_impl(p_period_id)
   order by role, rank, member_id;
$$;

comment on function public.retention_ranking(bigint) is
  '#48 (ADR-0004 amended 2026-09-21, ADR-0009 §Promotion hooks): the retention ranking of one closed Evaluation Period -- for every live active Voluntar Activ and Voluntar cu Drept de Vot holder: role, task_points (net, in the Period; 0 if none), rank within that Role''s cohort (shared on ties), cohort_size, share_size = ceil(percent / 100 x cohort_size), and inside (rank <= share_size, so ties at the boundary are inside). The percent is the top_percent Promotion Rule''s x for Voluntar Activ and the organization setting vote_retention_percent (y, BC-set through set_org_setting, seeded 25) for Drept de Vot. A holder outside is a Retention Signal to BC (#51); nothing here changes a Role. BC, Moderator and the Adunarea Generală''s Group Managers and Group Responsibles (and those of its ancestors) read every row; any other live Member reads their own row; a claimless or deactivated session reads nothing. PT404 evaluation_period_not_found, PT409 evaluation_period_open. #702''s Perioade de evaluare panel renders it.';

revoke execute on function private.retention_ranking_impl(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.retention_ranking(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.retention_ranking_impl(bigint) to authenticated;
grant execute on function public.retention_ranking(bigint) to authenticated;

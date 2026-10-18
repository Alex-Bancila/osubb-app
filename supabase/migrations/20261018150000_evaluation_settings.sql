-- R58 (Alex, 2026-10-18; spec docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md,
-- section B): the evaluation settings -- the Prag minim (Eligibility Floor),
-- the Data limită de intrare (Membership Cutoff Date) and the Data de început a
-- punctajului (Points Start Date) -- as one row BC and the Moderator will set
-- from the app instead of by migration, and the change log that holds the two
-- date-valued ones.
--
-- Sections:
--   1. public.evaluation_settings: the singleton row, unset on day one.
--   2. public.promotion_threshold_changes learns the three new fields, a pair
--      of date columns and the `migration` source, and its share rule admits
--      the writes of a migration and of a run.
--   3. The three commands that set the values (set_eligibility_floor,
--      set_membership_cutoff, set_points_start_date, each a wrapper over a
--      private _impl) and private.points_floor(), the instant the Points
--      Start Date begins.
--   4. The Points Start Date in every total: my_points, Clasament, the
--      Department Cup and the Campaign totals and reports count only the Task
--      Points of Evaluations on or after it (Clasament alone may look back).
--   5. The award instant, enforced: a `task` ledger row is refused unless it is
--      dated by its Evaluation's evaluated_at (the rule my_points relies on).
--
-- The row is reference data seeded here (house rule 6), never by seed.sql.
-- Nothing reads the Eligibility Floor or the Membership Cutoff Date yet; the
-- readers that apply them follow.

-- ---------------------------------------------------------------------------
-- 1. The settings row.
-- ---------------------------------------------------------------------------
create table public.evaluation_settings (
  id                smallint primary key,
  eligibility_floor integer,
  membership_cutoff date,
  points_start_date date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id),
  constraint evaluation_settings_singleton_ck check (id = 1),
  -- At least 1, so the line a run computes -- the Task Points of the last
  -- Member inside the share, itself at or above the Floor -- is always a legal
  -- promotion_thresholds.threshold (promotion_thresholds_threshold_range_ck).
  constraint evaluation_settings_floor_ck
    check (eligibility_floor is null or eligibility_floor >= 1),
  constraint evaluation_settings_updated_at_ck check (updated_at >= created_at)
);

alter table public.evaluation_settings enable row level security;

create trigger evaluation_settings_set_updated_at
before update on public.evaluation_settings
for each row execute function private.set_updated_at();

-- ADR-0011: a domain table broadcasts its changes (the Portofoliu Interne page
-- and the Member-facing totals refetch on the signal).
create trigger broadcast_change after insert or update or delete on public.evaluation_settings
  for each statement execute function private.broadcast_change();

-- Every foreign key is indexed (advisor_findings.test.sql).
create index evaluation_settings_updated_by_idx on public.evaluation_settings (updated_by);

-- The one row, with no value in it: BC sets the three values from the app.
insert into public.evaluation_settings (id) values (1);

comment on table public.evaluation_settings is
  'R58 (section B): the one row of evaluation settings BC or the Moderator sets from the app -- eligibility_floor (Eligibility Floor, Prag minim), membership_cutoff (Membership Cutoff Date, Data limită de intrare) and points_start_date (Points Start Date, Data de început a punctajului). All three are null on day one. Every live active Member reads the row (a Member may know the rules of their own promotion and from when their points count); no client writes it directly: set_eligibility_floor, set_membership_cutoff and set_points_start_date are the write path, one command per value, and each change is logged in promotion_threshold_changes (fields floor, cutoff, points_start).';
comment on column public.evaluation_settings.id is
  'R58: always 1 (evaluation_settings_singleton_ck) -- the table holds exactly one row.';
comment on column public.evaluation_settings.eligibility_floor is
  'R58: Eligibility Floor (Prag minim), shared by both Role Evaluation kinds -- the Task Points a Member must reach in the Evaluation Period to be ranked at all; a whole number >= 1, so a line a run computes is always a legal Promotion Threshold. Null until BC or the Moderator sets it; a Role Evaluation run or Simulation cannot start without a value.';
comment on column public.evaluation_settings.membership_cutoff is
  'R58: Membership Cutoff Date (Data limită de intrare), Voluntar Activ kind only -- a Voluntar who joined on or before this day (profiles.joined_at) can be listed as a Promotion Candidate. Null until BC or the Moderator sets it; nobody is listed as a live Promotion Candidate meanwhile and a Voluntar Activ run cannot start.';
comment on column public.evaluation_settings.points_start_date is
  'R58: Points Start Date (Data de început a punctajului) -- the first Europe/Bucharest day whose Task Points count in any total (the Personal Score, Clasament, the Department Cup, Campaign totals); earlier points stay in the ledger and count for nothing. Applied inside the SQL readers (private.points_floor), never by the client. Null until BC or the Moderator sets it: every total counts from the beginning.';
comment on column public.evaluation_settings.created_at is
  'R58: when the migration seeded the row.';
comment on column public.evaluation_settings.updated_at is
  'R58: when any of the three values last changed, stamped by evaluation_settings_set_updated_at.';
comment on column public.evaluation_settings.updated_by is
  'R58: the Member whose command last changed a value; null while the row is still as its migration seeded it.';

revoke all on table public.evaluation_settings from public, anon, authenticated, service_role;
grant select on table public.evaluation_settings to authenticated, service_role;

create policy evaluation_settings_read on public.evaluation_settings
  for select to authenticated
  using ((select public.auth_is_member()) and (select private.caller_level()) >= 0);

comment on policy evaluation_settings_read on public.evaluation_settings is
  'R58: every live active Member reads the row -- organization claims (house rule 12) plus a live activ Profile, as promotion_thresholds_read. No write policy: the three set_* commands are the write path.';

-- ---------------------------------------------------------------------------
-- 2. The change log holds dates.
-- ---------------------------------------------------------------------------
-- Three new fields: floor (a number, like a threshold), cutoff and
-- points_start (dates). A date change has no number, so to_value stops being
-- required and from_date / to_date carry the dates; date_shape_ck keeps the
-- two kinds of row apart in both directions. The `migration` source names a
-- change made by a migration (no Member, no run); `role_evaluation` keeps its
-- meaning, a run's write; no `run` value is added. The new sources and fields
-- also reach the shares: percent_shape_ck no longer demands source `manual`,
-- because the day-one change of x and y is a migration's and a finalised run
-- writes the share it used through. A run never writes the Points Start Date
-- (points_start_source_ck).
alter table public.promotion_threshold_changes
  add column from_date date,
  add column to_date date;

alter table public.promotion_threshold_changes
  alter column to_value drop not null;

alter table public.promotion_threshold_changes
  drop constraint promotion_threshold_changes_field_ck,
  drop constraint promotion_threshold_changes_percent_shape_ck,
  drop constraint promotion_threshold_changes_source_ck,
  drop constraint promotion_threshold_changes_source_shape_ck,
  drop constraint promotion_threshold_changes_subject_ck,
  drop constraint promotion_threshold_changes_to_value_range_ck;

alter table public.promotion_threshold_changes
  add constraint promotion_threshold_changes_field_ck
    check (field in ('threshold', 'percent', 'tenure', 'enabled', 'floor', 'cutoff', 'points_start')),
  add constraint promotion_threshold_changes_source_ck
    check (source in ('manual', 'role_evaluation', 'migration')),
  -- A hand edit names its author; a hand-over names its run; a migration's own
  -- change names neither.
  add constraint promotion_threshold_changes_source_shape_ck
    check ((source = 'manual' and changed_by is not null and role_evaluation_id is null)
        or (source = 'role_evaluation' and changed_by is null and role_evaluation_id is not null)
        or (source = 'migration' and changed_by is null and role_evaluation_id is null)),
  -- A threshold or share change names its kind; a rule change names its rule;
  -- a settings change belongs to neither.
  add constraint promotion_threshold_changes_subject_ck
    check ((field in ('threshold', 'percent')
            and kind is not null and promotion_rule_id is null)
        or (field in ('tenure', 'enabled')
            and kind is null and promotion_rule_id is not null)
        or (field in ('floor', 'cutoff', 'points_start')
            and kind is null and promotion_rule_id is null)),
  -- A share is a whole 1-100 both ways. Since R58 it is no longer BC's alone:
  -- a finalised run writes the share it used through to the settings
  -- (role_evaluation) and the day-one change of x and y is a migration's; the
  -- source rule that was here ("manual") is the one #866 wrote before either
  -- existed.
  add constraint promotion_threshold_changes_percent_shape_ck
    check (field <> 'percent'
           or (source in ('manual', 'migration', 'role_evaluation')
               and to_value between 1 and 100
               and (from_value is null or from_value between 1 and 100))),
  -- A run writes the Eligibility Floor, the share and the Membership Cutoff Date
  -- it used (spec section C); it never writes the Points Start Date, which only
  -- BC's command and a migration set.
  add constraint promotion_threshold_changes_points_start_source_ck
    check (field <> 'points_start' or source in ('manual', 'migration')),
  -- A threshold and a Prag minim are at least 1 Task Point (a share has its own
  -- 1-100 check, promotion_threshold_changes_percent_shape_ck; a tenure may be
  -- 0 and enabled is 0 or 1). A date row passes the first disjunct, its field
  -- being neither; a threshold or floor row with a null to_value passes the
  -- comparison too (null is not false), and date_shape_ck is what refuses it.
  add constraint promotion_threshold_changes_to_value_range_ck
    check (field not in ('threshold', 'floor') or to_value >= 1),
  -- A cutoff or points_start row carries dates and no number; every other row
  -- carries numbers and no date. A date row always names the day it moved to
  -- (from_date is null for the first value ever set).
  add constraint promotion_threshold_changes_date_shape_ck
    check ((field in ('cutoff', 'points_start')
            and to_date is not null and to_value is null and from_value is null)
        or (field not in ('cutoff', 'points_start')
            and to_value is not null and to_date is null and from_date is null));

comment on column public.promotion_threshold_changes.field is
  '#866 (ruling R30), extended by #935 and R58: which value changed. threshold (the Promotion Threshold of kind, Task Points; a hand edit or a run''s hand-over) or percent (the kind''s top share: x, the top_percent rule''s percent, for voluntar_activ; y, org_settings.vote_retention_percent, for adunarea_generala; 1-100; a hand edit, the share a finalised run wrote through, or the day-one change a migration made) name a kind; tenure (the rule''s min_tenure_months, whole months 0-120) or enabled (the rule''s on/off flag, 0 off and 1 on, always a flip) name a Promotion Rule (promotion_rule_id) and are always manual; floor (the Eligibility Floor, Prag minim: Task Points >= 1, in to_value), cutoff (the Membership Cutoff Date, Data limită de intrare) and points_start (the Points Start Date, Data de început a punctajului), the last two dates in from_date / to_date, name neither (evaluation_settings). Defaults to threshold, the only value before R30.';
comment on column public.promotion_threshold_changes.kind is
  '#826: the Role Evaluation kind whose threshold or share changed (field threshold or percent). Null for a Promotion Rule edit (field tenure or enabled, #935), which names promotion_rule_id instead, and for a settings change (field floor, cutoff or points_start, R58).';
comment on column public.promotion_threshold_changes.promotion_rule_id is
  '#935: the Promotion Rule whose tenure or on/off flag changed (field tenure or enabled); null for every other field.';
comment on column public.promotion_threshold_changes.source is
  '#826, extended by R58: manual (a Member''s command; changed_by), role_evaluation (a Role Evaluation run''s write: the threshold it handed over, or the share, Eligibility Floor or Membership Cutoff Date it used; role_evaluation_id) or migration (a change a migration made, such as the day-one change of the shares; neither). promotion_threshold_changes_source_shape_ck pairs each with what it names, and promotion_threshold_changes_points_start_source_ck keeps a run from writing the Points Start Date.';
comment on column public.promotion_threshold_changes.from_value is
  '#826: the number before (null when none was set). Null for a date field (cutoff, points_start), which uses from_date.';
comment on column public.promotion_threshold_changes.to_value is
  '#826, relaxed by R58: the number after -- a threshold, a share, a tenure, an on/off flag or a Prag minim. Null exactly for a date field (cutoff, points_start), which uses to_date (promotion_threshold_changes_date_shape_ck).';
comment on column public.promotion_threshold_changes.from_date is
  'R58: the day before, for the date fields cutoff and points_start; null when none was set, and always null for every other field.';
comment on column public.promotion_threshold_changes.to_date is
  'R58: the day after, for the date fields cutoff and points_start; always set for them and always null for every other field.';

comment on table public.promotion_threshold_changes is
  '#826 (ruling R28), extended by #866 (ruling R30), #935 and R58: every change of a Promotion Threshold, of a kind''s top share, of a Promotion Rule''s tenure or on/off flag, or of an evaluation setting. field threshold: source manual (BC or the Moderator through set_promotion_threshold; changed_by) or role_evaluation (the value a run computed, handed over; role_evaluation_id). field percent: values 1-100; source manual (set_evaluation_percent; changed_by), role_evaluation (the share a finalised run used, written through; role_evaluation_id) or migration (the day-one change of x and y). field tenure / enabled: source manual only, through update_promotion_rule, naming promotion_rule_id instead of a kind; tenure in whole months 0-120, enabled 0 (off) or 1 (on). field floor (the Eligibility Floor, Prag minim: a number >= 1 in to_value) / cutoff (the Membership Cutoff Date, Data limită de intrare) / points_start (the Points Start Date, Data de început a punctajului), the last two dates in from_date / to_date with no number: source manual through the evaluation-settings commands or migration, and for floor and cutoff also role_evaluation (a finalised run writes the values it used); a run never writes points_start. from_value / from_date is the value before (null for a threshold, a share or a setting never set; a tenure or enabled row always carries from_value). Read by live level >= 6 only; written by the commands, a finalised run and the R58 migrations.';

-- ---------------------------------------------------------------------------
-- 3. The commands that set the three values.
-- ---------------------------------------------------------------------------
-- One command per value, in the shape of set_promotion_threshold: the argument
-- is judged first (it is malformed for every caller), then the gate -- claims
-- and a live activ Profile, then live level >= 6, BC or the Moderator, every
-- refusal 42501 evaluation_settings_manage_forbidden -- then (47, 1), the lock
-- every Role Evaluation write takes, then the one row for no key update, so a
-- run that writes a value through and a hand edit are serialised. An unchanged
-- value is PT409 nothing_to_update; a changed one is written with updated_by
-- and logged once in promotion_threshold_changes, source manual. "Today" in the
-- two date checks is today in Bucharest, the organisation's calendar, whatever
-- the database clock's zone.

create function private.set_eligibility_floor_impl(p_points integer)
returns public.evaluation_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid;
  v_current public.evaluation_settings%rowtype;
  v_from    integer;
begin
  -- 1. Malformed for every caller (evaluation_settings_floor_ck).
  if p_points is null or p_points < 1 then
    raise sqlstate 'PT400' using message = 'invalid_eligibility_floor';
  end if;

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'evaluation_settings_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'evaluation_settings_manage_forbidden';
  end if;

  -- 3. Serialised with every run and threshold edit, in their lock order:
  -- (47, 1), then the row.
  perform pg_catalog.pg_advisory_xact_lock(47, 1);
  select * into v_current
    from public.evaluation_settings as setting
   where setting.id = 1
   for no key update;

  -- 4. State. Editable at any time.
  if v_current.eligibility_floor is not distinct from p_points then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 5. Write, and audit.
  v_from := v_current.eligibility_floor;
  update public.evaluation_settings
     set eligibility_floor = p_points,
         updated_by = v_actor
   where id = 1
  returning * into v_current;

  insert into public.promotion_threshold_changes (
    field, from_value, to_value, source, changed_by
  ) values (
    'floor', v_from, p_points, 'manual', v_actor
  );

  return v_current;
end;
$$;

comment on function private.set_eligibility_floor_impl(integer) is
  'R58: body of public.set_eligibility_floor. PT400 invalid_eligibility_floor (null or below 1) before the gate; private.require_active_member() and live level >= 6, every refusal 42501 evaluation_settings_manage_forbidden; pg_advisory_xact_lock(47, 1), shared with run_role_evaluation, then the evaluation_settings row for no key update; PT409 nothing_to_update for an unchanged value. Writes eligibility_floor with updated_by and one manual promotion_threshold_changes row (field floor: from_value, to_value, changed_by).';

create function public.set_eligibility_floor(p_points integer)
returns public.evaluation_settings
language sql
security invoker
set search_path = ''
as $$
  select * from private.set_eligibility_floor_impl(p_points);
$$;

comment on function public.set_eligibility_floor(integer) is
  'R58: BC or the Moderator sets the Eligibility Floor (Prag minim) -- the Task Points a Member must reach in the Evaluation Period to be ranked at all, a whole number >= 1 -- at any time. Every change is logged in promotion_threshold_changes (field floor) with its author. 42501 evaluation_settings_manage_forbidden; PT400 invalid_eligibility_floor; PT409 nothing_to_update. Returns the evaluation_settings row.';

revoke execute on function private.set_eligibility_floor_impl(integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.set_eligibility_floor(integer)
  from public, anon, authenticated, service_role;
grant execute on function private.set_eligibility_floor_impl(integer) to authenticated;
grant execute on function public.set_eligibility_floor(integer) to authenticated;

create function private.set_membership_cutoff_impl(p_date date)
returns public.evaluation_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid;
  v_current public.evaluation_settings%rowtype;
  v_from    date;
begin
  -- 1. Malformed for every caller: no date, or a day that has not begun in
  -- Bucharest.
  if p_date is null or p_date > (now() at time zone 'Europe/Bucharest')::date then
    raise sqlstate 'PT400' using message = 'invalid_membership_cutoff';
  end if;

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'evaluation_settings_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'evaluation_settings_manage_forbidden';
  end if;

  -- 3. Serialised with every run and threshold edit, in their lock order:
  -- (47, 1), then the row.
  perform pg_catalog.pg_advisory_xact_lock(47, 1);
  select * into v_current
    from public.evaluation_settings as setting
   where setting.id = 1
   for no key update;

  -- 4. State. Editable at any time.
  if v_current.membership_cutoff is not distinct from p_date then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 5. Write, and audit.
  v_from := v_current.membership_cutoff;
  update public.evaluation_settings
     set membership_cutoff = p_date,
         updated_by = v_actor
   where id = 1
  returning * into v_current;

  insert into public.promotion_threshold_changes (
    field, from_date, to_date, source, changed_by
  ) values (
    'cutoff', v_from, p_date, 'manual', v_actor
  );

  return v_current;
end;
$$;

comment on function private.set_membership_cutoff_impl(date) is
  'R58: body of public.set_membership_cutoff. PT400 invalid_membership_cutoff (null, or after today in Europe/Bucharest) before the gate; private.require_active_member() and live level >= 6, every refusal 42501 evaluation_settings_manage_forbidden; pg_advisory_xact_lock(47, 1), shared with run_role_evaluation, then the evaluation_settings row for no key update; PT409 nothing_to_update for an unchanged date. Writes membership_cutoff with updated_by and one manual promotion_threshold_changes row (field cutoff: from_date, to_date, changed_by; no number).';

create function public.set_membership_cutoff(p_date date)
returns public.evaluation_settings
language sql
security invoker
set search_path = ''
as $$
  select * from private.set_membership_cutoff_impl(p_date);
$$;

comment on function public.set_membership_cutoff(date) is
  'R58: BC or the Moderator sets the Membership Cutoff Date (Data limită de intrare) -- a Voluntar who joined on or before it can be listed as a Promotion Candidate in the Voluntar Activ kind -- to a day that is not after today in Bucharest, at any time. Every change is logged in promotion_threshold_changes (field cutoff) with its author. 42501 evaluation_settings_manage_forbidden; PT400 invalid_membership_cutoff; PT409 nothing_to_update. Returns the evaluation_settings row.';

revoke execute on function private.set_membership_cutoff_impl(date)
  from public, anon, authenticated, service_role;
revoke execute on function public.set_membership_cutoff(date)
  from public, anon, authenticated, service_role;
grant execute on function private.set_membership_cutoff_impl(date) to authenticated;
grant execute on function public.set_membership_cutoff(date) to authenticated;

create function private.set_points_start_date_impl(p_date date)
returns public.evaluation_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid;
  v_current public.evaluation_settings%rowtype;
  v_from    date;
begin
  -- 1. Malformed for every caller: no date, or a day that has not begun in
  -- Bucharest.
  if p_date is null or p_date > (now() at time zone 'Europe/Bucharest')::date then
    raise sqlstate 'PT400' using message = 'invalid_points_start_date';
  end if;

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'evaluation_settings_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'evaluation_settings_manage_forbidden';
  end if;

  -- 3. Serialised with every run and threshold edit, in their lock order:
  -- (47, 1), then the row.
  perform pg_catalog.pg_advisory_xact_lock(47, 1);
  select * into v_current
    from public.evaluation_settings as setting
   where setting.id = 1
   for no key update;

  -- 4. State. Editable at any time.
  if v_current.points_start_date is not distinct from p_date then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 5. Write, and audit.
  v_from := v_current.points_start_date;
  update public.evaluation_settings
     set points_start_date = p_date,
         updated_by = v_actor
   where id = 1
  returning * into v_current;

  insert into public.promotion_threshold_changes (
    field, from_date, to_date, source, changed_by
  ) values (
    'points_start', v_from, p_date, 'manual', v_actor
  );

  return v_current;
end;
$$;

comment on function private.set_points_start_date_impl(date) is
  'R58: body of public.set_points_start_date. PT400 invalid_points_start_date (null, or after today in Europe/Bucharest) before the gate; private.require_active_member() and live level >= 6, every refusal 42501 evaluation_settings_manage_forbidden; pg_advisory_xact_lock(47, 1), shared with run_role_evaluation, then the evaluation_settings row for no key update; PT409 nothing_to_update for an unchanged date. Writes points_start_date with updated_by and one manual promotion_threshold_changes row (field points_start: from_date, to_date, changed_by; no number).';

create function public.set_points_start_date(p_date date)
returns public.evaluation_settings
language sql
security invoker
set search_path = ''
as $$
  select * from private.set_points_start_date_impl(p_date);
$$;

comment on function public.set_points_start_date(date) is
  'R58: BC or the Moderator sets the Points Start Date (Data de început a punctajului) -- the first Europe/Bucharest day whose Task Points count in any total; earlier points stay in the ledger and count for nothing -- to a day that is not after today in Bucharest, at any time, earlier or later than the one in force. Every change is logged in promotion_threshold_changes (field points_start) with its author; a Role Evaluation run never writes it. 42501 evaluation_settings_manage_forbidden; PT400 invalid_points_start_date; PT409 nothing_to_update. Returns the evaluation_settings row.';

revoke execute on function private.set_points_start_date_impl(date)
  from public, anon, authenticated, service_role;
revoke execute on function public.set_points_start_date(date)
  from public, anon, authenticated, service_role;
grant execute on function private.set_points_start_date_impl(date) to authenticated;
grant execute on function public.set_points_start_date(date) to authenticated;

-- The instant the Points Start Date begins: its Bucharest midnight, or null
-- while no date is set (every total then counts from the beginning). The
-- SQL readers of the Personal Score, Clasament, the Department Cup and the
-- Campaign totals compare the time points were earned against it, so the zone
-- is applied once, here, never by a client and never by the session's own zone.
create function private.points_floor()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select (setting.points_start_date::timestamp at time zone 'Europe/Bucharest')
    from public.evaluation_settings as setting
   where setting.id = 1
$$;

comment on function private.points_floor() is
  'R58: the instant the Points Start Date begins -- points_start_date at midnight in Europe/Bucharest, independent of the session time zone -- or null while no date is set, when every total counts from the beginning. Read by the SQL readers of the Personal Score, Clasament, the Department Cup and the Campaign totals, which count only the Task Points earned at or after it; granted to nobody, since only security-definer bodies call it.';

revoke execute on function private.points_floor()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The Points Start Date in every total.
-- ---------------------------------------------------------------------------
-- The date is applied inside the SQL readers, never by a client (spec section
-- D): the Personal Score (my_points), Clasament (leadership_leaderboard_impl),
-- the Department Cup (department_cup_rows) and the Campaign totals and reports
-- (campaign_totals_impl, campaign_report_impl) count only the Task Points of
-- Task Evaluations at or after private.points_floor(). Each is restated here
-- from its latest definition with that one change; signatures, wrappers and
-- grants stay as they were. Untouched on purpose: task_points_in_range (a Role
-- Evaluation names its own period), my_role_evaluation_standing,
-- refresh_promotion_candidates and every stake or reconciliation sum
-- (task_points_at_stake, delete_tasks_effect, group_delete_summary), which
-- count what a Task holds, not what a Member is shown.
--
-- Clasament alone may look back: an explicit "De la" (p_from) wins over the
-- date, even an earlier one, and the Department Cup, which that page reads
-- under the same Work Filter, follows it. A Campaign number never looks back.
-- campaign_totals counts a completed Umbrella (it has no Evaluation) by its own
-- completion instant against the Points Start Date alone; an explicit p_from or
-- p_to still leaves an Umbrella out, as #677 documents.
--
-- points_floor() has a SET clause, so the planner never inlines it and a bare
-- call in a WHERE would run once per ledger row. The SQL readers therefore ask
-- for it as a scalar subquery, (select private.points_floor()), which Postgres
-- evaluates once; the plpgsql Campaign readers bind it to a local first.

-- The Personal Score. The view is security invoker and points_floor() is
-- granted to nobody, so the view reads the setting row itself (every live
-- Member may read it) and turns the date into the same Europe/Bucharest
-- midnight; an unreadable or unset row is -infinity, i.e. no floor. The bound
-- sits in the left join's ON clause so a Member with nothing left to count
-- keeps their zero row. A Sanction has no Evaluation and counts by its own
-- created_at.
--
-- A task or task_reversal row counts by its award instant, read from the
-- Member's own ledger rows and never through task_evaluations: that join would
-- run under the caller's RLS, paying the Task visibility policies on every read
-- (many times the old cost) and coupling the Personal Score to them. Every
-- writer sets the `task` row's created_at equal to its Evaluation's
-- evaluated_at (evaluate_task, the Legacy Import and the #317 backfill; the
-- invariant is enforced by points_ledger_guard_award_instant, section 5, and
-- pinned by points_start_date.test.sql), and a task_reversal shares its award's
-- evaluation_id and member, so a window over evaluation_id gives an award and
-- its reversal the same instant and they count or not together. A pair whose
-- Task was deleted for good has lost its evaluation_id (task_id and
-- evaluation_id are nulled together), fails both arms below and never counts:
-- it nets to zero, and a reversal dated "now" must not count while its award,
-- dated before the floor, does not.
create or replace view public.my_points
with (security_invoker = on) as
 select p.id as member_id,
        coalesce(sum(l.delta), 0::bigint)::integer as points
   from public.profiles as p
  cross join (
        select coalesce(
                 (select (setting.points_start_date::timestamp at time zone 'Europe/Bucharest')
                    from public.evaluation_settings as setting
                   where setting.id = 1),
                 '-infinity'::timestamptz) as starts_at
       ) as bound
   left join (
        select ledger.member_id, ledger.delta, ledger.reason, ledger.created_at,
               ledger.evaluation_id,
               min(ledger.created_at) filter (where ledger.reason = 'task')
                 over (partition by ledger.evaluation_id) as awarded_at
          from public.points_ledger as ledger
         where ledger.member_id = (select auth.uid())
       ) as l
     on l.member_id = p.id
    and (
          (l.evaluation_id is not null and l.awarded_at >= bound.starts_at)
       or (l.reason not in ('task', 'task_reversal') and l.created_at >= bound.starts_at)
        )
  where public.auth_is_member()
    and p.id = (select auth.uid())
    and p.status = 'activ'
  group by p.id;

comment on view public.my_points is
  'The current active member''s complete personal points total, counted from the Points Start Date (R58: evaluation_settings.points_start_date, read through its Europe/Bucharest midnight; no date set means the whole ledger). Identity comes from auth.uid(); task points and sanctions are both included. A task or task_reversal row counts when its award instant falls on or after that instant. The award instant is read from the Member''s own ledger rows, never through task_evaluations: the task row''s created_at is the Evaluation''s evaluated_at by every writer''s invariant (enforced by the points_ledger_guard_award_instant trigger and pinned by points_start_date.test.sql), and a task_reversal shares the award''s evaluation_id, so an award and its reversal count or not together; a security-invoker view that joined task_evaluations would pay the Task visibility policies on every read and depend on them. A Sanction, which has no Evaluation, counts when its own created_at does. A row whose Task was deleted for good has no Evaluation left and never counts (the award and its reversal net to zero). A Member with nothing left to count still gets their zero row. This security-invoker view intentionally exposes at most one row and never accepts a member ID from the client.';

-- Clasament.
create or replace function private.leadership_leaderboard_impl(
  p_group_id    bigint,
  p_campaign_id bigint,
  p_from        timestamptz,
  p_to          timestamptz,
  p_preferred   boolean
)
returns table (member_id uuid, full_name text, nickname text, points integer, rank integer)
language sql
stable
security definer
set search_path = ''
as $$
  select private.require_date_range(p_from, p_to);

  with gate as (
    -- One row for a live, active BCE+ caller; none otherwise, which empties
    -- both branches below (no rows, never an error).
    select 1 as allowed
     where public.auth_level() >= 5
       and (select private.caller_level()) >= 5
       and exists (
         select 1
           from public.profiles as caller
          where caller.id = (select auth.uid())
            and caller.status = 'activ'
       )
  ),
  muted as (
    -- R43: the caller's muted Groups, judged once -- the rows they unselected
    -- that private.group_muted_for still honours -- for the preferred view only.
    select unselected.group_id
      from gate
     cross join public.member_group_unselected as unselected
     where coalesce(p_preferred, false)
       and unselected.member_id = (select auth.uid())
       and private.group_muted_for(unselected.group_id, unselected.member_id)
  ),
  task_points as (
    select entry.member_id as member_id,
           sum(entry.delta)::int as points
      from gate
     cross join public.points_ledger as entry
      join public.task_evaluations as evaluation on evaluation.id = entry.evaluation_id
      join public.tasks as task on task.id = entry.task_id
      join public.groups as task_group on task_group.id = task.group_id
     where entry.reason in ('task', 'task_reversal')
       and (p_group_id is null or task_group.path @> array[p_group_id])
       and (p_campaign_id is null or task.campaign_id = p_campaign_id)
       -- R58: the lower bound is the caller's "De la" -- even one earlier than
       -- the Points Start Date, which is how Clasament looks back -- or, when
       -- there is none, the Points Start Date itself (null while unset, and
       -- then everything counts). Read once per query as a scalar subquery:
       -- a bare call would run once per ledger row.
       and evaluation.evaluated_at >= coalesce(p_from, (select private.points_floor()), '-infinity'::timestamptz)
       and (p_to is null or evaluation.evaluated_at < p_to)
       -- R43: the preferred view counts only the Tasks of the caller's selected
       -- Groups (the Task's own Group); empty unless p_preferred.
       and task.group_id not in (select muted.group_id from muted)
     group by entry.member_id
  ),
  roster as (
    -- Unfiltered: every active Member.
    select member.id as member_id
      from gate
     cross join public.profiles as member
     where p_group_id is null
       and member.status = 'activ'
    union
    -- A Group filter: the active members of that Group's subtree (#929, R32) --
    -- roster rows, Automatic Membership and the membri de drept, from the one
    -- member set. The Role filter below keeps BCE, BC and the Moderator out.
    select member_set.member_id
      from gate
     cross join public.groups as roster_group
     cross join lateral private.group_member_set(roster_group.id) as member_set
      join public.profiles as member on member.id = member_set.member_id
     where p_group_id is not null
       and roster_group.path @> array[p_group_id]
       and member.status = 'activ'
  ),
  board as (
    select roster.member_id from roster
    union
    select task_points.member_id from task_points
  )
  select member.id,
         member.full_name,
         member.nickname,
         coalesce(scored.points, 0),
         rank() over (order by coalesce(scored.points, 0) desc)::int
    from board
    join public.profiles as member on member.id = board.member_id
    left join task_points as scored on scored.member_id = board.member_id
   -- #907 (amending ruling 1 of 2026-09-28, #843): only the Roles below BCE
   -- are ranked. rank() runs after this filter, so the ranks stay contiguous
   -- without BCE, BC and the Moderator.
   where member.role in ('recrut', 'voluntar', 'activ', 'vot')
   order by coalesce(scored.points, 0) desc, member.full_name asc;
$$;

comment on function private.leadership_leaderboard_impl(bigint, bigint, timestamptz, timestamptz, boolean) is
  'Group-subtree Leaderboard body. Rows are every active Member below BCE (Recrut, Voluntar, Voluntar Activ, Voluntar cu Drept de Vot) -- with a Group filter, the active members of that Group''s subtree by private.group_member_set (roster rows and Automatic Membership, so the Adunarea Generala lists its level-3 Members, #929) -- plus every Member below BCE who earned Task Points under the filter, whatever their status (#907). BCE, BC and the Moderator are never rows, whatever the filter. Points follow the Task Group, never the Member roster; Cup participation settings do not restrict the board; a Campaign or a date range narrows the points, never the Members. The date range (#677) reads the award instant -- task_evaluations.evaluated_at through points_ledger.evaluation_id, for a credit and its reversal alike -- half-open [p_from, p_to); PT400 invalid_date_range first when p_to < p_from. R58: with no p_from the range begins at the Points Start Date (private.points_floor(), asked once per query; no date set means no floor), and an explicit p_from -- even one earlier -- is honoured, which is how Clasament''s Work Filter looks back. p_preferred (R43, Grupuri preferate) counts only the points of Tasks whose own Group the caller has not unselected (private.group_muted_for); the Members listed are unchanged.';

-- The Department Cup.
create or replace function private.department_cup_rows(
  p_campaign_id bigint,
  p_from        timestamptz,
  p_to          timestamptz
)
returns table (group_id bigint, name text, points integer, members bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select private.require_date_range(p_from, p_to);

  with task_points as (
    select cup.id as cup_group_id, sum(entry.delta)::int as points
      from public.points_ledger as entry
      join public.task_evaluations as evaluation on evaluation.id = entry.evaluation_id
      join public.tasks as task on task.id = entry.task_id
      join public.groups as task_group on task_group.id = task.group_id
      join lateral (
        select competing.id, ancestor.depth
          from unnest(task_group.path) with ordinality as ancestor(id, depth)
          join public.groups as competing on competing.id = ancestor.id and competing.competes_in_cup
         order by ancestor.depth desc
         limit 1
      ) as cup on true
     where entry.reason in ('task', 'task_reversal')
       and (p_campaign_id is null or task.campaign_id = p_campaign_id)
       -- R58: the Cup is read from Clasament's Work Filter, so it follows the
       -- same lower bound: the caller's "De la" (the lookback), else the Points
       -- Start Date (null while unset, and then everything counts). Read once
       -- per query as a scalar subquery, never once per ledger row.
       and evaluation.evaluated_at >= coalesce(p_from, (select private.points_floor()), '-infinity'::timestamptz)
       and (p_to is null or evaluation.evaluated_at < p_to)
       and not exists (
         select 1 from unnest(task_group.path) with ordinality as link(id, depth)
           join public.groups as node on node.id = link.id
          where link.depth > cup.depth and not node.counts_toward_parent_cup)
     group by cup.id
  ), active_members as (
    select membership.group_id, count(*)::bigint as members
      from public.group_members as membership
      join public.profiles as member on member.id = membership.member_id
     where member.status = 'activ'
     group by membership.group_id
  )
  select grp.id, grp.name,
         coalesce(task_points.points, 0), coalesce(active_members.members, 0)
    from public.groups as grp
    left join task_points on task_points.cup_group_id = grp.id
    left join active_members on active_members.group_id = grp.id
   where public.auth_level() >= 5
     and (select private.caller_level()) >= 5
     and exists (
       select 1
         from public.profiles as caller
        where caller.id = (select auth.uid())
          and caller.status = 'activ'
     )
     and grp.competes_in_cup
     -- #861 (Audit D-10): an archived Group has left the Cup.
     and grp.status = 'active'
   order by coalesce(task_points.points, 0) desc, grp.name asc;
$$;

comment on function private.department_cup_rows(bigint, timestamptz, timestamptz) is
  'Live BCE+ Cup rows from active competing Group settings -- an archived Group has left the Cup (#861, Audit D-10). Task/reversal ledger points reach the nearest competing ancestor only when every lower link counts. Members are the active explicit roster of the competitor itself. The date range (#677) reads the award instant -- task_evaluations.evaluated_at through points_ledger.evaluation_id -- half-open [p_from, p_to); PT400 invalid_date_range first when p_to < p_from. R58: with no p_from the range begins at the Points Start Date (private.points_floor(), asked once per query; no date set means no floor), and an explicit p_from -- even one earlier -- is honoured, so the Cup read beside Clasament''s Work Filter looks back with it.';

-- A Campaign's report.
create or replace function private.campaign_report_impl(
  p_campaign_id bigint,
  p_from        timestamptz,
  p_to          timestamptz
)
returns table (member_id uuid, full_name text, nickname text, tasks_completed integer, points integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_floor timestamptz;
begin
  perform private.require_date_range(p_from, p_to);
  perform private.require_campaign_report_access(p_campaign_id);

  -- R58: the Points Start Date (null while unset), asked for once. A Campaign
  -- number never looks back past it, whatever "De la" the caller sends.
  v_floor := private.points_floor();

  return query
  with campaign_tasks as (
    select task.id, task.status
      from public.tasks as task
     where task.campaign_id = p_campaign_id
  ),
  -- Every Member who ever held the Executor Assignment on a Campaign Task
  -- (ruling 3) -- Assignment History, not the ledger, so a give-up or an
  -- unfulfilled/cancelled outcome still leaves the volunteer on the report.
  -- The date range narrows the numbers, never the roster.
  executors as (
    select distinct assignment.member_id
      from public.task_assignments as assignment
      join campaign_tasks as ct on ct.id = assignment.task_id
  ),
  -- Net ledger rows per (member, Task) awarded inside the range: the range
  -- reads the Evaluation's instant, which a credit and its reversal share,
  -- so a reversed award nets to zero in every range (#677). R58: and never
  -- before the Points Start Date.
  ledger_rows as (
    select entry.member_id, entry.task_id, entry.delta
      from public.points_ledger as entry
      join campaign_tasks as ct on ct.id = entry.task_id
      join public.task_evaluations as evaluation on evaluation.id = entry.evaluation_id
     where entry.reason in ('task', 'task_reversal')
       and (p_from is null or evaluation.evaluated_at >= p_from)
       and (v_floor is null or evaluation.evaluated_at >= v_floor)
       and (p_to is null or evaluation.evaluated_at < p_to)
  ),
  -- One row per (member, Task): the member's NET ledger contribution to that
  -- Task -- both points and tasks_completed are derived from this single
  -- number, never from ledger row counts (#625 fix round 1).
  member_task_net as (
    select ledger_rows.member_id, ledger_rows.task_id,
           sum(ledger_rows.delta)::int as net_points
      from ledger_rows
     group by ledger_rows.member_id, ledger_rows.task_id
  ),
  points_by_member as (
    select member_task_net.member_id, sum(member_task_net.net_points)::int as points
      from member_task_net
     group by member_task_net.member_id
  ),
  -- A completed Task counts toward tasks_completed only where the member's
  -- OWN net on it inside the range is positive.
  completed_by_member as (
    select member_task_net.member_id,
           count(*)::int as tasks_completed
      from member_task_net
      join campaign_tasks as ct
        on ct.id = member_task_net.task_id and ct.status = 'completed'
     where member_task_net.net_points > 0
     group by member_task_net.member_id
  )
  select executors.member_id,
         profile.full_name,
         profile.nickname,
         coalesce(completed_by_member.tasks_completed, 0),
         coalesce(points_by_member.points, 0)
    from executors
    join public.profiles as profile on profile.id = executors.member_id
    left join points_by_member on points_by_member.member_id = executors.member_id
    left join completed_by_member on completed_by_member.member_id = executors.member_id
   order by coalesce(points_by_member.points, 0) desc, profile.full_name asc;
end;
$$;

comment on function private.campaign_report_impl(bigint, timestamptz, timestamptz) is
  'One row per volunteer who ever held the Executor Assignment on a Task of this Campaign (Assignment History, not the ledger -- ruling 3); the date range never removes a volunteer. points is each member''s net points_ledger sum over the Campaign''s Tasks awarded in [p_from, p_to) -- the award instant is task_evaluations.evaluated_at through points_ledger.evaluation_id, shared by a credit and its reversal (#677, R13); tasks_completed counts only a completed Task on which that member''s OWN in-range net is positive. R58: the range never begins before the Points Start Date (private.points_floor(), asked once; no date set means no floor), whatever p_from says -- a Campaign report has no lookback -- so points and tasks_completed both count from it. PT400 invalid_date_range when p_to < p_from, checked first; then PT404 campaign_not_found for an unknown Campaign, checked before authority (ruling 2); 42501 campaign_report_forbidden for a claimless/inactive caller or one private.can_manage_group_work refuses.';

-- A Campaign's totals.
create or replace function private.campaign_totals_impl(
  p_campaign_id bigint,
  p_from        timestamptz,
  p_to          timestamptz
)
returns table (tasks_total integer, tasks_completed integer, points_total integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_floor timestamptz;
begin
  perform private.require_date_range(p_from, p_to);
  perform private.require_campaign_report_access(p_campaign_id);

  -- R58: the Points Start Date (null while unset), asked for once. A Campaign
  -- number never looks back past it, whatever "De la" the caller sends.
  v_floor := private.points_floor();

  return query
  with campaign_tasks as (
    select task.id, task.status, task.kind, task.completed_at
      from public.tasks as task
     where task.campaign_id = p_campaign_id
  ),
  -- The instant a completed Task's completion was awarded: its live
  -- (un-reversed) completed Evaluation. A completed Task without one -- an
  -- Umbrella, which is never evaluated -- has no award instant: it counts
  -- when no bound is set (the unbounded result is unchanged) and never
  -- inside a bounded range, whose predicates a null instant cannot satisfy.
  -- R58: the Points Start Date alone is the exception: it reads a completed
  -- Umbrella by its own completion instant (tasks.completed_at), so an Umbrella
  -- completed on or after the date keeps counting when no range is given,
  -- while an explicit p_from or p_to still leaves it out, as above (#677).
  completed_tasks as (
    select ct.id,
           (select max(evaluation.evaluated_at)
              from public.task_evaluations as evaluation
             where evaluation.task_id = ct.id
               and evaluation.outcome = 'completed'
               and evaluation.reversed_at is null) as awarded_at,
           -- R58: an Umbrella has no Evaluation; the Points Start Date reads it
           -- by its own completion instant.
           case when ct.kind = 'umbrella' then ct.completed_at end as umbrella_completed_at
      from campaign_tasks as ct
     where ct.status = 'completed'
  ),
  ledger_total as (
    select coalesce(sum(entry.delta), 0)::int as points_total
      from public.points_ledger as entry
      join campaign_tasks as ct on ct.id = entry.task_id
      join public.task_evaluations as evaluation on evaluation.id = entry.evaluation_id
     where entry.reason in ('task', 'task_reversal')
       and (p_from is null or evaluation.evaluated_at >= p_from)
       and (v_floor is null or evaluation.evaluated_at >= v_floor)
       and (p_to is null or evaluation.evaluated_at < p_to)
  )
  select
    (select count(*) from campaign_tasks)::int,
    (select count(*)
       from completed_tasks
      where (p_from is null or completed_tasks.awarded_at >= p_from)
        and (v_floor is null
             or coalesce(completed_tasks.awarded_at, completed_tasks.umbrella_completed_at) >= v_floor)
        and (p_to is null or completed_tasks.awarded_at < p_to))::int,
    (select ledger_total.points_total from ledger_total);
end;
$$;

comment on function private.campaign_totals_impl(bigint, timestamptz, timestamptz) is
  'tasks_total/tasks_completed/points_total for one Campaign -- every Task (any kind) carrying campaign_id = p_campaign_id, points summed off the points_ledger rows private.evaluate_task writes exactly as private.campaign_report_impl does. The date range (#677) follows the award instant: points_total sums ledger rows whose Evaluation (task_evaluations.evaluated_at via points_ledger.evaluation_id) falls in [p_from, p_to); tasks_completed counts completed Tasks whose live completed Evaluation falls in it (a completed Umbrella, never evaluated, counts only when no p_from or p_to is set); tasks_total ignores the range and stays the whole Campaign (R13 speaks of points only). R58: neither points_total nor tasks_completed counts before the Points Start Date (private.points_floor(), asked once; no date set means no floor), whatever p_from says; the date alone reads a completed Umbrella by its own completed_at, so one completed on or after it keeps counting when no p_from or p_to is given and one completed before it does not. PT400 invalid_date_range first when p_to < p_from; then the same PT404/42501 preamble as private.campaign_report_impl -- both share private.require_campaign_report_access.';

-- The public wrappers are unchanged; only what they document gains the rule.
comment on function public.leadership_leaderboard(bigint, bigint, timestamptz, timestamptz, boolean) is
  'Live BCE+ Task-points Leaderboard filtered by Group subtree, Campaign and award date range (#677: [p_from, p_to) on the Evaluation instant, either bound optional; PT400 invalid_date_range when p_to < p_from). Lists every active Member below BCE, at 0 points when they earned nothing (with a Group filter, the Members of that Group''s subtree), and retains inactive earners (#907). Never ranks BCE, BC or the Moderator (ruling 1 of 2026-09-28, amended by #907). Zero/negative totals, shared ranks on ties, and stable points-descending/name ordering. R58: with no p_from the range begins at the Points Start Date (Data de început a punctajului); an explicit earlier p_from reads the real numbers (the lookback, Clasament only). Returns the Nickname beside the full name. p_preferred (R43) counts only the points earned in the Groups the caller keeps selected in Grupuri preferate.';
comment on function public.department_cup(bigint, timestamptz, timestamptz) is
  'Campaign- and award-date-filtered Group Cup standings as (group_id, name, points, members); the date range is [p_from, p_to) on the Evaluation instant, either bound optional (#677). Failed leadership gates return no rows; an inverted range is PT400 invalid_date_range. R58: with no p_from the range begins at the Points Start Date; an explicit earlier p_from looks back.';
comment on function public.campaign_totals(bigint, timestamptz, timestamptz) is
  'Whole-Campaign totals (tasks_total, tasks_completed, points_total). With a date range, points_total and tasks_completed follow the award instant in [p_from, p_to) and tasks_total stays the whole Campaign (#677, R13). R58: points_total and tasks_completed never count before the Points Start Date, whatever p_from says. Same authority and error shape as public.campaign_report.';
comment on function public.campaign_report(bigint, timestamptz, timestamptz) is
  'Per-volunteer Campaign report (member_id, full_name, nickname, tasks_completed, points), optionally narrowed to points awarded in [p_from, p_to) (#677, R13) and never counted before the Points Start Date (R58), whatever p_from says; callable only by whoever manages work in the Campaign''s Group, or BC/Moderator (private.can_manage_group_work). PT400 invalid_date_range when p_to < p_from; PT404 campaign_not_found for an unknown Campaign; 42501 campaign_report_forbidden otherwise.';

-- ---------------------------------------------------------------------------
-- 5. The award instant, enforced.
-- ---------------------------------------------------------------------------
-- my_points (section 4) reads a Task's award instant from the `task` ledger
-- row's created_at, never through task_evaluations, and so relies on every
-- writer dating that row by its Evaluation's evaluated_at. That held by
-- convention -- evaluate_task, the Legacy Import, the #317 backfill and the
-- fixtures all do it -- and a writer that forgot would silently move a Task
-- across the Points Start Date in the Personal Score alone. Ruling 18 makes it
-- a rule of the table: a `task` row naming an Evaluation is refused unless it
-- is dated by that Evaluation's instant. Only inserts are guarded; the ledger
-- is append-only, and a task_reversal row is dated by its own reversal (the
-- view reads the award's instant for the pair).
create function private.guard_ledger_award_instant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluated_at timestamptz;
begin
  if new.reason = 'task' and new.evaluation_id is not null then
    select evaluation.evaluated_at
      into v_evaluated_at
      from public.task_evaluations as evaluation
     where evaluation.id = new.evaluation_id;

    if new.created_at is distinct from v_evaluated_at then
      raise exception using
        errcode = '23514',
        message = 'ledger_award_instant_mismatch',
        detail = format('The task ledger row is dated %s but Evaluation %s was made at %s.',
                        new.created_at, new.evaluation_id, v_evaluated_at),
        hint = 'Date a task ledger row by its Evaluation''s evaluated_at; public.my_points reads the award instant from it.';
    end if;
  end if;
  return new;
end;
$$;

create trigger points_ledger_guard_award_instant
  before insert on public.points_ledger
  for each row
  execute function private.guard_ledger_award_instant();

revoke all on function private.guard_ledger_award_instant()
  from public, anon, authenticated, service_role;

comment on function private.guard_ledger_award_instant() is
  'R58 ruling 18: BEFORE INSERT on public.points_ledger. A `task` row that names an Evaluation must carry created_at equal to that Evaluation''s evaluated_at, else 23514 ledger_award_instant_mismatch. public.my_points reads a Task''s award instant from the task row''s created_at instead of joining task_evaluations (which its security-invoker reader would pay the Task visibility policies for), so the equality is made a rule of the table rather than a habit of every writer. Other reasons, and rows without an Evaluation, are outside it.';

-- R58 (Alex, 2026-10-18; spec docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md,
-- section B): the evaluation settings -- the Prag minim (Eligibility Floor),
-- the Data limită de intrare (Membership Cutoff) and the Data de început a
-- punctajului (Points Start Date) -- as one row BC and the Moderator will set
-- from the app instead of by migration, and the change log that holds the two
-- date-valued ones.
--
-- Sections:
--   1. public.evaluation_settings: the singleton row, unset on day one.
--   2. public.promotion_threshold_changes learns the three new fields, a pair
--      of date columns and the `migration` source.
--
-- The row is reference data seeded here (house rule 6), never by seed.sql.
-- Nothing reads or writes the three values yet; the commands that set them
-- and the readers that apply them follow in this file.

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
  'R58 (section B): the one row of evaluation settings BC or the Moderator sets from the app -- eligibility_floor (Prag minim), membership_cutoff (Data limită de intrare) and points_start_date (Data de început a punctajului). All three are null on day one. Every live active Member reads the row (a Member may know the rules of their own promotion and from when their points count); no client writes it directly: set_eligibility_floor, set_membership_cutoff and set_points_start_date are the write path, one command per value, and each change is logged in promotion_threshold_changes (fields floor, cutoff, points_start).';
comment on column public.evaluation_settings.id is
  'R58: always 1 (evaluation_settings_singleton_ck) -- the table holds exactly one row.';
comment on column public.evaluation_settings.eligibility_floor is
  'R58: Prag minim, shared by both Role Evaluation kinds -- the Task Points a Member must reach in the Evaluation Period to be ranked at all; a whole number >= 1, so a line a run computes is always a legal Promotion Threshold. Null until BC or the Moderator sets it; a Role Evaluation run or Simulation is refused meanwhile (PT409 eligibility_floor_not_set).';
comment on column public.evaluation_settings.membership_cutoff is
  'R58: Data limită de intrare, Voluntar Activ kind only -- a Voluntar who joined on or before this day (profiles.joined_at) can be listed as a Promotion Candidate. Null until BC or the Moderator sets it; nobody is listed live meanwhile, and a Voluntar Activ run or Simulation is refused.';
comment on column public.evaluation_settings.points_start_date is
  'R58: Data de început a punctajului -- the first Europe/Bucharest day whose Task Points count in any total (the Personal Score, Clasament, the Department Cup, Campaign totals); earlier points stay in the ledger and count for nothing. Applied inside the SQL readers (private.points_floor), never by the client. Null until BC or the Moderator sets it: every total counts from the beginning.';
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
-- change made by a migration (no Member, no run). `role_evaluation` keeps its
-- meaning: a run's write. No `run` value is added.
alter table public.promotion_threshold_changes
  add column from_date date,
  add column to_date date;

alter table public.promotion_threshold_changes
  alter column to_value drop not null;

alter table public.promotion_threshold_changes
  drop constraint promotion_threshold_changes_field_ck,
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
  -- A threshold and a Prag minim are at least 1 Task Point (a share has its own
  -- 1-100 check, promotion_threshold_changes_percent_shape_ck; a tenure may be
  -- 0 and enabled is 0 or 1). A date row has no number, so the comparison is
  -- null there and date_shape_ck is what rules it.
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
  '#866 (ruling R30), extended by #935 and R58: which value changed. threshold (the Promotion Threshold of kind, Task Points; a hand edit or a run''s hand-over) or percent (the kind''s top share: x, for voluntar_activ; y, org_settings.vote_retention_percent, for adunarea_generala; always manual, 1-100) name a kind; tenure (a Promotion Rule''s min_tenure_months, whole months 0-120) or enabled (its on/off flag, 0 off and 1 on, always a flip) name a Promotion Rule (promotion_rule_id) and are always manual; floor (the Prag minim, Task Points >= 1, in to_value), cutoff (the Data limită de intrare) and points_start (the Data de început a punctajului), both dates in from_date / to_date, name neither (evaluation_settings). Defaults to threshold, the only value before R30.';
comment on column public.promotion_threshold_changes.kind is
  '#826: the Role Evaluation kind whose threshold or share changed (field threshold or percent). Null for a Promotion Rule edit (field tenure or enabled, #935), which names promotion_rule_id instead, and for a settings change (field floor, cutoff or points_start, R58).';
comment on column public.promotion_threshold_changes.promotion_rule_id is
  '#935: the Promotion Rule whose tenure or on/off flag changed (field tenure or enabled); null for every other field.';
comment on column public.promotion_threshold_changes.source is
  '#826, extended by R58: manual (a Member''s command; changed_by), role_evaluation (a Role Evaluation run''s write; role_evaluation_id) or migration (a change a migration made; neither). promotion_threshold_changes_source_shape_ck pairs each with what it names.';
comment on column public.promotion_threshold_changes.from_value is
  '#826: the number before (null when none was set). Null for a date field (cutoff, points_start), which uses from_date.';
comment on column public.promotion_threshold_changes.to_value is
  '#826, relaxed by R58: the number after -- a threshold, a share, a tenure, an on/off flag or a Prag minim. Null exactly for a date field (cutoff, points_start), which uses to_date (promotion_threshold_changes_date_shape_ck).';
comment on column public.promotion_threshold_changes.from_date is
  'R58: the day before, for the date fields cutoff and points_start; null when none was set, and always null for every other field.';
comment on column public.promotion_threshold_changes.to_date is
  'R58: the day after, for the date fields cutoff and points_start; always set for them and always null for every other field.';

comment on table public.promotion_threshold_changes is
  '#826 (ruling R28), extended by #866 (ruling R30), #935 and R58: every change of a Promotion Threshold, of a kind''s top share, of a Promotion Rule''s tenure or on/off flag, or of an evaluation setting. field threshold: source manual (BC or the Moderator through set_promotion_threshold; changed_by) or role_evaluation (the value a run computed, handed over; role_evaluation_id). field percent: source manual only, through set_evaluation_percent, values 1-100. field tenure / enabled: source manual only, through update_promotion_rule, naming promotion_rule_id instead of a kind. field floor (the Prag minim, a number >= 1 in to_value) / cutoff / points_start (the Data limită de intrare and the Data de început a punctajului, dates in from_date / to_date and no number): source manual through the three evaluation-settings commands, or migration for a change a migration made; a run may also write them (role_evaluation). from_value / from_date is the value before (null when none was set). Read by live level >= 6 only; written only by the commands.';

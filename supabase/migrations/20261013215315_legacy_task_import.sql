-- #1049: the one-time Legacy Import of the Google Sheets Task Tracker (spec 2026-10-13, ruling R53)
--
-- OSUBB's pre-app points system is imported once, as real Tasks dated on the
-- day the work was completed. This file adds:
--
-- 1. public.legacy_task_imports: which sheet row became which Task. It is the
--    import's idempotency key (a re-run skips a registered row) and the only
--    thing the legacy-source trigger accepts.
-- 2. private.reject_legacy_evaluation_source: #317 closed the reserved
--    `legacy_migration` Evaluation source for good and said a later backfill
--    would disable the trigger "deliberately". This one does not disable it:
--    the trigger now lets the source through for a registered Task only, so
--    nothing else can ever write it and no window opens.
-- 3. public.import_legacy_tasks: the bulk command, service role only.
-- 4. public.legacy_task_import_totals: the read the import script compares
--    its file with.
--
-- 3 and 4 are dropped by #1050 once the production run is verified. The
-- registry stays as provenance.

-- ---------------------------------------------------------------------------
-- 1. The registry
-- ---------------------------------------------------------------------------
create table public.legacy_task_imports (
  tracker_id  text    not null,
  sheet_row   integer not null,
  sheet_id    text,
  task_id     bigint  references public.tasks (id) on delete set null,
  imported_by uuid    references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint legacy_task_imports_pkey primary key (tracker_id, sheet_row),
  constraint legacy_task_imports_task_id_key unique (task_id),
  constraint legacy_task_imports_tracker_id_ck check (tracker_id ~ '^[A-Za-z0-9_-]{20,80}$'),
  constraint legacy_task_imports_sheet_row_ck check (sheet_row between 2 and 100000),
  constraint legacy_task_imports_sheet_id_ck check (sheet_id is null or char_length(sheet_id) between 1 and 40)
);

-- imported_by is a foreign key: its index keeps a Profile's removal from scanning the registry.
create index legacy_task_imports_imported_by_idx on public.legacy_task_imports (imported_by);

alter table public.legacy_task_imports enable row level security;
revoke all on table public.legacy_task_imports from public, anon, authenticated, service_role;
-- A service- and definer-only table says so in a policy as well (#775's idiom):
-- deny-all for both client roles, so RLS on never reads as "policy forgotten".
create policy legacy_task_imports_manage_no_client on public.legacy_task_imports
  as restrictive for all to authenticated, anon using (false) with check (false);

comment on table public.legacy_task_imports is
  '#1049: one row per row of a legacy Google Sheets Task Tracker that the Legacy Import turned into a Task -- the Drive file id of the tracker, the row number in its Tasks tab (header = 1), the sheet''s own Id (not unique there) and the Task. A Task later deleted for good keeps its row with task_id null, so the key stays claimed and a later call still skips the row. RLS on with one restrictive deny-all policy for the client roles and no grant to any role: public.import_legacy_tasks writes it and public.legacy_task_import_totals reads it, both as definer. Excluded from the live change broadcast.';

-- ---------------------------------------------------------------------------
-- 2. The legacy source, closed except for a registered Task
-- ---------------------------------------------------------------------------
create or replace function private.reject_legacy_evaluation_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1
               from public.legacy_task_imports as imported
              where imported.task_id = new.task_id) then
    return new;
  end if;
  raise exception using
    errcode = '23514',
    message = 'task_evaluation_legacy_source_closed';
end;
$$;

revoke all on function private.reject_legacy_evaluation_source()
  from public, anon, authenticated, service_role;

comment on function private.reject_legacy_evaluation_source() is
  '#317, #1049: BEFORE INSERT on public.task_evaluations for source = legacy_migration. Refuses with 23514 task_evaluation_legacy_source_closed unless the Task is registered in public.legacy_task_imports, which only the Legacy Import writes. Definer because the registry is readable by no role.';

-- ---------------------------------------------------------------------------
-- 3. The import command
-- ---------------------------------------------------------------------------
create function public.import_legacy_tasks(p_actor uuid, p_rows jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_today       date := (now() at time zone 'Europe/Bucharest')::date;
  v_item        jsonb;
  v_index       integer;
  v_where       text;
  v_text        text;
  v_date        date;
  v_received    integer;
  v_imported    integer := 0;
  v_already     integer := 0;
  v_points      integer := 0;
  v_row         record;
  v_at          timestamptz;
  v_deadline    timestamptz;
  v_award       integer;
  v_task_id     bigint;
  v_assignment  bigint;
  v_evaluation  bigint;
  v_members     uuid[]        := '{}'::uuid[];
  v_deltas      integer[]     := '{}'::integer[];
  v_tasks       bigint[]      := '{}'::bigint[];
  v_evaluations bigint[]      := '{}'::bigint[];
  v_instants    timestamptz[] := '{}'::timestamptz[];
begin
  -- 1. Malformed for every caller (conventions section 2). Each refusal names
  --    the row in DETAIL: the operator has a file of thousands to fix.
  if p_actor is null then
    raise sqlstate 'PT400' using message = 'invalid_actor';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise sqlstate 'PT400' using message = 'invalid_rows';
  end if;
  v_received := jsonb_array_length(p_rows);
  if v_received > 200 then
    raise sqlstate 'PT400' using message = 'too_many_rows';
  end if;

  for v_item, v_index in
    select entry.value, entry.ordinality::integer
      from jsonb_array_elements(p_rows) with ordinality as entry
     order by entry.ordinality
  loop
    v_where := 'row ' || v_index;
    if jsonb_typeof(v_item) <> 'object' then
      raise sqlstate 'PT400' using message = 'invalid_rows', detail = v_where;
    end if;
    if coalesce(v_item ->> 'tracker_id', '') !~ '^[A-Za-z0-9_-]{20,80}$' then
      raise sqlstate 'PT400' using message = 'invalid_tracker_id', detail = v_where;
    end if;
    if coalesce(v_item ->> 'sheet_row', '') !~ '^[0-9]{1,6}$'
       or (v_item ->> 'sheet_row')::integer not between 2 and 100000 then
      raise sqlstate 'PT400' using message = 'invalid_sheet_row', detail = v_where;
    end if;
    v_where := format('row %s (%s, sheet row %s)', v_index, v_item ->> 'tracker_id', v_item ->> 'sheet_row');
    if char_length(coalesce(v_item ->> 'sheet_id', '')) > 40 then
      raise sqlstate 'PT400' using message = 'invalid_sheet_id', detail = v_where;
    end if;

    v_text := regexp_replace(coalesce(v_item ->> 'title', ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
    if v_text = '' then
      raise sqlstate 'PT400' using message = 'title_required', detail = v_where;
    end if;
    if char_length(v_text) < 3 then
      raise sqlstate 'PT400' using message = 'title_too_short', detail = v_where;
    end if;
    if char_length(v_text) > 120 then
      raise sqlstate 'PT400' using message = 'title_too_long', detail = v_where;
    end if;
    if char_length(regexp_replace(coalesce(v_item ->> 'description', ''), '^[[:space:]]+|[[:space:]]+$', '', 'g')) > 2000 then
      raise sqlstate 'PT400' using message = 'description_too_long', detail = v_where;
    end if;

    if v_item ->> 'group_id' is null then
      raise sqlstate 'PT400' using message = 'task_group_required', detail = v_where;
    end if;
    if v_item ->> 'group_id' !~ '^[1-9][0-9]{0,17}$' then
      raise sqlstate 'PT400' using message = 'invalid_origin', detail = v_where;
    end if;
    if coalesce(v_item ->> 'executor_id', '')
         !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise sqlstate 'PT400' using message = 'invalid_executor', detail = v_where;
    end if;
    if coalesce(v_item ->> 'difficulty', '') !~ '^[0-9]{1,2}$'
       or not exists (select 1 from public.task_difficulty_levels as level
                       where level.level = (v_item ->> 'difficulty')::integer) then
      raise sqlstate 'PT400' using message = 'invalid_difficulty', detail = v_where;
    end if;
    if coalesce(v_item ->> 'rating', '') !~ '^[1-5]$' then
      raise sqlstate 'PT400' using message = 'invalid_rating', detail = v_where;
    end if;
    if coalesce(v_item ->> 'outcome', '') not in ('completed', 'unfulfilled') then
      raise sqlstate 'PT400' using message = 'invalid_outcome', detail = v_where;
    end if;

    if coalesce(v_item ->> 'completed_on', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise sqlstate 'PT400' using message = 'invalid_completed_on', detail = v_where;
    end if;
    begin
      v_date := (v_item ->> 'completed_on')::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise sqlstate 'PT400' using message = 'invalid_completed_on', detail = v_where;
    end;
    if v_date > v_today then
      raise sqlstate 'PT400' using message = 'invalid_completed_on', detail = v_where;
    end if;
    if v_item ->> 'deadline_on' is not null then
      if v_item ->> 'deadline_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise sqlstate 'PT400' using message = 'invalid_deadline', detail = v_where;
      end if;
      begin
        v_date := (v_item ->> 'deadline_on')::date;
      exception when datetime_field_overflow or invalid_datetime_format then
        raise sqlstate 'PT400' using message = 'invalid_deadline', detail = v_where;
      end;
    end if;

    v_text := regexp_replace(coalesce(v_item ->> 'note', ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
    if v_text = '' then
      raise sqlstate 'PT400' using message = 'evaluation_note_required', detail = v_where;
    end if;
    if char_length(v_text) > 1000 then
      raise sqlstate 'PT400' using message = 'note_too_long', detail = v_where;
    end if;
  end loop;

  -- The same sheet row twice in one call: named where it appears again.
  select format('row %s (%s, sheet row %s)', numbered.ordinality,
                numbered.value ->> 'tracker_id', numbered.value ->> 'sheet_row')
    into v_where
    from (select entry.ordinality, entry.value,
                 row_number() over (
                   partition by entry.value ->> 'tracker_id', entry.value ->> 'sheet_row'
                   order by entry.ordinality) as occurrence
            from jsonb_array_elements(p_rows) with ordinality as entry) as numbered
   where numbered.occurrence > 1
   order by numbered.ordinality
   limit 1;
  if found then
    raise sqlstate 'PT400' using message = 'duplicate_row', detail = v_where;
  end if;

  -- 2. The gate: a live activ Moderator, held FOR SHARE so a concurrent
  --    removal of the seat waits for this call.
  perform 1
     from public.profiles as actor
    where actor.id = p_actor
      and actor.status = 'activ'
      and actor.role = 'moderator'
      for share of actor;
  if not found then
    raise exception using errcode = '42501', message = 'legacy_import_forbidden';
  end if;

  -- One import at a time: two runs can never interleave their registry reads
  -- and writes. Released at commit or rollback.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('osubb.legacy_task_import', 0));

  -- 3. Against the loaded rows, each locked FOR SHARE in id order so a
  --    concurrent deactivation or archive waits instead of landing underneath.
  perform 1
     from public.profiles as executor
    where executor.id in (select (entry.value ->> 'executor_id')::uuid
                            from jsonb_array_elements(p_rows) as entry)
    order by executor.id
      for share of executor;
  select format('row %s (%s, sheet row %s)', entry.ordinality, entry.value ->> 'tracker_id', entry.value ->> 'sheet_row')
    into v_where
    from jsonb_array_elements(p_rows) with ordinality as entry
   where not exists (select 1 from public.profiles as executor
                      where executor.id = (entry.value ->> 'executor_id')::uuid
                        and executor.status = 'activ')
   order by entry.ordinality
   limit 1;
  if found then
    raise sqlstate 'PT400' using message = 'invalid_executor', detail = v_where;
  end if;

  perform 1
     from public.groups as origin
    where origin.id in (select (entry.value ->> 'group_id')::bigint
                          from jsonb_array_elements(p_rows) as entry)
    order by origin.id
      for share of origin;
  select format('row %s (%s, sheet row %s)', entry.ordinality, entry.value ->> 'tracker_id', entry.value ->> 'sheet_row')
    into v_where
    from jsonb_array_elements(p_rows) with ordinality as entry
   where not exists (select 1 from public.groups as origin
                      where origin.id = (entry.value ->> 'group_id')::bigint)
   order by entry.ordinality
   limit 1;
  if found then
    raise sqlstate 'PT400' using message = 'invalid_origin', detail = v_where;
  end if;
  select format('row %s (%s, sheet row %s)', entry.ordinality, entry.value ->> 'tracker_id', entry.value ->> 'sheet_row')
    into v_where
    from jsonb_array_elements(p_rows) with ordinality as entry
    join public.groups as origin on origin.id = (entry.value ->> 'group_id')::bigint
   where origin.status <> 'active'
   order by entry.ordinality
   limit 1;
  if found then
    raise sqlstate 'PT409' using message = 'group_archived', detail = v_where;
  end if;

  -- 4 and 5. Row by row, in file order: skip what is registered, write the rest.
  for v_row in
    select entry.value ->> 'tracker_id'             as tracker_id,
           (entry.value ->> 'sheet_row')::integer   as sheet_row,
           nullif(entry.value ->> 'sheet_id', '')   as sheet_id,
           (entry.value ->> 'group_id')::bigint     as group_id,
           (entry.value ->> 'executor_id')::uuid    as executor_id,
           regexp_replace(entry.value ->> 'title', '^[[:space:]]+|[[:space:]]+$', '', 'g') as title,
           nullif(regexp_replace(coalesce(entry.value ->> 'description', ''),
                                 '^[[:space:]]+|[[:space:]]+$', '', 'g'), '') as description,
           (entry.value ->> 'difficulty')::integer  as difficulty,
           (entry.value ->> 'rating')::integer      as rating,
           entry.value ->> 'outcome'                as outcome,
           (entry.value ->> 'completed_on')::date   as completed_on,
           (entry.value ->> 'deadline_on')::date    as deadline_on,
           regexp_replace(entry.value ->> 'note', '^[[:space:]]+|[[:space:]]+$', '', 'g') as note
      from jsonb_array_elements(p_rows) with ordinality as entry
     order by entry.ordinality
  loop
    if exists (select 1 from public.legacy_task_imports as imported
                where imported.tracker_id = v_row.tracker_id
                  and imported.sheet_row = v_row.sheet_row) then
      v_already := v_already + 1;
      continue;
    end if;

    -- ADR-0007's scoring guide, the same expression private.evaluate_task
    -- uses: the level's base points times rating_mult. Never clamped.
    select level.base_points * public.rating_mult(v_row.rating) into v_award
      from public.task_difficulty_levels as level
     where level.level = v_row.difficulty;
    v_imported := v_imported + 1;
    v_points := v_points + v_award;
    if p_dry_run then
      continue;
    end if;

    -- The one instant of a row: noon in Bucharest on its completion day, so
    -- the day is the same in every read on either side of a clock change.
    v_at := (v_row.completed_on::timestamp + interval '12 hours') at time zone 'Europe/Bucharest';
    -- The Work Filter ranges on the deadline; a Task without one would never
    -- be found by date.
    v_deadline := coalesce((v_row.deadline_on::timestamp + interval '12 hours') at time zone 'Europe/Bucharest', v_at);

    insert into public.tasks
      (title, description, deadline, group_id, audience, assignment_mode, kind, status,
       difficulty, rating, created_by, created_at, completed_at, unfulfilled_at)
    values (v_row.title, v_row.description, v_deadline, v_row.group_id, 'local', 'direct', 'task',
            v_row.outcome::public.task_status, v_row.difficulty, v_row.rating, p_actor, v_at,
            case when v_row.outcome = 'completed' then v_at end,
            case when v_row.outcome = 'unfulfilled' then v_at end)
    returning id into v_task_id;

    -- Before the Evaluation: the legacy-source trigger reads this row.
    insert into public.legacy_task_imports (tracker_id, sheet_row, sheet_id, task_id, imported_by)
    values (v_row.tracker_id, v_row.sheet_row, v_row.sheet_id, v_task_id, p_actor);

    insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
    values (v_task_id, v_row.executor_id, p_actor, v_at, v_at,
            case v_row.outcome when 'completed' then 'completed' else 'failed' end)
    returning id into v_assignment;

    insert into public.task_evaluations
      (task_id, assignment_id, source, evaluated_by, outcome, difficulty, rating, points, note, evaluated_at)
    values (v_task_id, v_assignment, 'legacy_migration', null, v_row.outcome,
            v_row.difficulty, v_row.rating, v_award, v_row.note, v_at)
    returning id into v_evaluation;

    -- The trail create_completed_task leaves, with no actor: the task_create
    -- daily cap counts a Member's `created` rows of the last 24 hours, and
    -- thousands of them would lock the Moderator out of creating Tasks.
    insert into public.task_activity
      (task_id, kind, actor_id, assignment_id, from_status, to_status, note, details, occurred_at)
    values
      (v_task_id, 'created', null::uuid, null::bigint, null::public.task_status, 'todo'::public.task_status, null::text,
       jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'direct',
                          'campaign_id', null, 'executor_id', v_row.executor_id,
                          'completed_task', true, 'legacy_import', true), v_at),
      (v_task_id, 'executor_assigned', null, v_assignment, null, null, null,
       jsonb_build_object('via', 'completed_task', 'member_id', v_row.executor_id), v_at),
      (v_task_id, case v_row.outcome when 'completed' then 'evaluated' else 'unfulfilled' end,
       null, v_assignment, 'todo'::public.task_status, v_row.outcome::public.task_status, v_row.note,
       jsonb_build_object('evaluation_id', v_evaluation, 'difficulty', v_row.difficulty,
                          'rating', v_row.rating, 'points', v_award), v_at);

    v_members     := v_members || v_row.executor_id;
    v_deltas      := v_deltas || v_award;
    v_tasks       := v_tasks || v_task_id;
    v_evaluations := v_evaluations || v_evaluation;
    v_instants    := v_instants || v_at;
  end loop;

  -- One statement for the whole call: points_ledger_refresh_promotion_candidates
  -- is a statement-level trigger, so the candidate refresh runs once per call.
  if cardinality(v_members) > 0 then
    insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id, created_at)
    select entry.member_id, entry.delta, 'task', entry.task_id, entry.evaluation_id, entry.created_at
      from unnest(v_members, v_deltas, v_tasks, v_evaluations, v_instants)
           as entry (member_id, delta, task_id, evaluation_id, created_at);
  end if;

  return jsonb_build_object(
    'received', v_received,
    'imported', v_imported,
    'already_imported', v_already,
    'points', v_points,
    'dry_run', p_dry_run);
end;
$function$;

revoke execute on function public.import_legacy_tasks(uuid, jsonb, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.import_legacy_tasks(uuid, jsonb, boolean) to service_role;

comment on function public.import_legacy_tasks(uuid, jsonb, boolean) is
  '#1049 (spec 2026-10-13, ruling R53): the one-time Legacy Import -- up to 200 rows of the legacy Google Sheets Task Tracker per call, each written as a terminal Task with its Assignment, a legacy_migration Evaluation (evaluated_by null), its Task Points ledger row and the three activity rows of create_completed_task, all dated at 12:00 Europe/Bucharest on the completion day; the deadline is the sheet''s day at that hour, else the completion instant. Points are the level''s base points times rating_mult, as in private.evaluate_task; this is the second and last writer of Task Points. Step 1, malformed for everyone, each with the row in DETAIL: PT400 invalid_actor, invalid_rows, too_many_rows, invalid_tracker_id, invalid_sheet_row, invalid_sheet_id, title_required, title_too_short, title_too_long, description_too_long, task_group_required, invalid_origin, invalid_executor, invalid_difficulty, invalid_rating, invalid_outcome, invalid_completed_on (not a date, or after today in Bucharest), invalid_deadline, evaluation_note_required, note_too_long, duplicate_row. Step 2: 42501 legacy_import_forbidden unless p_actor is a live activ Moderator. Step 3: PT400 invalid_executor (not a live activ Member), PT400 invalid_origin (unknown Group), PT409 group_archived. A row whose (tracker_id, sheet_row) is already in public.legacy_task_imports is skipped and counted, so a re-run completes an interrupted import and never doubles it. No Notification, no daily cap, no activity actor; BC, the Moderator and Members below the Group''s Minimum Level are credited like anyone (the Evaluation was made in the sheet). p_dry_run does everything but write. One invalid row fails the whole call. Service role only, like import_member (#991); dropped by #1050 after the verified production run.';

-- ---------------------------------------------------------------------------
-- 4. The totals the import script compares its file with
-- ---------------------------------------------------------------------------
create function public.legacy_task_import_totals()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with imported as (
    select task.group_id, assignment.member_id, evaluation.id as evaluation_id, evaluation.points,
           (evaluation.evaluated_at at time zone 'Europe/Bucharest')::date as completed_on
      from public.legacy_task_imports as registry
      join public.tasks as task on task.id = registry.task_id
      join public.task_evaluations as evaluation
        on evaluation.task_id = task.id
       and evaluation.source = 'legacy_migration'
       and evaluation.reversed_at is null
      join public.task_assignments as assignment on assignment.id = evaluation.assignment_id
  ),
  -- What Personal Scores, Clasament and the Cup actually read: the ledger.
  paid as (
    select entry.delta
      from imported
      join public.points_ledger as entry
        on entry.evaluation_id = imported.evaluation_id
       and entry.reason = 'task'
  )
  select jsonb_build_object(
    'rows',   (select count(*) from imported),
    'points', (select coalesce(sum(points), 0) from imported),
    'ledger_rows',   (select count(*) from paid),
    'ledger_points', (select coalesce(sum(delta), 0) from paid),
    'from', (select min(completed_on) from imported),
    'to',   (select max(completed_on) from imported),
    'groups', coalesce((select jsonb_object_agg(by_group.group_id::text,
                                 jsonb_build_object('rows', by_group.row_count, 'points', by_group.points))
                          from (select group_id, count(*) as row_count, sum(points) as points
                                  from imported group by group_id) as by_group), '{}'::jsonb),
    'members', coalesce((select jsonb_object_agg(by_member.member_id::text,
                                  jsonb_build_object('rows', by_member.row_count, 'points', by_member.points))
                           from (select member_id, count(*) as row_count, sum(points) as points
                                   from imported group by member_id) as by_member), '{}'::jsonb));
$$;

revoke execute on function public.legacy_task_import_totals()
  from public, anon, authenticated, service_role;
grant execute on function public.legacy_task_import_totals() to service_role;

comment on function public.legacy_task_import_totals() is
  '#1049: what the Legacy Import has written and still stands -- rows and Task Points of the Evaluations in total, per Group and per Member; the `task` ledger rows those Evaluations paid and their sum; and the first and last completion day in Europe/Bucharest -- for scripts/import-legacy-tasks.mjs to compare with its file after a run. Counts an imported Task only while it exists with an unreversed legacy_migration Evaluation. Service role only; dropped by #1050 with the command.';

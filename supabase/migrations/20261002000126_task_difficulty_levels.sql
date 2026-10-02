-- #985: Task Difficulty has ten levels, each with its own base points
--
-- OSUBB's rating guide (Alex, 2026-10-02) adds five Difficulty levels above
-- the five stars: three medals and two text levels, each worth a fixed number
-- of base points. Task Points stay base points x public.rating_mult(Rating)
-- -- a Coordonator Task rated 5 earns 20 x 3 = 60, rated 1 loses 20.
--
--   level  kind   label        glyph        base points
--   1..5   star   1 stea..5 stele  stars    1..5 (exactly today's Difficulty)
--   6      medal  Bronz        bronze medal 6
--   7      medal  Argint       silver medal 7
--   8      medal  Aur          gold medal   8
--   9      text   Responsabil  (none)       15
--   10     text   Coordonator  (none)       20
--
-- What changes, and why each piece is here:
--   1. public.task_difficulty_levels holds the ten levels. Reference data
--      lives in migrations (house rule 6); members read it (the guide and the
--      pickers), nobody writes it. It broadcasts like difficulty_guide does
--      (ADR-0011).
--   2. tasks_difficulty_ck and task_evaluations_difficulty_ck widen to 1..10.
--      Every stored value is 1..5, so both validate as they are added.
--   3. private.evaluate_task -- still the ONLY place points are computed and
--      written -- reads base_points from the table: a Difficulty with no row
--      is PT400 invalid_difficulty. For levels 1..5 base points equal the
--      level, so every award there is exactly what it was.
--   4. The four commands that hoist the Difficulty check before their gate
--      (complete_task_review, mark_task_unfulfilled,
--      approve_completed_work_request, create_completed_task) accept 1..10.
--      Each is rebuilt from main's latest body with only that range changed
--      -- plus, in approve_completed_work_request, its notification now reads
--      the points evaluate_task wrote instead of recomputing
--      difficulty x multiplier (which would be wrong from level 6 up).
--   5. Awards now reach -20..60, so the Romanian numeral takes "de puncte"
--      from 20 upward in both notifications.
--
-- public.difficulty_guide stays: the app still reads its star notes
-- (useEvaluationScale). It is dropped once the frontend (#986) reads this
-- table instead.

-- ==================== 1. The reference table ====================
create table public.task_difficulty_levels (
  level       smallint primary key
              constraint task_difficulty_levels_level_ck check (level between 1 and 10),
  kind        text not null
              constraint task_difficulty_levels_kind_ck check (kind in ('star', 'medal', 'text')),
  label       text not null
              constraint task_difficulty_levels_label_ck check (
                label ~ '[^[:space:]]' and char_length(label) <= 40),
  glyph       text
              constraint task_difficulty_levels_glyph_ck check (char_length(glyph) <= 16),
  base_points smallint not null
              constraint task_difficulty_levels_base_points_ck check (base_points > 0),
  -- A text level is shown by its label alone; every other level has a glyph.
  constraint task_difficulty_levels_glyph_shape_ck check ((kind = 'text') = (glyph is null))
);

comment on table public.task_difficulty_levels is
  'The ten Task Difficulty levels (#985, ADR-0007 amended 2026-10-02): 1..5 stars, 6..8 the Bronz/Argint/Aur medals, 9 Responsabil and 10 Coordonator as text. base_points x public.rating_mult(Rating) is the award private.evaluate_task writes. Reference data: changed only by migration.';

insert into public.task_difficulty_levels (level, kind, label, glyph, base_points) values
  (1,  'star',  '1 stea',      '⭐',         1),
  (2,  'star',  '2 stele',     '⭐⭐',       2),
  (3,  'star',  '3 stele',     '⭐⭐⭐',     3),
  (4,  'star',  '4 stele',     '⭐⭐⭐⭐',   4),
  (5,  'star',  '5 stele',     '⭐⭐⭐⭐⭐', 5),
  (6,  'medal', 'Bronz',       '🥉',         6),
  (7,  'medal', 'Argint',      '🥈',         7),
  (8,  'medal', 'Aur',         '🥇',         8),
  (9,  'text',  'Responsabil', null,         15),
  (10, 'text',  'Coordonator', null,         20);

alter table public.task_difficulty_levels enable row level security;

-- Members read the guide; claimless callers read nothing (house rule 12).
create policy task_difficulty_levels_read on public.task_difficulty_levels
  for select to authenticated using (public.auth_is_member());

revoke all on table public.task_difficulty_levels from public, anon, authenticated;
grant select on table public.task_difficulty_levels to authenticated;

create trigger broadcast_change after insert or update or delete on public.task_difficulty_levels
  for each statement execute function private.broadcast_change();

-- ==================== 2. The stored range ====================
alter table public.tasks drop constraint tasks_difficulty_ck;
alter table public.tasks
  add constraint tasks_difficulty_ck check (difficulty between 1 and 10);

alter table public.task_evaluations drop constraint task_evaluations_difficulty_ck;
alter table public.task_evaluations
  add constraint task_evaluations_difficulty_ck check (difficulty between 1 and 10);

-- ==================== 3. The shared Evaluation core ====================
-- Rebuilt from 20260915075256_evaluate_task_and_complete_review.sql (its only
-- definition). Changed: the Difficulty check reads the table, v_points uses
-- base_points, and the Executor's notification grows the "de puncte" form.
create or replace function private.evaluate_task(
  p_task_id    bigint,
  p_outcome    text,
  p_difficulty integer,
  p_rating     integer,
  p_note       text,
  p_actor      uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task           public.tasks%rowtype;
  v_note           text;
  v_base_points    integer;
  v_assignment_id  bigint;
  v_executor_id    uuid;
  v_points         integer;
  v_evaluation_id  bigint;
  v_closed         uuid[];
  v_parent_title   text;
  v_subtask_count  integer;
  v_terminal_count integer;
begin
  -- Input, all four checks repeated from the calling command so that every
  -- future caller (#337/#338/#344) inherits them without restating them.
  if p_outcome is null or p_outcome not in ('completed', 'unfulfilled') then
    raise sqlstate 'PT400' using message = 'invalid_outcome';
  end if;
  -- #985: a Difficulty is valid exactly when it names a level, and the level
  -- carries the base points the award is computed from.
  select level.base_points into v_base_points
    from public.task_difficulty_levels as level
   where level.level = p_difficulty;
  if v_base_points is null then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'evaluation_note_required';
  end if;
  v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');

  -- The caller already holds this row FOR UPDATE; this read only fetches it.
  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;

  -- Defensive state precondition, keyed on exactly what
  -- task_evaluations_one_open_per_task_uidx keys on (task_id, where
  -- reversed_at is null and source = 'command'). Every caller is expected to
  -- have established its own legal source status first -- complete_task_review
  -- requires in_review -- but #337/#338/#344 each reach this core by a
  -- different route, and one that forgot would otherwise trip that unique
  -- index and surface a raw 23505 unique_violation to the client instead of a
  -- pinned reason string. A reversed Evaluation does not block a new one:
  -- that is exactly how #338's reopen -> re-evaluate path works.
  if exists (select 1 from public.task_evaluations as evaluation
              where evaluation.task_id = p_task_id
                and evaluation.source = 'command'
                and evaluation.reversed_at is null) then
    raise sqlstate 'PT409' using message = 'task_already_evaluated';
  end if;

  -- The Assignment the points are credited to. FOR UPDATE because this is
  -- the row the Evaluation, the ledger entry and end_task_assignment all
  -- hang off; a caller that has not already serialized on the tasks row
  -- (none today, but the core is shared) still cannot have two Evaluations
  -- race onto one Assignment.
  select assignment.id, assignment.member_id
    into v_assignment_id, v_executor_id
    from public.task_assignments as assignment
   where assignment.task_id = p_task_id and assignment.ended_at is null
   for update;
  if v_assignment_id is null then
    raise sqlstate 'PT409' using message = 'task_has_no_executor';
  end if;

  -- ADR-0007's scoring guide, in the one place it exists: the level's base
  -- points times rating_mult (1 -> -1, 2 -> 0, 3 -> 1, 4 -> 2, 5 -> 3), so a
  -- zero or negative award is legal and is written exactly as computed --
  -- never clamped.
  v_points := v_base_points * public.rating_mult(p_rating);

  insert into public.task_evaluations
    (task_id, assignment_id, source, evaluated_by, outcome,
     difficulty, rating, points, note)
  values (p_task_id, v_assignment_id, 'command', p_actor, p_outcome,
          p_difficulty, p_rating, v_points, v_note)
  returning id into v_evaluation_id;

  insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id)
  values (v_executor_id, v_points, 'task', p_task_id, v_evaluation_id);

  -- Before the status write, not after: see the #336 migration header.
  -- p_decided_by null marks an automatic close (task_candidates_decision_shape_ck).
  v_closed := private.close_task_queue(p_task_id, null);

  update public.tasks
     set difficulty     = p_difficulty,
         rating         = p_rating,
         status         = p_outcome::public.task_status,
         completed_at   = case when p_outcome = 'completed' then now() end,
         unfulfilled_at = case when p_outcome = 'unfulfilled' then now() end
   where id = p_task_id;

  -- now() in both places, so ended_at = completed_at exactly (conventions Sec7).
  perform private.end_task_assignment(v_assignment_id,
    case p_outcome when 'completed' then 'completed' else 'failed' end, null);

  perform private.log_task_activity(p_task_id,
    case p_outcome when 'completed' then 'evaluated' else 'unfulfilled' end,
    p_actor, v_assignment_id, v_task.status, p_outcome::public.task_status, v_note,
    jsonb_build_object('evaluation_id', v_evaluation_id,
                       'difficulty', p_difficulty,
                       'rating', p_rating,
                       'points', v_points));

  -- A direct Task closes no queue, so v_closed is '{}' and notify writes
  -- nothing; on a public Task these are the Candidates who just lost the
  -- chance to be selected.
  perform private.notify(v_closed, 'task'::public.noti_kind,
    'Coadă închisă: ' || v_task.title,
    'Nu mai poți fi selectat pentru acest task.',
    p_task_id, null, p_actor);

  -- Romanian numeral agreement on the award itself, which #985 lifts to
  -- -20..60: singular at 1, bare plural for 0 and 2-19, and `de puncte`
  -- from 20 upward (a Coordonator Task rated 1 is "-20 de puncte"). The
  -- hundreds rule is written in full so no future range needs this rewritten.
  perform private.notify(array[v_executor_id], 'task'::public.noti_kind,
    case p_outcome when 'completed' then 'Task evaluat: ' else 'Task nerealizat: ' end
      || v_task.title,
    case when abs(v_points) = 1 then v_points || ' punct'
         when abs(v_points) = 0 or abs(v_points) % 100 between 1 and 19 then v_points || ' puncte'
         else v_points || ' de puncte' end
      || ' (dificultate ' || p_difficulty || ', calificativ ' || p_rating || ').',
    p_task_id, null, p_actor);

  -- Umbrella rollup. The counts are taken AFTER the status update, so this
  -- Subtask is already inside terminal_count.
  if v_task.parent_task_id is not null then
    select parent.title into v_parent_title
      from public.tasks as parent where parent.id = v_task.parent_task_id;

    select count(*),
           count(*) filter (where sub.status in ('completed', 'unfulfilled', 'cancelled'))
      into v_subtask_count, v_terminal_count
      from public.tasks as sub
     where sub.parent_task_id = v_task.parent_task_id;

    perform private.log_task_activity(v_task.parent_task_id, 'subtask_completed',
      p_actor, null, null, null, null,
      jsonb_build_object('subtask_id', p_task_id,
                         'outcome', p_outcome,
                         'terminal_count', v_terminal_count,
                         'subtask_count', v_subtask_count));

    -- Romanian numeral agreement, the same rule the wave applied to the
    -- queue-count body: singular at 1, bare plural for 2-19, `de` + plural
    -- from 20 up. The noun agrees with the total (the numeral it follows).
    perform private.notify(
      array(select private.task_managers(v_task.parent_task_id, p_actor)),
      'task'::public.noti_kind,
      'Subtask încheiat: ' || v_parent_title,
      case
        when v_subtask_count = 1 then v_terminal_count || ' din 1 subtask încheiat.'
        when v_subtask_count < 20 then
          v_terminal_count || ' din ' || v_subtask_count || ' subtaskuri încheiate.'
        else v_terminal_count || ' din ' || v_subtask_count || ' de subtaskuri încheiate.'
      end,
      v_task.parent_task_id,
      'task:' || v_task.parent_task_id::text || ':subtasks',
      p_actor);
  end if;

  return v_evaluation_id;
end;
$$;

-- ==================== 4. The commands that hoist the Difficulty check ====================
-- complete_task_review_impl and mark_task_unfulfilled_impl: rebuilt from
-- 20260923231125_constraints_kit.sql; approve_completed_work_request_impl and
-- create_completed_task_impl: from 20260929180000_completed_work_tasks.sql.
-- Same signatures, so their grants and the public wrappers stand as they are.

CREATE OR REPLACE FUNCTION private.complete_task_review_impl(p_task_id bigint, p_difficulty integer, p_rating integer, p_note text)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_task  public.tasks%rowtype;
begin
  -- 1. Malformed for everyone: an Evaluation without a note can never be
  --    written (task_evaluations_note_ck), so it is rejected before the gate
  --    -- the #335 precedent for the other evaluator-gated command.
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'evaluation_note_required';
  end if;
  -- #673 (R8): measured as private.evaluate_task stores it (trimmed).
  perform private.require_text_length('note',
    regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 1000);
  --    Difficulty and Rating join it here (whole-wave review, finding 5): a
  --    value outside task_evaluations' 1..10 CHECK could never succeed for ANY
  --    caller, so it is malformed for everyone and is answered before the
  --    gate -- which is what private.approve_completed_work_request_impl, the
  --    third caller of private.evaluate_task, already did.
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 10 then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: the Task's evaluator, never merely its manager.
  perform private.require_task_evaluator(p_task_id);
  -- 5. Input validation: nothing is left here -- both numeric inputs are
  --    range-checked at step 1 above, and the note with them.
  -- 6. State preconditions. Kind first: an Umbrella is never in_review
  --    either, so checking status first would answer task_not_in_review and
  --    hide the real reason an Umbrella can never be reviewed at all.
  if v_task.kind <> 'task' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if v_task.status <> 'in_review' then
    raise sqlstate 'PT409' using message = 'task_not_in_review';
  end if;
  -- 7. Mutate through the shared core, then re-read.
  perform private.evaluate_task(p_task_id, 'completed', p_difficulty, p_rating, p_note, v_actor);
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$function$;

CREATE OR REPLACE FUNCTION private.mark_task_unfulfilled_impl(p_task_id bigint, p_difficulty integer, p_rating integer, p_note text)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_task  public.tasks%rowtype;
begin
  -- 1. Malformed for everyone: an Evaluation without a note can never be
  --    written (task_evaluations_note_ck), so it is rejected before the
  --    gate -- the #336 precedent for the other evaluator-gated command.
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'evaluation_note_required';
  end if;
  -- #673 (R8): measured as private.evaluate_task stores it (trimmed).
  perform private.require_text_length('note',
    regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 1000);
  --    Difficulty and Rating join it here (whole-wave review, finding 5): a
  --    value outside task_evaluations' 1..10 CHECK could never succeed for ANY
  --    caller, so it is malformed for everyone and is answered before the
  --    gate -- which is what private.approve_completed_work_request_impl, the
  --    third caller of private.evaluate_task, already did.
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 10 then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: the Task's evaluator, never merely its manager.
  perform private.require_task_evaluator(p_task_id);
  -- 5. Input validation: nothing is left here -- both numeric inputs are
  --    range-checked at step 1 above, and the note with them.
  -- 6. State preconditions, in the brief's pinned order.
  if v_task.kind <> 'task' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if v_task.status not in ('todo', 'in_progress', 'in_review') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;
  if v_task.deadline is null or v_task.deadline >= now() then
    raise sqlstate 'PT409' using message = 'task_not_overdue';
  end if;
  if not exists (
    select 1 from public.task_assignments as assignment
     where assignment.task_id = p_task_id and assignment.ended_at is null
  ) then
    raise sqlstate 'PT409' using message = 'task_has_no_executor';
  end if;
  -- 7. Mutate through the shared core, then re-read.
  perform private.evaluate_task(p_task_id, 'unfulfilled', p_difficulty, p_rating, p_note, v_actor);
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$function$;

create or replace function private.approve_completed_work_request_impl(
  p_request_id  bigint,
  p_difficulty  integer,
  p_rating      integer,
  p_note        text,
  p_title       text,
  p_description text,
  p_group_id    bigint,
  p_link_label  text,
  p_link_url    text,
  p_campaign_id bigint)
returns public.completed_work_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_note        text;
  v_title       text;
  v_description text;
  v_link_label  text;
  v_link_url    text;
  v_group       bigint;
  v_request     public.completed_work_requests%rowtype;
  v_task        public.tasks%rowtype;
  v_points      integer;
  v_constraint  text;
  v_evaluation  bigint;
begin
  -- 1. Malformed for every caller, before the gate.
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 10 then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'evaluation_note_required';
  end if;
  v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- #673 (R8): measured as stored (trimmed).
  perform private.require_text_length('note', v_note, null, 1000);
  -- #915: the Task's shape, when the decider changes it. Null keeps the
  -- Request's value; a title, once given, cannot be blank.
  if p_title is not null then
    if p_title !~ '[^[:space:]]' then
      raise sqlstate 'PT400' using message = 'title_required';
    end if;
    v_title := regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    perform private.require_text_length('title', v_title, 3, 120);
  end if;
  if p_description is not null then
    v_description := nullif(regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
    perform private.require_text_length('description', v_description, null, 2000);
  end if;
  v_link_label := nullif(regexp_replace(coalesce(p_link_label, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_link_url := nullif(regexp_replace(coalesce(p_link_url, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_attached_link(v_link_label, v_link_url);
  -- 2. The actor.
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'request_command_forbidden';
  end if;
  -- 3. The Request, locked; hidden and missing are one answer.
  select * into v_request from public.completed_work_requests
   where id = p_request_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  if v_request.requester_id is distinct from v_actor
     and not coalesce(private.can_manage_group_work(v_request.group_id), false) then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  -- 4. Authority over the Request as filed, then its state.
  perform private.require_request_decider(p_request_id);
  if v_request.status <> 'pending' then
    raise sqlstate 'PT409' using message = 'request_not_pending';
  end if;
  -- 5. #915: another Group is judged by the rule create_completed_task uses.
  v_group := coalesce(p_group_id, v_request.group_id);
  if v_group is distinct from v_request.group_id then
    perform private.require_completed_work_group(v_group, v_request.requester_id,
      'request_decide_forbidden', 'request_decide_forbidden', false);
  end if;
  -- 6. Mutate: the Task as shaped, then the shared cores.
  begin
    insert into public.tasks
      (title, description, deadline, group_id, campaign_id,
       audience, assignment_mode, status, created_by, link_label, link_url)
    values (coalesce(v_title, left(v_request.description, 120)),
            case when p_description is null then v_request.description else v_description end,
            now(), v_group, p_campaign_id,
            'local', 'direct', 'todo', v_actor, v_link_label, v_link_url)
    returning * into v_task;
  exception
    when foreign_key_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'tasks_campaign_id_fkey' then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
    when check_violation then
      if sqlerrm in ('task_campaign_origin_mismatch', 'task_campaign_inactive') then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
  end;

  perform private.log_task_activity(v_task.id, 'created', v_actor, null, null, 'todo', null,
    jsonb_build_object('from_request_id', p_request_id));
  perform private.open_task_assignment(v_task.id, v_request.requester_id, v_actor, 'request_approval');
  v_evaluation := private.evaluate_task(v_task.id, 'completed', p_difficulty, p_rating, v_note, v_actor);

  update public.completed_work_requests
     set status        = 'approved',
         decided_by    = v_actor,
         decided_at    = now(),
         decision_note = v_note,
         task_id       = v_task.id
   where id = p_request_id;
  -- #985: the award as private.evaluate_task wrote it, never recomputed here.
  select evaluation.points into v_points
    from public.task_evaluations as evaluation where evaluation.id = v_evaluation;
  perform private.notify(array[v_request.requester_id], 'task'::public.noti_kind,
    'Cerere aprobată: ' || left(v_request.description, 60),
    case when abs(v_points) = 1 then v_points || ' punct'
         when abs(v_points) = 0 or abs(v_points) % 100 between 1 and 19 then v_points || ' puncte'
         else v_points || ' de puncte' end
      || ' (dificultate ' || p_difficulty || ', calificativ ' || p_rating || ').',
    v_task.id, null, v_actor);

  select * into v_request from public.completed_work_requests where id = p_request_id;
  return v_request;
end;
$$;

create or replace function private.create_completed_task_impl(
  p_executor_id uuid,
  p_group_id    bigint,
  p_title       text,
  p_description text,
  p_link_label  text,
  p_link_url    text,
  p_campaign_id bigint,
  p_difficulty  integer,
  p_rating      integer,
  p_note        text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_note        text;
  v_title       text;
  v_description text;
  v_link_label  text;
  v_link_url    text;
  v_task        public.tasks%rowtype;
  v_constraint  text;
begin
  -- 1. Malformed for every caller, before the gate: the Evaluation's three
  --    inputs (as every evaluating command hoists them) and the Task's text.
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 10 then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'evaluation_note_required';
  end if;
  v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  perform private.require_text_length('note', v_note, null, 1000);
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'title_required';
  end if;
  v_title := regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  perform private.require_text_length('title', v_title, 3, 120);
  v_description := nullif(regexp_replace(coalesce(p_description, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_text_length('description', v_description, null, 2000);
  v_link_label := nullif(regexp_replace(coalesce(p_link_label, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_link_url := nullif(regexp_replace(coalesce(p_link_url, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_attached_link(v_link_label, v_link_url);
  if p_group_id is null then
    raise sqlstate 'PT400' using message = 'task_group_required';
  end if;
  if p_executor_id is null then
    raise sqlstate 'PT400' using message = 'invalid_executor';
  end if;
  -- 2. The actor: a live activ Member with organization claims.
  if v_actor is null or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'task_command_forbidden';
  end if;
  -- 3. Authority and eligibility, under the share locks: create_task's
  --    manage gate, then the evaluator rule for this Executor.
  perform private.require_completed_work_group(p_group_id, p_executor_id,
    'task_manage_forbidden', 'task_evaluate_forbidden', true);
  -- 4. create_task's daily cap: this Task's 'created' row counts toward it.
  perform private.require_daily_cap('task_create', v_actor);
  -- 5. Mutate: the Task, then the Assignment and the Evaluation through the
  --    shared cores -- evaluate_task writes the points, nothing here does.
  begin
    insert into public.tasks
      (title, description, deadline, group_id, campaign_id,
       audience, assignment_mode, kind, status, created_by, link_label, link_url)
    values (v_title, v_description, now(), p_group_id, p_campaign_id,
            'local', 'direct', 'task', 'todo', v_actor, v_link_label, v_link_url)
    returning * into v_task;
  exception
    when foreign_key_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'tasks_campaign_id_fkey' then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
    when check_violation then
      if sqlerrm in ('task_campaign_origin_mismatch', 'task_campaign_inactive') then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
  end;
  perform private.log_task_activity(v_task.id, 'created', v_actor, null, null, 'todo', null,
    jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'direct',
                       'campaign_id', p_campaign_id, 'executor_id', p_executor_id,
                       'completed_task', true));
  perform private.open_task_assignment(v_task.id, p_executor_id, v_actor, 'completed_task');
  perform private.evaluate_task(v_task.id, 'completed', p_difficulty, p_rating, v_note, v_actor);
  select * into v_task from public.tasks where id = v_task.id;
  return v_task;
end;
$$;

-- ==================== 5. The documented range ====================
-- Each comment is main's latest text with its Difficulty range corrected.
-- Built from obj_description so nothing else in the text drifts, and each
-- replacement must find its phrase -- a comment that no longer says it fails
-- the migration instead of silently keeping "1..5".
do $$
declare
  v_fix record;
  v_old text;
  v_new text;
begin
  for v_fix in
    select * from (values
      ('private.evaluate_task(bigint, text, integer, integer, text, uuid)',
       'Difficulty x public.rating_mult(Rating)',
       'the Difficulty level''s base_points (public.task_difficulty_levels, #985) x public.rating_mult(Rating)'),
      ('private.complete_task_review_impl(bigint, integer, integer, text)',
       'a Difficulty or Rating outside 1..5 (null included)',
       'a Difficulty outside 1..10 or a Rating outside 1..5 (null included)'),
      ('private.mark_task_unfulfilled_impl(bigint, integer, integer, text)',
       'a Difficulty or Rating outside 1..5 (null included)',
       'a Difficulty outside 1..10 or a Rating outside 1..5 (null included)'),
      ('public.complete_task_review(bigint, integer, integer, text)',
       'Difficulty and Rating are 1..5',
       'Difficulty is 1..10 (its base points x the Rating multiplier) and Rating 1..5'),
      ('public.mark_task_unfulfilled(bigint, integer, integer, text)',
       'Difficulty and Rating are 1..5',
       'Difficulty is 1..10 (its base points x the Rating multiplier) and Rating 1..5'),
      ('public.approve_completed_work_request(bigint, integer, integer, text, text, text, bigint, text, text, bigint)',
       'Difficulty and Rating are 1..5',
       'Difficulty is 1..10 (its base points x the Rating multiplier) and Rating 1..5')
    ) as fix (signature, old_phrase, new_phrase)
  loop
    v_old := obj_description(v_fix.signature::regprocedure, 'pg_proc');
    if v_old is null or strpos(v_old, v_fix.old_phrase) = 0 then
      raise exception '#985: the comment on % no longer says "%"', v_fix.signature, v_fix.old_phrase;
    end if;
    v_new := replace(v_old, v_fix.old_phrase, v_fix.new_phrase);
    execute format('comment on function %s is %L', v_fix.signature, v_new);
  end loop;
end;
$$;

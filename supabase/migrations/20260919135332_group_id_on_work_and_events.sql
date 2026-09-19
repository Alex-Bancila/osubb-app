-- #519: group_id on tasks, events, campaigns and completed_work_requests -- backfilled from the
-- legacy Origin through groups.legacy_*, kept consistent both ways by trigger (ADR-0009 Wave 2).
-- Legacy columns stay the write master; the two-way trigger lets the Wave 2 commands write
-- group_id while every older writer (seed, smoke script, the 21 commands until #522) keeps
-- writing dept_id/team_id/project_id.
--
-- Decision recorded here: the old campaign unique index (department_id, lower(name)) is
-- dropped, not kept, alongside (group_id, lower(name)). Keeping both would mean two unique
-- checks per write and two constraint names for create_campaign_impl's/update_campaign_impl's
-- unique_violation handler to recognise -- for every Department Campaign, (department_id,
-- lower(name)) is implied by (group_id, lower(name)) because the trigger below makes
-- department_id a function of group_id. The two impl functions are re-issued in this same
-- migration (create or replace, one constraint name changed) so a duplicate name never
-- surfaces as a raw 23505 between this migration and Wave 2's later work.

-- ==================== 1. The resolver ====================

create function private.group_id_for_legacy_origin(
  p_dept_id text, p_team_id text, p_project_id bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  -- Most specific first: an Event carries team_id AND its parent dept_id together.
  select grp.id
    from public.groups as grp
   where case
           when p_project_id is not null then grp.legacy_project_id = p_project_id
           when p_team_id    is not null then grp.legacy_team_id    = p_team_id
           when p_dept_id    is not null then grp.legacy_dept_id    = p_dept_id
           else false
         end;
$$;
comment on function private.group_id_for_legacy_origin(text, text, bigint) is
  'The Group that masters a legacy Origin (project, else team, else department). Null when nothing matches. Wave 2 bridge; dropped in Wave 3 (#519).';
revoke execute on function private.group_id_for_legacy_origin(text, text, bigint)
  from public, anon, authenticated, service_role;

-- ==================== 2. Columns, indexes, Campaign changes, Event constraints ====================

drop view public.tasks_with_overdue;

alter table public.tasks                   add column group_id bigint references public.groups (id);
alter table public.events                  add column group_id bigint references public.groups (id);
alter table public.campaigns               add column group_id bigint references public.groups (id);
alter table public.completed_work_requests add column group_id bigint references public.groups (id);

create index tasks_group_idx                   on public.tasks (group_id);
create index events_group_idx                  on public.events (group_id);
create index completed_work_requests_group_idx on public.completed_work_requests (group_id);

-- campaigns gets no standalone group_id index: campaigns_group_name_uidx below is a
-- unique index on (group_id, lower(name)), whose leading column already serves every
-- plain group_id lookup -- a separate campaigns_group_idx would be a redundant prefix.
alter table public.campaigns alter column department_id drop not null;
drop index public.campaigns_department_name_uidx;
create unique index campaigns_group_name_uidx on public.campaigns (group_id, lower(name));

-- events: an Independent Team has no Department; scope stays until Wave 3 and is derived
-- from the Group by the trigger below.
alter table public.events drop constraint events_scope_fields_ck;
alter table public.events add constraint events_scope_fields_ck check (
     (scope = 'org'     and dept_id is null     and team_id is null     and project_id is null)
  or (scope = 'dept'    and dept_id is not null and team_id is null     and project_id is null)
  or (scope = 'team'    and team_id is not null and project_id is null)
  or (scope = 'project' and dept_id is null     and team_id is null     and project_id is not null)
);

-- Level 4 is retired (ADR-0009 Ranks). Existing rows move UP to 5, never down: a gate that
-- meant "Responsible+" must not silently open to Voluntar cu Drept de Vot.
update public.events set min_level = 5 where min_level = 4;
alter table public.events drop constraint events_min_level_ck;
alter table public.events add constraint events_min_level_ck check (min_level in (0, 3, 5, 6));

-- ==================== 3. Backfill (plain updates, before the triggers exist) ====================

update public.tasks set group_id = private.group_id_for_legacy_origin(dept_id, team_id, project_id) where group_id is null;
update public.events
   set group_id = case when scope = 'org'
                       then (select grp.id from public.groups as grp where grp.legacy_dept_id = 'org')
                       else private.group_id_for_legacy_origin(
                              case when scope = 'dept' then dept_id end, team_id, project_id) end
 where group_id is null;
update public.campaigns set group_id = private.group_id_for_legacy_origin(department_id, null, null) where group_id is null;
update public.completed_work_requests set group_id = private.group_id_for_legacy_origin(dept_id, team_id, project_id) where group_id is null;

do $$
declare v_ids text;
begin
  select string_agg(format('%s:%s', tbl, id), ', ') into v_ids from (
    select 'tasks' as tbl, id from public.tasks where group_id is null
    union all select 'events', id from public.events where group_id is null
    union all select 'campaigns', id from public.campaigns where group_id is null
    union all select 'completed_work_requests', id from public.completed_work_requests where group_id is null
  ) as unmapped;
  if v_ids is not null then
    raise exception 'group_id backfill: rows whose Origin has no Group (run private.sync_groups_from_legacy() first) -- unmapped row IDs: %', v_ids;
  end if;
end $$;

alter table public.tasks                   alter column group_id set not null;
alter table public.events                  alter column group_id set not null;
alter table public.campaigns               alter column group_id set not null;
alter table public.completed_work_requests alter column group_id set not null;

comment on column public.tasks.group_id is
  'The Group that masters this Task''s Origin (ADR-0009 Wave 2 bridge). Legacy dept_id/team_id/project_id stay the write master until Wave 3 drops them; private.sync_task_group_origin keeps both sides consistent.';
comment on column public.events.group_id is
  'The Group that masters this Event''s Origin (ADR-0009 Wave 2 bridge). Legacy scope/dept_id/team_id/project_id stay the write master until Wave 3 drops them; private.sync_event_group_origin keeps both sides consistent.';
comment on column public.campaigns.group_id is
  'The Group that masters this Campaign''s Origin (ADR-0009 Wave 2 bridge). Legacy department_id stays the write master until Wave 3 drops it; private.sync_campaign_group_origin keeps both sides consistent.';
comment on column public.completed_work_requests.group_id is
  'The Group that masters this Request''s Origin (ADR-0009 Wave 2 bridge). Legacy dept_id/team_id/project_id stay the write master until Wave 3 drops them; private.sync_request_group_origin keeps both sides consistent.';

-- ==================== 4. The four two-way trigger functions ====================

create function private.sync_task_group_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy_changed boolean;
  v_group_changed  boolean;
  v_from_legacy    bigint;
  v_grp            public.groups%rowtype;
begin
  v_legacy_changed := tg_op = 'INSERT'
    or new.dept_id    is distinct from old.dept_id
    or new.team_id    is distinct from old.team_id
    or new.project_id is distinct from old.project_id;
  v_group_changed  := tg_op = 'INSERT' or new.group_id is distinct from old.group_id;
  v_from_legacy    := private.group_id_for_legacy_origin(new.dept_id, new.team_id, new.project_id);

  if (tg_op = 'INSERT' and new.group_id is not null
      and num_nonnulls(new.dept_id, new.team_id, new.project_id) = 0)
     or (tg_op = 'UPDATE' and v_group_changed and not v_legacy_changed) then
    -- Group side written: derive the legacy triple.
    select * into v_grp from public.groups where id = new.group_id;
    if not found then
      return new;                                   -- tasks_group_id_fkey answers
    end if;
    if num_nonnulls(v_grp.legacy_dept_id, v_grp.legacy_team_id, v_grp.legacy_project_id) = 0 then
      raise exception using errcode = '23514', message = 'task_group_origin_unmapped';
    end if;
    new.dept_id    := v_grp.legacy_dept_id;
    new.team_id    := v_grp.legacy_team_id;
    new.project_id := v_grp.legacy_project_id;
  elsif new.group_id is null
     or (tg_op = 'UPDATE' and v_legacy_changed and not v_group_changed) then
    -- Legacy side written (every pre-Wave-2 writer): derive the Group.
    if v_from_legacy is null then
      raise exception using errcode = '23514', message = 'task_group_required';
    end if;
    new.group_id := v_from_legacy;
  else
    -- Both sides were given (or changed) together in the same statement: verify the
    -- NAMED Group's own legacy_* columns against the legacy triple directly, rather than
    -- resolving the legacy side backwards and comparing ids. Review round 2, Defect B:
    -- the old `v_from_legacy is distinct from new.group_id` shape compared two
    -- *resolved* ids, which is blind to a Group whose own legacy_* columns disagree with
    -- the legacy triple in a way the resolver's most-specific-first precedence papers
    -- over (e.g. a Task naming both a real dept_id and a real, unrelated project_id: the
    -- resolver matches on project_id and never notices dept_id at all). Comparing
    -- against the Group's own columns catches that regardless of which field the
    -- resolver would have preferred.
    select * into v_grp from public.groups where id = new.group_id;
    if found and (new.dept_id is distinct from v_grp.legacy_dept_id
               or new.team_id is distinct from v_grp.legacy_team_id
               or new.project_id is distinct from v_grp.legacy_project_id) then
      raise exception using errcode = '23514', message = 'task_group_origin_mismatch';
    end if;
  end if;
  return new;
end;
$$;
comment on function private.sync_task_group_origin() is
  'Keeps tasks.group_id and the legacy Origin triple consistent both ways (ADR-0009 Wave 2): a legacy write derives group_id, a Group write derives dept_id/team_id/project_id, and a row that sets both together is verified against the Group''s own legacy_dept_id/legacy_team_id/legacy_project_id -- not by resolving the legacy triple backwards and comparing ids -- and refused on any disagreement (23514 task_group_origin_mismatch, review round 2 Defect B). task_group_required: the legacy side names no Group; task_group_origin_unmapped: the Group has no legacy master (only reachable once Wave 3 creates native Groups).';

create trigger tasks_sync_group_origin
before insert or update of group_id, dept_id, team_id, project_id on public.tasks
for each row execute function private.sync_task_group_origin();

create function private.sync_request_group_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy_changed boolean;
  v_group_changed  boolean;
  v_from_legacy    bigint;
  v_grp            public.groups%rowtype;
begin
  v_legacy_changed := tg_op = 'INSERT'
    or new.dept_id    is distinct from old.dept_id
    or new.team_id    is distinct from old.team_id
    or new.project_id is distinct from old.project_id;
  v_group_changed  := tg_op = 'INSERT' or new.group_id is distinct from old.group_id;
  v_from_legacy    := private.group_id_for_legacy_origin(new.dept_id, new.team_id, new.project_id);

  if (tg_op = 'INSERT' and new.group_id is not null
      and num_nonnulls(new.dept_id, new.team_id, new.project_id) = 0)
     or (tg_op = 'UPDATE' and v_group_changed and not v_legacy_changed) then
    -- Group side written: derive the legacy triple.
    select * into v_grp from public.groups where id = new.group_id;
    if not found then
      return new;                                   -- completed_work_requests_group_id_fkey answers
    end if;
    if num_nonnulls(v_grp.legacy_dept_id, v_grp.legacy_team_id, v_grp.legacy_project_id) = 0 then
      raise exception using errcode = '23514', message = 'request_group_origin_unmapped';
    end if;
    new.dept_id    := v_grp.legacy_dept_id;
    new.team_id    := v_grp.legacy_team_id;
    new.project_id := v_grp.legacy_project_id;
  elsif new.group_id is null
     or (tg_op = 'UPDATE' and v_legacy_changed and not v_group_changed) then
    -- Legacy side written (every pre-Wave-2 writer): derive the Group.
    if v_from_legacy is null then
      raise exception using errcode = '23514', message = 'request_group_required';
    end if;
    new.group_id := v_from_legacy;
  else
    -- Both sides were given (or changed) together: verify the NAMED Group's own
    -- legacy_* columns against the legacy triple directly (review round 2, Defect B --
    -- see private.sync_task_group_origin's comment for why this replaces comparing two
    -- resolved ids).
    select * into v_grp from public.groups where id = new.group_id;
    if found and (new.dept_id is distinct from v_grp.legacy_dept_id
               or new.team_id is distinct from v_grp.legacy_team_id
               or new.project_id is distinct from v_grp.legacy_project_id) then
      raise exception using errcode = '23514', message = 'request_group_origin_mismatch';
    end if;
  end if;
  return new;
end;
$$;
comment on function private.sync_request_group_origin() is
  'Keeps completed_work_requests.group_id and the legacy Origin triple consistent both ways (ADR-0009 Wave 2), mirroring private.sync_task_group_origin exactly, including the Defect-B comparison against the Group''s own legacy_* columns (review round 2). request_group_required: the legacy side names no Group; request_group_origin_unmapped: the Group has no legacy master; request_group_origin_mismatch: both sides were set together and disagree.';

create trigger completed_work_requests_sync_group_origin
before insert or update of group_id, dept_id, team_id, project_id on public.completed_work_requests
for each row execute function private.sync_request_group_origin();

create function private.sync_campaign_group_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy_changed boolean;
  v_group_changed  boolean;
  v_from_legacy    bigint;
  v_grp            public.groups%rowtype;
begin
  v_legacy_changed := tg_op = 'INSERT'
    or new.department_id is distinct from old.department_id;
  v_group_changed  := tg_op = 'INSERT' or new.group_id is distinct from old.group_id;
  v_from_legacy    := private.group_id_for_legacy_origin(new.department_id, null, null);

  if (tg_op = 'INSERT' and new.group_id is not null and new.department_id is null)
     or (tg_op = 'UPDATE' and v_group_changed and not v_legacy_changed) then
    -- Group side written: derive department_id -- null for a Team or Project Group, which is
    -- exactly why the column went nullable in this migration. No _unmapped reason exists here:
    -- an unmapped Group simply produces a null department_id, not an error.
    select * into v_grp from public.groups where id = new.group_id;
    if not found then
      return new;                                   -- campaigns_group_id_fkey answers
    end if;
    new.department_id := v_grp.legacy_dept_id;
  elsif new.group_id is null
     or (tg_op = 'UPDATE' and v_legacy_changed and not v_group_changed) then
    -- Legacy side written (every pre-Wave-2 writer): derive the Group.
    if v_from_legacy is null then
      raise exception using errcode = '23514', message = 'campaign_group_required';
    end if;
    new.group_id := v_from_legacy;
  else
    -- Both sides were given (or changed) together: verify the NAMED Group's own
    -- legacy_dept_id against department_id directly, rather than resolving the legacy
    -- side backwards and comparing ids. Review round 2, Defect B: the round-1 fix
    -- guarded this branch on `department_id is not null`, which correctly stopped the
    -- false positive on a Team/Project-Group Campaign's no-op touch, but also let a
    -- genuine mismatch through -- `set department_id = null, group_id = <a real
    -- Department Group>` changes both sides, department_id is null so the old guard
    -- skipped the check entirely, and the row was stored with a Group that says
    -- (say) edu while department_id said nothing. Comparing directly against
    -- v_grp.legacy_dept_id has no such blind spot: it is null exactly when department_id
    -- should be (a Team/Project Group), and set exactly when department_id must match it.
    select * into v_grp from public.groups where id = new.group_id;
    if found and new.department_id is distinct from v_grp.legacy_dept_id then
      raise exception using errcode = '23514', message = 'campaign_group_origin_mismatch';
    end if;
  end if;
  return new;
end;
$$;
comment on function private.sync_campaign_group_origin() is
  'Keeps campaigns.group_id and department_id consistent both ways (ADR-0009 Wave 2). A legacy write derives group_id; a Group write derives department_id, which is null when the Group is not a Department (a Team or Project Group carries no _unmapped error -- department_id simply goes null, the reason the column was made nullable in this migration). A statement that sets both together is verified against the Group''s own legacy_dept_id directly (review round 2, Defect B), so a Team/Project-Group Campaign (department_id always null) lives on a no-op touch of either column while a genuine mismatch -- e.g. department_id cleared while group_id still names a real Department -- is still caught. campaign_group_required: the legacy side names no Group; campaign_group_origin_mismatch: both sides were set together and disagree.';

create trigger campaigns_sync_group_origin
before insert or update of group_id, department_id on public.campaigns
for each row execute function private.sync_campaign_group_origin();

create function private.sync_event_group_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy_changed boolean;
  v_group_changed  boolean;
  v_from_legacy    bigint;
  v_grp            public.groups%rowtype;
  v_caller_scope   public.event_scope;
  v_imp_scope      public.event_scope;
  v_imp_dept       text;
  v_imp_team       text;
  v_imp_project    bigint;
begin
  v_legacy_changed := tg_op = 'INSERT'
    or new.scope      is distinct from old.scope
    or new.dept_id    is distinct from old.dept_id
    or new.team_id    is distinct from old.team_id
    or new.project_id is distinct from old.project_id;
  v_group_changed  := tg_op = 'INSERT' or new.group_id is distinct from old.group_id;
  -- What the caller actually asserted about scope in THIS statement: on INSERT, whatever
  -- they supplied (null if omitted -- events.scope has no column default, and the NOT
  -- NULL check runs only after this BEFORE trigger returns); on UPDATE, only a value that
  -- DIFFERS from what was already there. `new.scope` otherwise carries the OLD persisted
  -- value forward for every column the statement did not mention, and that carried-
  -- forward value is not caller intent -- treating it as one is review round 2's Defect A
  -- (it made a legitimate Group-move UPDATE, one that lands on a Group with a different
  -- derived scope, raise a spurious mismatch).
  v_caller_scope := case
    when tg_op = 'INSERT' then new.scope
    when new.scope is distinct from old.scope then new.scope
    else null
  end;
  -- legacy -> Group: scope decides which column is the Origin
  v_from_legacy := case when new.scope = 'org'
                        then (select grp.id from public.groups as grp where grp.legacy_dept_id = 'org')
                        else private.group_id_for_legacy_origin(
                               case when new.scope = 'dept' then new.dept_id end, new.team_id, new.project_id) end;

  if (tg_op = 'INSERT' and new.group_id is not null
      and new.dept_id is null and new.team_id is null and new.project_id is null)
     or (tg_op = 'UPDATE' and v_group_changed and not v_legacy_changed) then
    -- Group -> legacy: scope, the Origin column, and the Team's parent Department.
    select * into v_grp from public.groups where id = new.group_id;
    if not found then
      return new;                                   -- events_group_id_fkey answers
    end if;
    if v_grp.legacy_dept_id = 'org' then
      new.scope := 'org';     new.dept_id := null; new.team_id := null; new.project_id := null;
    elsif v_grp.legacy_dept_id is not null then
      new.scope := 'dept';    new.dept_id := v_grp.legacy_dept_id; new.team_id := null; new.project_id := null;
    elsif v_grp.legacy_team_id is not null then
      new.scope := 'team';    new.team_id := v_grp.legacy_team_id; new.project_id := null;
      select team.dept_id into new.dept_id from public.teams as team where team.id = v_grp.legacy_team_id;
    elsif v_grp.legacy_project_id is not null then
      new.scope := 'project'; new.project_id := v_grp.legacy_project_id; new.dept_id := null; new.team_id := null;
    else
      raise exception using errcode = '23514', message = 'event_group_origin_unmapped';
    end if;
    if v_caller_scope is not null and v_caller_scope is distinct from new.scope then
      raise exception using errcode = '23514', message = 'event_group_origin_mismatch';
    end if;
  elsif new.group_id is null then
    -- Legacy side written, with no existing Group to anchor to: resolve fresh, and
    -- nothing more. Deliberately NOT verified against anything here: the resolver's own
    -- most-specific-first precedence (project, else team, else dept, with 'org' short-
    -- circuiting all three) is not the same judgment as events_scope_fields_ck, and
    -- re-deriving a verification here would sometimes catch a malformed fresh row under
    -- the wrong name -- e.g. `scope = 'org'` with a real project_id still resolves the
    -- Organization Group (the 'org' path ignores project_id by design) and would raise
    -- event_group_origin_mismatch instead of the more specific events_scope_fields_ck
    -- violation event_constraints.test.sql pins for exactly that row.
    if v_from_legacy is null then
      raise exception using errcode = '23514', message = 'event_group_required';
    end if;
    new.group_id := v_from_legacy;
  else
    -- group_id is already non-null here -- the row's existing value, since branch one
    -- above already handled every case where the caller changed it. Either nothing
    -- changed, the legacy side alone changed, or both changed together: verify the
    -- EXISTING group_id's own legacy_* columns against every legacy field, comparing
    -- against the Group's own truth rather than resolving the legacy side backwards and
    -- comparing ids (review round 2, Defect B, applied here too -- and the only way to
    -- also catch, e.g., a bare `scope = 'org'` UPDATE that leaves a stale
    -- dept_id/team_id/project_id behind while group_id stays put: the 'org' resolution
    -- path above ignores those columns entirely by design, and a resolve-only branch
    -- like private.sync_task_group_origin's would silently retarget group_id to the
    -- (still valid) Organization Group rather than notice).
    select * into v_grp from public.groups where id = new.group_id;
    if found then
      if v_grp.legacy_dept_id = 'org' then
        v_imp_scope := 'org';     v_imp_dept := null; v_imp_team := null; v_imp_project := null;
      elsif v_grp.legacy_dept_id is not null then
        v_imp_scope := 'dept';    v_imp_dept := v_grp.legacy_dept_id; v_imp_team := null; v_imp_project := null;
      elsif v_grp.legacy_team_id is not null then
        -- dept_id is deliberately excluded from this comparison (compared to itself, so
        -- it can never differ): a Team Event's Department is filled in below when the
        -- caller left it null, and a WRONG one is refused by events_team_department_fkey
        -- (23503), never by this trigger.
        v_imp_scope := 'team';    v_imp_dept := new.dept_id; v_imp_team := v_grp.legacy_team_id; v_imp_project := null;
      elsif v_grp.legacy_project_id is not null then
        v_imp_scope := 'project'; v_imp_dept := null; v_imp_team := null; v_imp_project := v_grp.legacy_project_id;
      else
        v_imp_scope := null;      v_imp_dept := null; v_imp_team := null; v_imp_project := null;
      end if;
      if new.scope is distinct from v_imp_scope
         or new.dept_id is distinct from v_imp_dept
         or new.team_id is distinct from v_imp_team
         or new.project_id is distinct from v_imp_project then
        raise exception using errcode = '23514', message = 'event_group_origin_mismatch';
      end if;
    end if;                                          -- not found: events_group_id_fkey answers
  end if;

  -- legacy-path normalisation: a Team Event fills its parent Department when the caller left it
  -- null (an Independent Team keeps null). A client-supplied WRONG Department is never
  -- overwritten -- events_team_department_fkey keeps answering 23503 for it.
  if new.scope = 'team' and new.dept_id is null then
    select team.dept_id into new.dept_id from public.teams as team where team.id = new.team_id;
  end if;

  return new;
end;
$$;
comment on function private.sync_event_group_origin() is
  'Keeps events.group_id and the legacy (scope, dept_id, team_id, project_id) Origin consistent both ways (ADR-0009 Wave 2), in three cases. (1) A Group write derives scope plus the one Origin column it implies, filling a Team Event''s parent Department along the way, and refuses a caller-supplied scope that disagrees with what the Group implies (v_caller_scope: what the caller actually asserted in THIS statement -- non-null on INSERT, or a value distinct from old.scope on UPDATE, never a value merely carried forward, review round 2 Defect A). (2) group_id starts null: resolve it fresh from the legacy side and stop -- never verified, so a malformed fresh row (e.g. scope=org with a real project_id, which the org short-circuit ignores) is still caught by events_scope_fields_ck under its own name, not reinterpreted here. (3) group_id is already non-null (the legacy side alone changed, nothing changed, or both changed together): verify the EXISTING group_id''s own legacy_* columns against every legacy field, comparing against the Group''s own truth rather than resolving the legacy side backwards and comparing ids (review round 2 Defect B; this is also what catches a bare scope change that leaves a stale dept_id/team_id/project_id behind while group_id stays put). event_group_required: case (2) resolved to no Group; event_group_origin_unmapped: the Group has no legacy master; event_group_origin_mismatch: the two sides disagree. Never overwrites a caller-supplied, wrong dept_id on a Team Event -- events_team_department_fkey answers that with 23503.';

create trigger events_sync_group_origin
before insert or update of group_id, scope, dept_id, team_id, project_id on public.events
for each row execute function private.sync_event_group_origin();

-- ==================== 5. Recreate tasks_with_overdue (now carries group_id) ====================
-- Definition, storage parameter, grants and comment are #339's/#341's, unchanged except for
-- the new column riding along with the star -- verified fresh against
-- pg_get_viewdef('public.tasks_with_overdue') on this branch, not copied from an earlier file.

create view public.tasks_with_overdue
with (security_invoker = on)
as
select
  task.*,
  (
    coalesce(task.deadline < statement_timestamp(), false)
    and task.status in ('todo', 'in_progress', 'in_review')
  ) as is_overdue
from public.tasks as task;

revoke all on public.tasks_with_overdue
  from public, anon, authenticated, service_role;
grant select on public.tasks_with_overdue to authenticated, service_role;

comment on view public.tasks_with_overdue is
  'RLS-aware Task query surface with overdue derived from the current clock and unfinished lifecycle state.';

-- ==================== 6. Re-issue the Campaign commands (constraint name only) ====================
-- create or replace preserves each function's ACL, so the roster in tracker_grants.test.sql
-- does not move for these two.

create or replace function private.create_campaign_impl(
  p_department_id text,
  p_name text
)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_name text;
  v_campaign public.campaigns%rowtype;
  v_constraint text;
begin
  -- Cheap gate before require_campaign_manager's Department lookup (#343
  -- review round 1, for symmetry with update/set_campaign_active below): an
  -- identity that can never manage any Campaign must not be able to use an
  -- unknown/invalid p_department_id to learn PT404 vs PT400 vs 42501. This
  -- is the same non-disclosure discipline the Task commands (#318) must
  -- copy from this template.
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (
       select 1
         from public.profiles as profile
        where profile.id = v_actor
          and profile.status = 'activ'
          and profile.role in ('bc', 'moderator', 'bce')
     ) then
    raise exception using
      errcode = '42501',
      message = 'campaign_manage_forbidden';
  end if;

  perform private.require_campaign_manager(p_department_id);

  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_campaign_name';
  end if;

  -- regexp_replace, not btrim: btrim only strips plain spaces, so a
  -- tab-padded name would dodge the lower(name) uniqueness check below
  -- while still colliding once trimmed for storage
  -- (private.create_project_impl's precedent).
  v_name := regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');

  begin
    insert into public.campaigns (department_id, name, created_by)
    values (p_department_id, v_name, v_actor)
    returning * into v_campaign;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;

      if v_constraint <> 'campaigns_group_name_uidx' then
        raise;
      end if;

      raise sqlstate 'PT409' using message = 'campaign_name_taken';
  end;

  return v_campaign;
end;
$$;

comment on function private.create_campaign_impl(text, text) is
  'Creates one Campaign for a Department the caller manages; the actor is auth.uid(), never a parameter. Rejects a blank name, trims a padded one, and re-raises the campaigns_group_name_uidx unique_violation as campaign_name_taken (any other constraint violation propagates unchanged).';

create or replace function private.update_campaign_impl(
  p_campaign_id bigint,
  p_name text
)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_department_id text;
  v_name text;
  v_campaign public.campaigns%rowtype;
  v_constraint text;
begin
  -- Cheap gate BEFORE the row lock below (#343 review round 1): an identity
  -- that can never manage any Campaign must not be able to take the
  -- Campaign row's FOR UPDATE lock, or learn campaign_not_found vs a real
  -- authorization decision, purely by naming an id. This does not replace
  -- require_campaign_manager's Department-scoped check below (a BCE of the
  -- wrong Department still passes this gate and fails there); it only keeps
  -- a caller who can never manage *anything* from reaching the lock at all
  -- -- the same non-disclosure discipline the Task commands (#318) must
  -- copy from this template.
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (
       select 1
         from public.profiles as profile
        where profile.id = v_actor
          and profile.status = 'activ'
          and profile.role in ('bc', 'moderator', 'bce')
     ) then
    raise exception using
      errcode = '42501',
      message = 'campaign_manage_forbidden';
  end if;

  -- An unknown Campaign is still PT404 no matter who is asking
  -- (campaigns_read already lets every active member see every Campaign
  -- row, so this does not disclose anything new to a caller who already
  -- passed the gate above).
  select campaign.department_id
    into v_department_id
    from public.campaigns as campaign
   where campaign.id = p_campaign_id
   for update;

  if not found then
    raise sqlstate 'PT404' using message = 'campaign_not_found';
  end if;

  perform private.require_campaign_manager(v_department_id);

  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_campaign_name';
  end if;

  -- regexp_replace, not btrim: btrim only strips plain spaces, so a
  -- tab-padded name would dodge the lower(name) uniqueness check below
  -- while still colliding once trimmed for storage
  -- (private.create_project_impl's precedent).
  v_name := regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');

  begin
    update public.campaigns as campaign
       set name = v_name,
           updated_at = clock_timestamp()
     where campaign.id = p_campaign_id
    returning campaign.* into v_campaign;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;

      if v_constraint <> 'campaigns_group_name_uidx' then
        raise;
      end if;

      raise sqlstate 'PT409' using message = 'campaign_name_taken';
  end;

  return v_campaign;
end;
$$;

comment on function private.update_campaign_impl(bigint, text) is
  'Renames an existing Campaign; department_id never changes here or anywhere else. Gates on a live BC/Moderator/BCE before locking the Campaign row. Rejects a blank name, trims a padded one, and re-raises the campaigns_group_name_uidx unique_violation as campaign_name_taken (any other constraint violation propagates unchanged). Sets updated_at itself (private.set_updated_at(), #368, is not in this stack''s base).';

-- ==================== 7. Grants ====================
-- The five new functions: `none` for the resolver (called only by the four trigger functions
-- and the backfill above), `trigger` for the four sync functions -- nobody calls a trigger
-- function directly. create_campaign_impl/update_campaign_impl keep their existing grants
-- (create or replace).

revoke execute on function private.sync_task_group_origin()
  from public, anon, authenticated, service_role;
revoke execute on function private.sync_request_group_origin()
  from public, anon, authenticated, service_role;
revoke execute on function private.sync_campaign_group_origin()
  from public, anon, authenticated, service_role;
revoke execute on function private.sync_event_group_origin()
  from public, anon, authenticated, service_role;

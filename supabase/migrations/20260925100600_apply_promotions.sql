-- #52: apply automatic promotions and notify -- the daily job, the close-time run, and the Retention Signal notices.
--
-- ADR-0004 (amended 2026-09-21) and ADR-0009 §Promotion hooks. #51 detects,
-- this migration applies. Two lines are never crossed: Voluntar cu Drept de
-- Vot is granted only by BC confirming the adherence form (role_history's
-- role_history_voting_actor_ck already refuses an automatic row touching
-- `vot`), and no Role is ever withdrawn or lowered automatically -- a
-- Retention Signal changes nothing and tells BC what is theirs to decide.
--
-- Three functions, all `security definer` with an empty search_path and
-- executable by nobody (the scheduler and #701's close run as the owner):
--
--   * private.apply_promotion(p_member_id, p_from_role, p_to_role,
--     p_rule_kind, p_period_id) -- the shared core, one detected row. The
--     Profile is locked `for no key update` (the Role is not a key) and
--     re-read under the lock: a Member who is no longer live active or no
--     longer holds p_from_role is skipped, so a second run -- or a detection
--     row made stale by a concurrent set_member_role -- applies nothing. A
--     row that would not raise the Member's level is skipped too: never a
--     demotion, whatever the rules table says. Otherwise: profiles.role
--     moves, one role_history row with the system actor (actor_kind
--     'automatic', changed_by null -- #50), and one congratulatory `system`
--     Notification to the Member through private.notify. Returns whether it
--     applied.
--   * private.apply_promotions() -- the daily pg_cron job
--     osubb-apply-promotions: every row of private.detect_promotions(), in
--     its order. Returns the number of promotions applied.
--   * private.apply_close_promotions(p_period_id) -- the close-time run
--     #701's close_evaluation_period calls in its own transaction: every row
--     of private.detect_close_promotions(p_period_id) in its order (the
--     tenure step first, so a Recrut the close promotes to Voluntar can be
--     promoted to Voluntar Activ by the top x% in the same run), then a
--     Notification for every row of private.detect_retention_signals(
--     p_period_id). The signals are read before the first promotion is
--     applied: #48 ranks each cohort by "the Role at the close", and a
--     Voluntar the close has just made Voluntar Activ would otherwise join
--     that cohort and could be signalled -- and push a holder out of the
--     share -- in the very close that promoted them. #48's and #51's PT404
--     evaluation_period_not_found / PT409 evaluation_period_open propagate,
--     so a failure rolls the close back. Returns (promotions,
--     retention_signals): the promotions applied and the Retention Signal
--     Notifications written.
--
-- Serialisation. Both entry points take pg_advisory_xact_lock(52, 1) first,
-- as remind_deadlines (#69) takes (69, 1): the daily job and a close never
-- apply the same detection side by side, and a retried job waits.
--
-- Idempotence. A promotion cannot repeat: once applied the Member no longer
-- holds from_role, so detection does not return the row and the core would
-- skip it anyway. A Retention Signal carries the dedupe key
-- retention_signal:<period id>:<member id>, and a recipient who already has
-- a Notification with that key -- read or unread -- is not written again
-- (private.notify's upsert only covers unread rows, so the check is explicit,
-- as in remind_deadlines). A re-run of the close reads #48's cohorts as the
-- Roles stand then, the close's own promotions included, so a Member holding
-- the signal's Role through a role_history row dated at or after the
-- Period's closed_at is never signalled for that Period: the Voluntar the
-- close made Voluntar Activ is not "at risk" of a Role they did not hold
-- through it. (#701 stamps closed_at with now(), so the close's own history
-- rows share that instant.)
--
-- Notifications (kind `system`, Romanian copy, names read at write time --
-- coalesce(nickname, full_name) as every server-side name since #675, and
-- roles.name for the Role):
--   * a promotion -- to the Member, link /profil, dedupe key
--     promotion:<role_history id> (unique per promotion, so two never merge).
--     The Voluntar Activ one names the benefits -- AG Eligibility and the
--     path to Drept de Vot through the adherence form BC confirms -- and
--     carries the form's address, read at write time from
--     org_settings.adherence_form_url (#681, ruling R20), never a literal.
--     The address goes in the body: notifications.link is an in-app route,
--     and the client drops an absolute URL (inAppLink). While the setting is
--     empty the body says BC sends the form.
--   * a Retention Signal -- to every live active Member at level >= 6 (BC,
--     Moderator) and every Group Responsible (group_role 'responsible') of
--     the Adunarea Generală Group named by
--     org_settings.adunarea_generala_group_id (#512; nobody extra while it is
--     empty), minus the Member at risk themselves; naming the Member, the
--     Role at risk, the Period, their rank and Task Points and the share
--     they missed; link /tracker/membru/<id>.

-- ---------------------------------------------------------------------------
-- The shared core: one detected promotion.
-- ---------------------------------------------------------------------------
create function private.apply_promotion(
  p_member_id uuid,
  p_from_role public.member_role,
  p_to_role   public.member_role,
  p_rule_kind text,
  p_period_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member      public.profiles%rowtype;
  v_from_level  integer;
  v_to_level    integer;
  v_to_name     text;
  v_period_name text;
  v_history_id  bigint;
  v_form_url    text;
  v_title       text;
  v_body        text;
begin
  -- The Profile under lock, re-read: detection ran before the lock.
  select * into v_member
    from public.profiles
   where id = p_member_id
   for no key update;
  if not found or v_member.status <> 'activ' or v_member.role <> p_from_role then
    return false;
  end if;

  -- Never a demotion, never a sideways move: the Role must rise.
  select role.level into v_from_level from public.roles as role where role.id = p_from_role;
  select role.level, role.name into v_to_level, v_to_name
    from public.roles as role
   where role.id = p_to_role;
  if v_from_level is null or v_to_level is null or v_to_level <= v_from_level then
    return false;
  end if;

  if p_period_id is not null then
    select period.name into v_period_name
      from public.evaluation_periods as period
     where period.id = p_period_id;
  end if;

  update public.profiles
     set role = p_to_role
   where id = p_member_id;

  insert into public.role_history (
    member_id, from_role, to_role, changed_by, actor_kind, reason
  ) values (
    p_member_id, p_from_role, p_to_role, null, 'automatic',
    case
      when p_period_id is null
        then format('Automatic promotion (apply_promotions, %s rule)', p_rule_kind)
      else format('Automatic promotion at the close of Evaluation Period %s (apply_close_promotions, %s rule)',
                  p_period_id, p_rule_kind)
    end
  )
  returning id into v_history_id;

  v_title := format('Felicitări! Acum ești %s', v_to_name);
  v_body := format('Rolul tău în OSUBB este acum %s: %s.', v_to_name,
    case
      when p_rule_kind = 'time'
        then 'ai împlinit vechimea cerută de regula de promovare'
      when p_period_id is null
        then 'ai atins Pragul de promovare în perioada de evaluare în curs'
      else format('ai încheiat perioada de evaluare „%s” în topul clasamentului', v_period_name)
    end);

  -- AG Eligibility follows from Voluntar Activ alone: this is where the
  -- adherence form is offered.
  if p_to_role = 'activ' then
    select nullif(btrim(setting.value), '') into v_form_url
      from public.org_settings as setting
     where setting.key = 'adherence_form_url';
    v_body := v_body || ' Ca Voluntar Activ ai Eligibilitate AG: poți intra în Adunarea Generală '
      || 'obținând Dreptul de Vot, pe care BC ți-l acordă după ce confirmă formularul de adeziune. '
      || case
           when v_form_url is not null then 'Completează formularul de adeziune: ' || v_form_url
           else 'Formularul de adeziune îl primești de la BC.'
         end;
  end if;

  perform private.notify(
    array[p_member_id], 'system', v_title, v_body, null,
    'promotion:' || v_history_id::text, null, '/profil');

  return true;
end;
$$;

comment on function private.apply_promotion(uuid, public.member_role, public.member_role, text, bigint) is
  '#52: the shared core of private.apply_promotions and private.apply_close_promotions -- applies one row #51 detected. Locks the Profile for no key update and re-reads it: skipped (false) unless the Member is live active and still holds p_from_role, and unless p_to_role''s level is above p_from_role''s (never a demotion). Otherwise sets profiles.role, writes one role_history row with the system actor (actor_kind automatic, changed_by null, #50) and one system Notification to the Member through private.notify (link /profil, dedupe key promotion:<role_history id>). The Voluntar Activ Notification names AG Eligibility and the path to Drept de Vot and carries org_settings.adherence_form_url, read at write time (#681, ruling R20), in its body. p_period_id is the closing Evaluation Period for the close-time run, null for the daily job. Executable by nobody.';

revoke execute on function private.apply_promotion(uuid, public.member_role, public.member_role, text, bigint)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The daily job.
-- ---------------------------------------------------------------------------
create function private.apply_promotions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   record;
  v_count integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(52, 1);
  for v_row in
    select detected.member_id, detected.from_role, detected.to_role, detected.rule_kind
      from private.detect_promotions() as detected
  loop
    if private.apply_promotion(v_row.member_id, v_row.from_role, v_row.to_role,
                               v_row.rule_kind, null) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

comment on function private.apply_promotions() is
  '#52: the daily pg_cron job osubb-apply-promotions. Takes pg_advisory_xact_lock(52, 1) -- shared with private.apply_close_promotions -- then applies every row of #51''s private.detect_promotions() in its order through private.apply_promotion: the Role, one role_history row with the system actor, one congratulatory Notification. Returns the number of promotions applied; a second run applies none (the Members no longer hold from_role). Never demotes or withdraws a Role. Executable by nobody.';

revoke execute on function private.apply_promotions()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The close-time run.
-- ---------------------------------------------------------------------------
create function private.apply_close_promotions(
  p_period_id bigint,
  out promotions integer,
  out retention_signals integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row         record;
  v_signals     jsonb;
  v_period_name text;
  v_closed_at   timestamptz;
  v_ag_group_id bigint;
  v_recipients  uuid[];
  v_key         text;
begin
  perform pg_catalog.pg_advisory_xact_lock(52, 1);
  promotions := 0;
  retention_signals := 0;

  -- 1. The promotions, tenure step first. #51 raises PT404 / PT409 for an
  --    unknown or still-open Period, which rolls the close back. The
  --    Retention Signals are read before any Role moves (see the header).
  select coalesce(jsonb_agg(to_jsonb(signal)), '[]'::jsonb) into v_signals
    from private.detect_retention_signals(p_period_id) as signal;

  for v_row in
    select detected.member_id, detected.from_role, detected.to_role, detected.rule_kind
      from private.detect_close_promotions(p_period_id) as detected
  loop
    if private.apply_promotion(v_row.member_id, v_row.from_role, v_row.to_role,
                               v_row.rule_kind, p_period_id) then
      promotions := promotions + 1;
    end if;
  end loop;

  -- 2. The Retention Signals: nothing changes; BC and the Adunarea
  --    Generală's Group Responsibles are told.
  select period.name, period.closed_at into v_period_name, v_closed_at
    from public.evaluation_periods as period
   where period.id = p_period_id;

  select case when setting.value ~ '^[1-9][0-9]{0,17}$' then setting.value::bigint end
    into v_ag_group_id
    from public.org_settings as setting
   where setting.key = 'adunarea_generala_group_id';

  for v_row in
    select signal.member_id,
           signal.task_points,
           signal.rank,
           signal.share_size,
           role.name as role_name,
           coalesce(member.nickname, member.full_name) as member_name
      from jsonb_to_recordset(v_signals) as signal (
             member_id uuid, role public.member_role, task_points integer,
             rank integer, share_size integer)
      join public.roles as role on role.id = signal.role
      join public.profiles as member on member.id = signal.member_id
     -- A Member promoted into the Role at or after the close did not hold it
     -- through the Period: never at risk of it for this Period. This is what
     -- keeps a re-run exact, where #48's cohorts read the Roles as they are.
     where not exists (
       select 1 from public.role_history as history
        where history.member_id = signal.member_id
          and history.to_role = signal.role
          and history.created_at >= v_closed_at)
  loop
    v_key := 'retention_signal:' || p_period_id::text || ':' || v_row.member_id::text;

    select array_agg(recipient.id order by recipient.id) into v_recipients
      from (
        select profile.id
          from public.profiles as profile
          join public.roles as role on role.id = profile.role
         where profile.status = 'activ'
           and role.level >= 6
        union
        select held.member_id
          from public.group_members as held
         where held.group_id = v_ag_group_id
           and held.group_role = 'responsible'
      ) as recipient (id)
     where recipient.id <> v_row.member_id
       and not exists (
         select 1 from public.notifications as notification
          where notification.member_id = recipient.id
            and notification.dedupe_key = v_key);

    retention_signals := retention_signals + private.notify(
      v_recipients, 'system',
      format('Semnal de retenție: %s', v_row.member_name),
      format('%s (%s) a încheiat perioada de evaluare „%s” sub pragul rolului. '
             'Puncte în perioadă: %s. Locul în rol: %s; rolul cere cel mult locul %s. '
             'Rolul nu se retrage automat: decizia îi aparține BC.',
             v_row.member_name, v_row.role_name, v_period_name,
             v_row.task_points, v_row.rank, v_row.share_size),
      null, v_key, null, '/tracker/membru/' || v_row.member_id::text);
  end loop;
end;
$$;

comment on function private.apply_close_promotions(bigint) is
  '#52: the close-time run #701''s close_evaluation_period calls in its own transaction (a failure here rolls the close back). Takes pg_advisory_xact_lock(52, 1) -- shared with the daily private.apply_promotions -- then applies every row of #51''s private.detect_close_promotions(p_period_id) in its order through private.apply_promotion (the tenure step first, so a Recrut promoted to Voluntar at the close can reach Voluntar Activ by the top x% in the same run); then, for every row of private.detect_retention_signals(p_period_id) -- read before the first promotion, so the cohorts are the Roles at the close, and never about a Member whose role_history shows them reaching the Role at or after closed_at --, changes nothing and writes one system Notification to every live active Member at level >= 6 and every Group Responsible of the Adunarea Generală Group (org_settings.adunarea_generala_group_id, #512), the Member at risk excluded, naming the Member and the Role at risk; dedupe key retention_signal:<period id>:<member id>, and a recipient who already holds that key (read or not) is skipped, so a second run writes nothing. Returns (promotions, retention_signals): promotions applied and Retention Signal Notifications written. PT404 evaluation_period_not_found, PT409 evaluation_period_open (#51''s). Never demotes or withdraws a Role. Executable by nobody.';

revoke execute on function private.apply_close_promotions(bigint)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The schedule: 05:30 UTC -- 07:30 or 08:30 in Bucharest, after the
-- Bucharest date #51's tenure reads has turned, and at an hour a push may
-- arrive. cron.schedule updates a job of the same name in place.
-- ---------------------------------------------------------------------------
select cron.schedule('osubb-apply-promotions', '30 5 * * *',
  'select private.apply_promotions()');

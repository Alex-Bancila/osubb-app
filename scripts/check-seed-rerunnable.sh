#!/usr/bin/env bash
# `supabase start` (or `supabase db reset`) already applied seed.sql to an
# empty database. Staging gets the same file applied to a LIVE one
# (docs/backend/seeding-staging.md), so it has to be re-runnable: applying
# it twice must leave the same demo data, not a duplicate of it and not an
# error. It also proves the seed does not clobber rows a human added.
#
# Run it after the local Supabase stack is up and reset (CLI `start` + `db reset`):
#   bash scripts/check-seed-rerunnable.sh
#
# This script only ever talks to the LOCAL Supabase stack. The default URL
# is derived straight from supabase/config.toml's [db] port (no CLI call —
# see below); override it with LOCAL_DB_URL if you must, but the resolved
# host is checked against 127.0.0.1/localhost/::1 and the script refuses
# to run — before attempting any connection — if it is anything else. This
# is deliberate: `DB_URL` is the name seed-staging.yml uses for the
# *staging* connection string, and a scoped, distinct variable name here
# stops that value ever being picked up by accident and pointed at a live
# database (which would insert a sentinel row and apply the demo seed to it).
#
# It also proves the demo-password contract (security pass 2026-09-27, H3):
# outside a local stack the seed refuses to run without a strong
# `app.seed_password`, and with one set every demo login uses it.
set -euo pipefail
cd "$(dirname "$0")/.."

# The sentinel auth user/profile/Group and the demo Member it borrows are
# CI's own fixture UUIDs, not generated data — they stay hardcoded on
# purpose (see the inserts below).

# Read the port from the [db] section specifically — config.toml has other
# `port = ` lines under [api], [db.pooler], [studio], etc. and the first
# match is not necessarily the database's.
db_port=$(awk '
  /^\[db\]/ { in_db = 1; next }
  /^\[/     { in_db = 0 }
  in_db && /^port[[:space:]]*=/ { print $3; exit }
' supabase/config.toml)

LOCAL_DB_URL="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:${db_port}/postgres}"

# libpq lets environment variables and URL query parameters redirect a
# connection away from the host in the URL's authority (PGHOSTADDR wins over
# the URL host; ?host=, ?hostaddr= and ?service= in the query do too). The
# local stack needs none of them, so clear the environment ones and refuse
# any query string outright — otherwise the host check below could pass on
# 127.0.0.1 while psql actually connects somewhere else.
unset PGHOST PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGDATABASE
if [[ "$LOCAL_DB_URL" == *"?"* ]]; then
  echo "::error::Refusing LOCAL_DB_URL with a query string: parameters such as ?host= can redirect the connection past the local-host check." >&2
  exit 2
fi

# Extract the host from LOCAL_DB_URL and refuse anything non-local, before
# any connection is attempted. Handles postgres:// and postgresql://, an
# optional user[:password]@ prefix, an optional :port, an optional
# /database suffix, and a bracketed IPv6 host such as [::1].
if [[ ! "$LOCAL_DB_URL" =~ ^postgres(ql)?://([^/?]*)(.*)$ ]]; then
  echo "::error::Could not parse LOCAL_DB_URL as a postgres:// or postgresql:// URL." >&2
  exit 2
fi
authority="${BASH_REMATCH[2]}"
hostport="${authority##*@}"   # drop user[:password]@ if present
if [[ "$hostport" =~ ^\[([^]]+)\] ]]; then
  db_host="${BASH_REMATCH[1]}"       # bracketed IPv6, e.g. [::1]:5432 -> ::1
else
  db_host="${hostport%%:*}"          # host[:port] -> host
fi
case "$db_host" in
  127.0.0.1|localhost|::1) ;;
  *)
    echo "::error::Refusing to run against non-local host '$db_host' (from LOCAL_DB_URL). This script only ever seeds the local Supabase stack." >&2
    exit 2
    ;;
esac

CONTAINER="supabase_db_$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml)"

# Prefer a real psql against the local stack's LOCAL_DB_URL. Fall back to
# `docker exec` into the db container supabase_start/reset already brought
# up (its name is derived from config.toml's project_id, not hardcoded).
# The docker path never reads LOCAL_DB_URL — it always reaches the local
# container by name — so on a machine without psql, a LOCAL_DB_URL port or
# host override has no effect (it cannot reach anything non-local either).
# The container has no view of the repo on disk, so when the docker path is
# used, translate a `-f FILE` argument into a stdin redirect from the host
# instead of forwarding the flag — psql running inside the container could
# never open a host-relative path.
run_sql() {
  if command -v psql >/dev/null 2>&1 && [ -n "$LOCAL_DB_URL" ]; then
    psql "$LOCAL_DB_URL" -X -q -v ON_ERROR_STOP=1 -At "$@"
    return
  fi

  local args=() file=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -f)
        file="$2"
        shift 2
        ;;
      *)
        args+=("$1")
        shift
        ;;
    esac
  done

  if [ -n "$file" ]; then
    docker exec -i "$CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -At "${args[@]}" < "$file"
  else
    docker exec -i "$CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -At "${args[@]}"
  fi
}

# Fail loudly — not "success on empty output" — if nothing answers.
if ! probe=$(run_sql -c "select 1" 2>&1) || [ "$probe" != "1" ]; then
  echo "::error::Could not reach the local Supabase database (tried psql+LOCAL_DB_URL, then docker exec into $CONTAINER). Is the local Supabase stack running? Docker output: $probe" >&2
  exit 1
fi

# ==================== Demo password from a secret (H3) ====================
# Each run below is one transaction that ends in ROLLBACK, so none of them
# changes the database. "Hosted" is simulated by overriding the CLI's local
# JWT secret for that transaction only — the signal seed.sql reads.
seed_as_hosted() { # $1 = app.seed_password ('' for none), $2 = SQL after the seed
  {
    echo "begin;"
    echo "select set_config('app.settings.jwt_secret', 'hosted-project-secret', true) is not null;"
    echo "select set_config('app.seed_password', '$1', true) is not null;"
    cat supabase/seed.sql
    printf '%s\n' "$2"
    echo "rollback;"
  } | run_sql 2>&1
}

if out=$(seed_as_hosted "" ""); then
  echo "::error::seed.sql ran on a non-local database without app.seed_password." >&2
  exit 1
fi
case "$out" in
  *seed_password_required*) ;;
  *) echo "::error::seed.sql without app.seed_password failed, but not with seed_password_required: $out" >&2; exit 1 ;;
esac

# Each weak password on its own, so dropping any one rule turns a case red:
# the local default, 15 characters, and 73 bytes (bcrypt reads only 72).
for weak in "parola123" "fifteen-chars-1" "$(printf 'x%.0s' $(seq 1 73))"; do
  if out=$(seed_as_hosted "$weak" ""); then
    echo "::error::seed.sql accepted a weak app.seed_password (${#weak} characters) on a non-local database." >&2
    exit 1
  fi
  case "$out" in
    *seed_password_too_weak*) ;;
    *) echo "::error::seed.sql with a weak app.seed_password (${#weak} characters) failed, but not with seed_password_too_weak: $out" >&2; exit 1 ;;
  esac
done

configured_check=$(cat <<'SQL'
select 'configured:' || format('%s:%s',
  count(*) filter (where encrypted_password = extensions.crypt('ci-seed-password-0123456789', encrypted_password)),
  count(*) filter (where encrypted_password = extensions.crypt('parola123', encrypted_password)))
  from auth.users where email like '%@demo.osubb';
SQL
)
out=$(seed_as_hosted "ci-seed-password-0123456789" "$configured_check") || {
  echo "::error::seed.sql refused a strong app.seed_password: $out" >&2
  exit 1
}
case "$out" in
  *configured:8:0*) ;;
  *) echo "::error::With app.seed_password set, the eight demo logins did not all use it (expected configured:8:0): $out" >&2; exit 1 ;;
esac
echo "Demo password: refused without a secret off-local; all eight logins use the configured one."

# Clean up the sentinel rows on every exit path, including a failure, so a
# broken run does not poison the next one.
cleanup() {
  run_sql -q <<'SQL' >/dev/null 2>&1 || true
delete from task_assignments
 where task_id in (select id from tasks
                    where created_by = 'e2750000-0000-0000-0000-000000000001');
delete from tasks
 where created_by = 'e2750000-0000-0000-0000-000000000001';
delete from groups
 where created_by = 'e2750000-0000-0000-0000-000000000001';
delete from auth.users
 where id = 'e2750000-0000-0000-0000-000000000001';
SQL
}
trap cleanup EXIT

demo_before=$(run_sql -c "select count(*) from auth.users where email like '%@demo.osubb'")

# A Group owned by a non-demo account is a sentinel for
# the most dangerous seed regression: deleting real staging data.
# Use a complete auth/profile pair so the invariant triggers exercise
# the same foreign keys as an invited tester.
run_sql -q <<'SQL'
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data,
  raw_user_meta_data, confirmation_token, recovery_token,
  email_change_token_new, email_change, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'e2750000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'seed-preservation@test.local',
  extensions.crypt('temporary', extensions.gen_salt('bf')),
  now(), now(), now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object(), '', '', '', '', '', '', '', ''
);
insert into profiles (id, full_name, email, role, joined_at, avatar_color, university)
values ('e2750000-0000-0000-0000-000000000001', 'Seed Preservation',
        'seed-preservation@test.local', 'vot', '2026-01-01', '#000000',
        private.ubb_university());
insert into groups (name, category, created_by)
values ('Cross-owned seed guard', 'project', 'e2750000-0000-0000-0000-000000000001');
insert into group_members(group_id,member_id,group_role)
select id,'d0000000-0000-0000-0000-000000000005','manager'
from groups where name='Cross-owned seed guard';
insert into tasks (
  title, difficulty, status, audience, assignment_mode, created_by, group_id
)
values ('Non-demo local opportunity', 1, 'todo', 'local', 'direct',
        'e2750000-0000-0000-0000-000000000001',
        (select id from groups where name = 'Educațional'));
insert into task_assignments (task_id, member_id, assigned_by)
select id,
       'e2750000-0000-0000-0000-000000000001',
       'e2750000-0000-0000-0000-000000000001'
  from tasks
 where created_by = 'e2750000-0000-0000-0000-000000000001';
SQL

history_before=$(run_sql -c "select to_jsonb(assignment)::text from task_assignments assignment join tasks task on task.id = assignment.task_id where task.created_by = 'e2750000-0000-0000-0000-000000000001'")

# Re-seeding must abort before changing anything when a real-owned
# Group still points at a demo Member. Silently deleting that Group
# would be data loss; deleting the demo user would violate its membership.
if run_sql -1 -f supabase/seed.sql; then
  echo "::error::seed.sql accepted a non-demo-owned Group with a demo Member."
  exit 1
fi

guarded=$(run_sql -c "select format('%s:%s', (select count(*) from groups where name = 'Cross-owned seed guard' and created_by = 'e2750000-0000-0000-0000-000000000001'), (select count(*) from auth.users where email like '%@demo.osubb'))")
if [ "$guarded" != "1:${demo_before}" ]; then
  echo "::error::The cross-owned Group guard did not roll back cleanly ($guarded, expected 1:${demo_before})."
  exit 1
fi

run_sql -q <<'SQL'
delete from groups
 where name = 'Cross-owned seed guard'
   and created_by = 'e2750000-0000-0000-0000-000000000001';
insert into groups (name, category, created_by)
values ('Preserved real Group', 'project', 'e2750000-0000-0000-0000-000000000001');
SQL

broadcasts_before=$(run_sql -c "select count(*) from notifications where member_id='e2750000-0000-0000-0000-000000000001' and title like 'Anunț nou:%'")
before=$(run_sql -f scripts/seed-fingerprint.sql)
run_sql -1 -f supabase/seed.sql
after=$(run_sql -f scripts/seed-fingerprint.sql)
broadcasts_after=$(run_sql -c "select count(*) from notifications where member_id='e2750000-0000-0000-0000-000000000001' and title like 'Anunț nou:%'")
if [ "$broadcasts_after" != "$broadcasts_before" ]; then
  echo "::error::Re-seeding broadcast demo Announcements to a real Member." >&2
  exit 1
fi

if [ "$before" != "$after" ]; then
  echo "::error::Applying supabase/seed.sql twice changed the data. Staging applies this file to a live database; it must be safe to run again."
  echo "before: $before"
  echo "after:  $after"
  exit 1
fi

# The fingerprint compares stable content. Seven native demo Groups: three
# Teams, two Projects, the Adunarea Generală and the board (#824). Check the
# migration-specific absence/presence facts explicitly so an old legacy
# fixture cannot hide in it.
native_shape=$(run_sql -c "select format('%s:%s:%s:%s',
  (select count(*) from groups where created_by='d0000000-0000-0000-0000-000000000007'),
  (select count(*) from groups where name='Adunarea Generală'
    and created_by='d0000000-0000-0000-0000-000000000007'
    and automatic_membership and min_level=3 and not competes_in_cup
    and not accepts_applications),
  (select count(*) from information_schema.tables where table_schema='public' and table_name='teams'),
  (select count(*) from information_schema.tables where table_schema='public' and table_name='projects'))")
if [ "$native_shape" != "7:1:0:0" ]; then
  echo "::error::The native demo Group shape changed ($native_shape, expected 7:1:0:0)."
  exit 1
fi

history_after=$(run_sql -c "select to_jsonb(assignment)::text from task_assignments assignment join tasks task on task.id = assignment.task_id where task.created_by = 'e2750000-0000-0000-0000-000000000001'")
if [ "$history_before" != "$history_after" ]; then
  echo "::error::Re-seeding changed the non-demo Assignment sentinel."
  echo "before: $history_before"
  echo "after:  $history_after"
  exit 1
fi

preserved=$(run_sql -c "select format('%s:%s:%s:%s:%s', (select count(*) from auth.users where id = 'e2750000-0000-0000-0000-000000000001'), (select count(*) from profiles where id = 'e2750000-0000-0000-0000-000000000001'), (select count(*) from groups where created_by = 'e2750000-0000-0000-0000-000000000001'), (select count(*) from tasks where created_by = 'e2750000-0000-0000-0000-000000000001' and status = 'todo' and audience = 'local' and assignment_mode = 'direct'), (select count(*) from task_assignments assignment join tasks task on task.id = assignment.task_id where task.created_by = 'e2750000-0000-0000-0000-000000000001' and assignment.member_id = 'e2750000-0000-0000-0000-000000000001' and assignment.ended_at is null))")
if [ "$preserved" != "1:1:1:1:1" ]; then
  echo "::error::Re-seeding did not preserve the non-demo auth/profile/Group/local-Task/Assignment sentinels ($preserved)."
  exit 1
fi

echo "seed.sql applied twice, same data: $before"

# ==================== #901: re-seed after a Role Evaluation ====================
# On staging, testers run Role Evaluations as the demo personas (before R58 the
# daily osubb-apply-promotions job also promoted the demo Recrut) and edit a
# demo voter's Universitate. Every row that leaves behind (a run, its
# Promotion Candidates and Notifications, threshold and share changes, R58's
# stored Retention Signals -- a live Universitate one included --,
# role_history) names a demo profile without `on delete`, so
# the seed's cleanup must remove it before the demo cohort. This lives here,
# not in demo_seed.test.sql, because `supabase test db` mounts only
# supabase/tests: a pgTAP suite cannot apply seed.sql. One transaction, rolled
# back: the demo Moderator edits the Drept de Vot share, runs one Evaluation of
# each kind (R58: with the Floor, share and cutoff a Simulation shows), then
# edits both thresholds, the Prag minim and an organization setting -- after the
# runs, since a run writes its values through with no author -- moves the demo
# voter and the non-demo voter to another university (R58: a live Retention
# Signal each) and changes a demo Member's Role; a non-demo run with its
# Candidate and Retention Signal, the non-demo voter's live Signal and a
# non-demo threshold change stand in for real data.
evaluation_fixture=$(cat <<'SQL'
select set_config('request.jwt.claims', jsonb_build_object(
         'sub', p.id, 'role', 'authenticated',
         'app_metadata', jsonb_build_object('member_role', p.role, 'member_level', r.level,
           'group_ids', coalesce((select jsonb_agg(gm.group_id order by gm.group_id)
                                    from group_members gm where gm.member_id = p.id), '[]'::jsonb)))::text,
       true) is not null
  from profiles p join roles r on r.id = p.role
 where p.email = 'moderator@demo.osubb';
set local role authenticated;
select 1 from public.set_evaluation_percent('adunarea_generala',
  case (select vot_percent from evaluation_settings where id = 1) when 40 then 41 else 40 end);
-- #1131: a run covers complete days, so its range ends yesterday at the latest.
select 1 from public.run_role_evaluation('voluntar_activ', current_date - 365, current_date - 1, 'Evaluare demo #901', 1, 35, current_date);
select 1 from public.run_role_evaluation('adunarea_generala', current_date - 365, current_date - 1, 'Evaluare AG demo #901', 1,
  (select vot_percent from evaluation_settings where id = 1));
select 1 from public.set_promotion_threshold('voluntar_activ',
  coalesce((select threshold from promotion_thresholds where kind = 'voluntar_activ'), 0) + 1);
select 1 from public.set_promotion_threshold('adunarea_generala',
  coalesce((select threshold from promotion_thresholds where kind = 'adunarea_generala'), 0) + 1);
select 1 from public.set_eligibility_floor(
  coalesce((select eligibility_floor from evaluation_settings where id = 1), 0) + 1);
select 1 from public.set_org_setting('adherence_form_url', 'https://forms.example.org/demo-901');
update profiles set university = 'Universitatea Tehnică din Cluj-Napoca'
 where id in ('d0000000-0000-0000-0000-000000000004', 'e2750000-0000-0000-0000-000000000001');
select 1 from public.set_member_role('d0000000-0000-0000-0000-000000000002', 'activ', 'Probă #901');
reset role;
select set_config('request.jwt.claims', '', true) is not null;
insert into role_evaluations (kind, name, period_from, period_to, run_by, threshold_used, ranked_count)
values ('voluntar_activ', 'Evaluare reală #901', current_date - 30, current_date,
        'e2750000-0000-0000-0000-000000000001', 1, 0);
insert into promotion_threshold_changes (kind, from_value, to_value, source, changed_by)
values ('voluntar_activ', null, 7, 'manual', 'e2750000-0000-0000-0000-000000000001');
insert into promotion_candidates (role_evaluation_id, member_id, task_points, tenure_since, threshold_used)
select id, 'e2750000-0000-0000-0000-000000000001', 7, current_date, 1
  from role_evaluations where name = 'Evaluare reală #901';
insert into retention_signals (kind, member_id, role_at_listing, reason, task_points, threshold_used, role_evaluation_id)
select 'voluntar_activ', 'e2750000-0000-0000-0000-000000000001', 'activ', 'below_line', 0, 1, id
  from role_evaluations where name = 'Evaluare reală #901';
insert into notifications (member_id, kind, title, dedupe_key)
select 'e2750000-0000-0000-0000-000000000001', 'system', 'Candidat la promovare #901',
       'promotion_candidate:' || id || ':e2750000-0000-0000-0000-000000000001'
  from role_evaluations where name = 'Evaluare reală #901';
select 'evaluation-before:' || format('%s:%s:%s:%s:%s:%s',
  (select count(*) from role_evaluations e join profiles p on p.id = e.run_by
    where p.email like '%@demo.osubb' and e.name like '%demo #901'),
  (select count(*) from role_history h join profiles p on p.id = h.changed_by
    where p.email like '%@demo.osubb' and h.reason = 'Probă #901'),
  (select count(*) from promotion_thresholds t join profiles p on p.id = t.updated_by where p.email like '%@demo.osubb'),
  (select count(*) from org_settings s join profiles p on p.id = s.updated_by where p.email like '%@demo.osubb'),
  (select count(*) from evaluation_settings s join profiles p on p.id = s.updated_by where p.email like '%@demo.osubb'),
  (select count(*) from retention_signals where reason = 'not_ubb_student' and closed_at is null));
SQL
)
evaluation_check=$(cat <<'SQL'
select 'evaluation-after:' || format('%s:%s:%s:%s:%s:%s:%s:%s:%s:%s:%s:%s',
  (select count(*) from profiles where email like '%@demo.osubb'),
  (select count(*) from role_evaluations e join profiles p on p.id = e.run_by where p.email like '%@demo.osubb'),
  (select count(*) from role_history h join profiles p on p.id in (h.member_id, h.changed_by) where p.email like '%@demo.osubb'),
  (select count(*) from notifications where dedupe_key ~ '^(promotion_candidate|retention_signal):'
                                         and split_part(dedupe_key, ':', 2) not in (select id::text from role_evaluations union all select 'live')),
  (select count(*) from role_evaluations where run_by = 'e2750000-0000-0000-0000-000000000001' and name = 'Evaluare reală #901'),
  (select count(*) from promotion_threshold_changes where changed_by = 'e2750000-0000-0000-0000-000000000001' and to_value = 7),
  (select count(*) from promotion_thresholds where threshold is not null),
  (select count(*) from promotion_candidates where member_id = 'e2750000-0000-0000-0000-000000000001' and task_points = 7),
  (select count(*) from notifications where member_id = 'e2750000-0000-0000-0000-000000000001'
                                        and title = 'Candidat la promovare #901'),
  (select count(*) from evaluation_settings s join profiles p on p.id = s.updated_by where p.email like '%@demo.osubb'),
  (select count(*) from retention_signals where member_id = 'e2750000-0000-0000-0000-000000000001' and task_points = 0),
  (select count(*) from retention_signals where member_id = 'e2750000-0000-0000-0000-000000000001'
                                          and reason = 'not_ubb_student' and closed_at is null));
SQL
)
out=$({
  echo "begin;"
  printf '%s\n' "$evaluation_fixture"
  cat supabase/seed.sql
  printf '%s\n' "$evaluation_check"
  echo "rollback;"
} | run_sql 2>&1) || {
  echo "::error::seed.sql failed to re-run after the demo Moderator ran Role Evaluations: $(printf '%s' "$out" | grep -m1 -i 'error' || printf '%s' "$out" | tail -3)" >&2
  exit 1
}
case "$out" in
  *evaluation-before:2:1:2:1:1:2*) ;;
  *) echo "::error::The Role Evaluation fixture did not build its demo rows (expected evaluation-before:2:1:2:1:1:2): $(printf '%s' "$out" | grep -m1 'evaluation-before' || printf '%s' "$out" | tail -3)" >&2; exit 1 ;;
esac
# 8 demo Members back; no demo run, demo role_history or orphaned Candidate /
# Retention Signal Notification left; the non-demo run and threshold change
# kept with its Candidate and Notification; both thresholds keep their values;
# no evaluation_settings row names a demo Member any more (R58: the demo
# Moderator set the Prag minim above, so its updated_by named one before); the
# non-demo run's Retention Signal is kept (R58), and so is the non-demo voter's
# live Universitate Signal (a `live` key names no run, so it is no orphan).
case "$out" in
  *evaluation-after:8:0:0:0:1:1:2:1:1:0:1:1*) ;;
  *) echo "::error::Re-seeding after a Role Evaluation left the wrong rows (expected evaluation-after:8:0:0:0:1:1:2:1:1:0:1:1): $(printf '%s' "$out" | grep -m1 'evaluation-after' || printf '%s' "$out" | tail -3)" >&2; exit 1 ;;
esac
echo "seed.sql re-runs after the demo Moderator ran a Role Evaluation of each kind."

# ============ Re-seed while a demo Voluntar is a live Promotion Candidate ============
# Between Role Evaluations a Voluntar is listed as a Promotion Candidate the
# moment their Task Points reach the Voluntar Activ line (#983, R35), and on
# staging that is live as soon as the Data limită de intrare is set (R58).
# private.refresh_promotion_candidates runs from statement triggers on
# points_ledger, promotion_thresholds, evaluation_settings and profiles -- so
# the seed's own writes fire it, in its cleanup as well as in its inserts, and
# a refresh that listed a demo Member again after the cleanup removed the
# Candidates left a row pinning the demo profile. Each case is one transaction,
# rolled back: the non-demo sentinel becomes a BC (a real leader the refresh
# notifies), the demo Moderator sets the Prag minim and the Data limită de
# intrare, then lists the demo Voluntar -- (a) by evaluating their Task in
# review high enough to cross the line, as a tester would; (b) by lowering the
# line to the points the seed itself gives them, so the seed's own ledger
# inserts list them again mid-seed. The seed must re-run both times. Then (a)
# leaves no demo Candidate and no Notification naming one on the real leader,
# and (b) leaves exactly the one live Candidate and one Notification its
# inserts made.
live_setup=$(cat <<'SQL'
update profiles set role = 'bc' where id = 'e2750000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', jsonb_build_object(
         'sub', p.id, 'role', 'authenticated',
         'app_metadata', jsonb_build_object('member_role', p.role, 'member_level', r.level,
           'group_ids', coalesce((select jsonb_agg(gm.group_id order by gm.group_id)
                                    from group_members gm where gm.member_id = p.id), '[]'::jsonb)))::text,
       true) is not null
  from profiles p join roles r on r.id = p.role
 where p.email = 'moderator@demo.osubb';
select set_config('seed_check.voluntar_points', (
  select earned.task_points::text from private.task_points_in_range('-infinity', 'infinity') earned
   where earned.member_id = 'd0000000-0000-0000-0000-000000000002'), true) is not null;
set local role authenticated;
select 1 from public.set_eligibility_floor(
  coalesce((select eligibility_floor from evaluation_settings where id = 1), 0) + 1);
select 1 from public.set_membership_cutoff(current_date);
SQL
)
live_by_evaluation=$(cat <<'SQL'
select 1 from public.complete_task_review(
  (select t.id from tasks t
     join task_assignments a on a.task_id = t.id and a.ended_at is null
    where t.status = 'in_review' and a.member_id = 'd0000000-0000-0000-0000-000000000002'
    order by t.id limit 1),
  10, 5, 'Probă candidat live');
SQL
)
live_by_seeded_points=$(cat <<'SQL'
select 1 from public.set_promotion_threshold('voluntar_activ',
  current_setting('seed_check.voluntar_points')::integer);
SQL
)
live_finish=$(cat <<'SQL'
reset role;
select set_config('request.jwt.claims', '', true) is not null;
select 'live-before:' || format('%s:%s',
  (select count(*) from promotion_candidates where member_id = 'd0000000-0000-0000-0000-000000000002'
                                               and role_evaluation_id is null and decision is null),
  (select count(*) from notifications where member_id = 'e2750000-0000-0000-0000-000000000001'
                                        and dedupe_key = 'promotion_candidate:live:d0000000-0000-0000-0000-000000000002'));
SQL
)
live_check=$(cat <<'SQL'
select 'live-after:' || format('%s:%s:%s:%s:%s',
  (select count(*) from profiles where email like '%@demo.osubb'),
  (select count(*) from promotion_candidates where member_id = 'd0000000-0000-0000-0000-000000000002'
                                               and role_evaluation_id is null and decision is null),
  (select count(*) from promotion_candidates c join profiles p on p.id = c.member_id where p.email like '%@demo.osubb'),
  (select count(*) from notifications where member_id = 'e2750000-0000-0000-0000-000000000001'
                                        and dedupe_key like 'promotion_candidate:live:%'),
  (select count(*) from evaluation_settings where membership_cutoff is not null and updated_by is null));
SQL
)
live_candidate_case() { # $1 = case name, $2 = SQL that lists the demo Voluntar, $3 = expected live-after
  local out
  out=$({
    echo "begin;"
    printf '%s\n' "$live_setup" "$2" "$live_finish"
    cat supabase/seed.sql
    printf '%s\n' "$live_check"
    echo "rollback;"
  } | run_sql 2>&1) || {
    echo "::error::seed.sql failed to re-run while the demo Voluntar was a live Promotion Candidate ($1): $(printf '%s' "$out" | grep -m1 -i 'error' || printf '%s' "$out" | tail -3)" >&2
    exit 1
  }
  case "$out" in
    *live-before:1:1*) ;;
    *) echo "::error::The live Candidate fixture ($1) did not list the demo Voluntar and notify the real leader (expected live-before:1:1): $(printf '%s' "$out" | grep -m1 'live-before' || printf '%s' "$out" | tail -3)" >&2; exit 1 ;;
  esac
  case "$out" in
    *"live-after:$3"*) ;;
    *) echo "::error::Re-seeding while the demo Voluntar was a live Promotion Candidate ($1) left the wrong rows (expected live-after:$3): $(printf '%s' "$out" | grep -m1 'live-after' || printf '%s' "$out" | tail -3)" >&2; exit 1 ;;
  esac
}
# 8 demo Members back; the demo Voluntar's open live Candidates; every
# Candidate row of a demo Member; the real leader's live Candidate
# Notifications; the Data limită de intrare kept with no demo author.
live_candidate_case "listed by a Task evaluation" "$live_by_evaluation" "8:0:0:0:1"
live_candidate_case "listed on the seed's own points" "$live_by_seeded_points" "8:1:1:1:1"
echo "seed.sql re-runs while a demo Voluntar is a live Promotion Candidate."

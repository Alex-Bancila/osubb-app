#!/usr/bin/env bash
# #163: replay real join-date and ledger migrations over populated old shapes.
# Manual awards were retired by #261/#162; Task awards survive, while unknown
# non-demo manual awards must stop the upgrade instead of silently disappearing.
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"

# #160 already has a populated-schema replay; reuse that exact regression proof.
bash supabase/tests/profiles_joined_at_upgrade.test.sh

prepare_ledger() {
  cat <<'SQL'
begin;
set local client_min_messages = warning;
alter table public.points_ledger
  drop constraint points_ledger_reason_ck,
  drop constraint points_ledger_task_reference_ck,
  drop constraint points_ledger_sanction_shape_ck,
  drop column note;
truncate public.points_ledger;
insert into auth.users (id, email) values
  ('16300000-0000-0000-0000-000000000001', 'upgrade163@test.local'),
  ('16300000-0000-0000-0000-000000000002', 'upgrade163@demo.osubb');
insert into public.profiles (id, full_name, email, role) values
  ('16300000-0000-0000-0000-000000000001', 'Upgrade Member', 'upgrade163@test.local', 'voluntar'),
  ('16300000-0000-0000-0000-000000000002', 'Upgrade Demo', 'upgrade163@demo.osubb', 'voluntar');
insert into public.tasks (title, group_id) values ('Upgrade award 163', (select id from public.groups where legacy_dept_id = 'edu'));
insert into public.points_ledger (member_id, delta, reason, task_id)
select '16300000-0000-0000-0000-000000000001', 20, 'task', id
  from public.tasks where title = 'Upgrade award 163';
insert into public.points_ledger (member_id, delta, reason, task_id)
select '16300000-0000-0000-0000-000000000001', -5, 'task_reversal', id
  from public.tasks where title = 'Upgrade award 163';
insert into public.points_ledger (member_id, delta, reason) values
  ('16300000-0000-0000-0000-000000000001', -3, 'sanction'),
  ('16300000-0000-0000-0000-000000000002', 7, 'manual_award');
create temporary table before_ledger as
  select id, member_id, delta, reason, task_id, awarded_by, created_at
    from public.points_ledger where reason <> 'manual_award';
-- Reconstruct the retired #261 trigger, which #162 drops after conversion.
create function public.reject_manual_award() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.reason = 'manual_award' then
    raise exception 'manual_award ledger rows are no longer supported'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger points_ledger_reject_manual_award
  before insert on public.points_ledger for each row
  execute function public.reject_manual_award();
SQL
}

{
  prepare_ledger
  cat supabase/migrations/20260911210000_points_ledger_note.sql
  cat supabase/migrations/20260911210100_points_ledger_reason_semantics.sql
  cat <<'SQL'
do $assert$
begin
  if exists (
    (select * from before_ledger except select id, member_id, delta, reason, task_id, awarded_by, created_at from public.points_ledger)
    union all
    (select id, member_id, delta, reason, task_id, awarded_by, created_at from public.points_ledger except select * from before_ledger)
  ) then
    raise exception 'Task award, reversal or sanction history changed during upgrade';
  end if;
  if (select sum(delta) from public.points_ledger where reason in ('task', 'task_reversal')) is distinct from 15::bigint then
    raise exception 'existing Task-ledger total changed';
  end if;
  if (select sum(delta) from public.points_ledger) is distinct from 12::bigint then
    raise exception 'personal total lost its sanction history';
  end if;
  if (select note from public.points_ledger where reason = 'sanction') is distinct from
      'Sanction recorded before notes were required (#162).' then
    raise exception 'legacy sanction note was not backfilled';
  end if;
  if exists (select 1 from public.points_ledger where reason = 'manual_award') then
    raise exception 'obsolete demo award was not removed';
  end if;
end
$assert$;
-- Prove the surviving history stays readable through the Member policy.
select set_config('request.jwt.claims', '{"sub":"16300000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"member_role":"voluntar","member_level":1}}', true);
set local role authenticated;
do $assert$
begin
  if (select sum(delta) from public.points_ledger) is distinct from 12::bigint then
    raise exception 'Member cannot read preserved award and sanction history';
  end if;
end
$assert$;
reset role;
rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q

# Real historical manual awards require a human decision; ensure the real
# migration still refuses them instead of deleting or relabelling them.
set +e
failure_output=$(
  {
    prepare_ledger
    cat <<'SQL'
alter table public.points_ledger disable trigger points_ledger_reject_manual_award;
insert into public.points_ledger (member_id, delta, reason)
values ('16300000-0000-0000-0000-000000000001', 9, 'manual_award');
alter table public.points_ledger enable trigger points_ledger_reject_manual_award;
SQL
    cat supabase/migrations/20260911210000_points_ledger_note.sql
    cat supabase/migrations/20260911210100_points_ledger_reason_semantics.sql
    echo 'rollback;'
  } | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q 2>&1
)
failure_status=$?
set -e
if [ "$failure_status" -eq 0 ] || [[ "$failure_output" != *"points_ledger still holds manual_award rows"* ]]; then
  echo 'Historical non-demo awards did not stop the migration with its intended error.' >&2
  echo "$failure_output" >&2
  exit 1
fi

echo 'Member join-date and ledger history upgrade checks passed.'

#!/usr/bin/env bash
# #794 (ruling R26): 20260925091107_task_visibility_follows_audience.sql
# corrects every direct + org Task to direct + local -- a data correction,
# not an edit, so it writes no activity row -- and leaves every other
# Audience / Assignment Mode combination exactly as it was. Replayed in a
# scratch transaction over rows the live commands can no longer write.
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"

{
  cat <<'SQL'
begin;
set local client_min_messages = warning;

-- The live database already holds the migration's one new function; move it
-- aside so the replay can create it again (the policy keeps pointing at the
-- old OID until the replay's alter policy repoints it). The scratch
-- transaction rolls back either way.
alter function private.has_open_org_opportunity(bigint) rename to has_open_org_opportunity_before_794;

insert into public.tasks (title, group_id, audience, assignment_mode, queue_opened_at) values
  ('Upgrade 794 direct org',   (select id from public.groups where name = 'Educațional'), 'org',   'direct', null),
  ('Upgrade 794 direct local', (select id from public.groups where name = 'Educațional'), 'local', 'direct', null),
  ('Upgrade 794 public org',   (select id from public.groups where name = 'Educațional'), 'org',   'public', now()),
  ('Upgrade 794 public local', (select id from public.groups where name = 'Educațional'), 'local', 'public', now());

create temp table activity_before_794 as select count(*) as n from public.task_activity;
SQL

  cat supabase/migrations/20260925091107_task_visibility_follows_audience.sql

  cat <<'SQL'
do $assert$
begin
  if exists (select 1 from public.tasks where assignment_mode = 'direct' and audience = 'org') then
    raise exception 'a direct + org Task survived the #794 correction';
  end if;

  if (select audience from public.tasks where title = 'Upgrade 794 direct org')
       is distinct from 'local' then
    raise exception 'the legacy direct + org Task did not take the local Audience';
  end if;

  if (select string_agg(title || '=' || assignment_mode || '+' || audience, ',' order by title)
        from public.tasks where title like 'Upgrade 794 %')
       is distinct from 'Upgrade 794 direct local=direct+local,Upgrade 794 direct org=direct+local,'
                        'Upgrade 794 public local=public+local,Upgrade 794 public org=public+org' then
    raise exception 'the #794 correction touched a combination it must leave alone';
  end if;

  if (select count(*) from public.task_activity) <> (select n from activity_before_794) then
    raise exception 'the #794 correction wrote an activity row';
  end if;
end
$assert$;

rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q

echo "Direct Task local Audience upgrade checks passed."

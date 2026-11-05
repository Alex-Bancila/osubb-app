-- postgres_17_volatility.test.sql — the four functions Postgres 17's lint
-- refused keep the volatility their bodies have.
--
-- #1140. On 17, `supabase db lint --level warning --fail-on warning` judges a
-- function's declared volatility against what it calls: array_to_string,
-- jsonb_build_object and jsonb_build_array are stable, so an immutable
-- caller is refused, and a stable function may not perform a volatile one.
-- Migration 20261105183934_postgres_17_volatility.sql relabels the four; if
-- one goes back, the lint fails CI and so does this suite. Runs in one
-- transaction and rolls back.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(5);

create function pg_temp.volatility(p_signature text) returns text
language sql stable as $$
  select p.provolatile::text from pg_proc p where p.oid = p_signature::regprocedure
$$;

select is(pg_temp.volatility('private.formatted_text_plain(text)'), 's',
  'formatted_text_plain is stable (it calls array_to_string)');
select is(pg_temp.volatility('private.require_attached_links(jsonb, text, text)'), 's',
  'require_attached_links is stable (it calls jsonb_build_object and jsonb_build_array)');
select is(pg_temp.volatility('private.require_formatted_text_length(text, text)'), 's',
  'require_formatted_text_length is stable (it calls formatted_text_plain)');
select is(pg_temp.volatility('private.require_task_visible(bigint)'), 's',
  'require_task_visible is stable, so the stable preview_task_update_impl may perform it');

-- The server's major is the one config.toml pins, so the suites above prove
-- something about production's engine (production runs 17.11, #1140).
select is(current_setting('server_version_num')::integer / 10000, 17,
  'the database under test is Postgres 17');

select * from finish();
rollback;

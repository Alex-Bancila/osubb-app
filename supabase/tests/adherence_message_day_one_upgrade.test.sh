#!/usr/bin/env bash
# R66: replay the adherence_message migration's move (the statements between
# its "move: begin" and "move: end" markers) inside one rollback transaction.
# With org_settings.adherence_form_url set, the day-one Adherence Message
# carries that address with the label "Deschide formularul de adeziune", no
# heading and no body (no window until BC writes one), version 0; without it,
# no link at all. Either way the org_settings row is gone afterwards.
set -euo pipefail
migration=$(printf '%s\n' supabase/migrations/*_adherence_message.sql)
db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"

move() { sed -n '/^-- move: begin$/,/^-- move: end$/p' "$migration"; }
if ! move | grep -q '^insert into public\.adherence_message '; then
  echo 'The move was not found in the migration' >&2; exit 1
fi
{
  cat <<'SQL'
begin;
-- A database as it stood before the migration: the address in org_settings,
-- no message row.
delete from public.adherence_message;
insert into public.org_settings (key, value) values ('adherence_form_url', 'https://forms.example/aderare');
SQL
  move
  cat <<'SQL'
do $check$
declare
  v public.adherence_message%rowtype;
begin
  select * into strict v from public.adherence_message;
  if v.id <> 1 or v.link_url is distinct from 'https://forms.example/aderare'
     or v.link_label is distinct from 'Deschide formularul de adeziune'
     or v.title is not null or v.body is not null or v.version <> 0 then
    raise exception 'with an address set, the day-one row is wrong: %', row_to_json(v);
  end if;
  if exists (select 1 from public.org_settings where key = 'adherence_form_url') then
    raise exception 'the org_settings row survived the move';
  end if;
end $check$;

-- The same move over a database where BC never set the address.
delete from public.adherence_message;
insert into public.org_settings (key, value) values ('adherence_form_url', null);
SQL
  move
  cat <<'SQL'
do $check$
declare
  v public.adherence_message%rowtype;
begin
  select * into strict v from public.adherence_message;
  if v.link_url is not null or v.link_label is not null
     or v.title is not null or v.body is not null or v.version <> 0 then
    raise exception 'with no address, the day-one row is wrong: %', row_to_json(v);
  end if;
  if exists (select 1 from public.org_settings where key = 'adherence_form_url') then
    raise exception 'the org_settings row survived the move';
  end if;
end $check$;
rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q
echo "Adherence Message day one: a set adherence_form_url becomes the message's link with its label, none leaves no link, and the org_settings row goes either way."

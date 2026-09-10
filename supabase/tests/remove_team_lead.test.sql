-- remove_team_lead.test.sql — issue #277: retire the single Team lead model.
begin;
set local client_min_messages = warning;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(4);

select hasnt_column(
  'public', 'teams', 'lead_id',
  'Teams no longer advertise a single lead');

select has_table(
  'private', 'legacy_team_leads',
  'legacy Team lead mappings have a private archive');

select ok(
  (select relrowsecurity from pg_class
    where oid = 'private.legacy_team_leads'::regclass),
  'the private archive has row-level security enabled');

select ok(
  not has_table_privilege(
    'anon', 'private.legacy_team_leads',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  and not has_table_privilege(
    'authenticated', 'private.legacy_team_leads',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  and not has_table_privilege(
    'service_role', 'private.legacy_team_leads',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'API roles have no privileges on the historical archive');

select * from finish();
rollback;

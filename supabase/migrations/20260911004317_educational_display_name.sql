-- #215: the Educațional department's display name was stored without its
-- diacritic ('Educational', 0001_core_schema.sql:43). Correct the display value
-- only. The identifier 'edu' is referenced by foreign keys, the JWT dept_ids
-- claim, seed rows and tests, and must never change.
update public.departments
   set name = 'Educațional'
 where id = 'edu'
   and name is distinct from 'Educațional';

-- #310: coordination structures Diverse (Department Teams it, interne) and
-- Secretariat; retire the legacy 'it' department. Both use kind =
-- 'coordination', so dept_cup (kind = 'department') never lists them.
-- Colour: Brand Book defines only the five departments; #5C5C61 is the
-- mockup's neutral (see docs/brand/reference.md).

insert into public.departments (id, name, short, color, kind) values
  ('diverse',     'Diverse',     'DIV', '#5C5C61', 'coordination'),
  ('secretariat', 'Secretariat', 'SEC', '#5C5C61', 'coordination')
on conflict (id) do nothing;

insert into public.teams (id, name, dept_id, for_recruits, is_interne) values
  ('it',      'Echipa IT',      'diverse', false, false),
  ('interne', 'Echipa Interne', 'diverse', false, true)
on conflict (id) do nothing;

-- Members of the retired department join Diverse and the IT team.
insert into public.member_departments (member_id, dept_id)
select md.member_id, 'diverse'
  from public.member_departments md
 where md.dept_id = 'it'
on conflict (member_id, dept_id) do nothing;

insert into public.team_members (team_id, member_id)
select 'it', md.member_id
  from public.member_departments md
 where md.dept_id = 'it'
on conflict (team_id, member_id) do nothing;

-- events(team_id, dept_id) → teams(id, dept_id) is NO ACTION and not
-- deferrable, which makes moving a team between departments impossible in
-- either order. Make it deferrable, defer it for this transaction, then move.
alter table public.events
  alter constraint events_team_department_fkey deferrable initially immediate;
set constraints public.events_team_department_fkey deferred;

update public.teams         set dept_id = 'diverse' where dept_id = 'it';
update public.events        set dept_id = 'diverse' where dept_id = 'it';
update public.tasks         set dept_id = 'diverse' where dept_id = 'it';
update public.task_requests set dept_id = 'diverse' where dept_id = 'it';
update public.announcements set dept_id = 'diverse' where dept_id = 'it';

delete from public.member_departments where dept_id = 'it';
delete from public.departments where id = 'it';

alter table public.tasks
  add column audience text not null default 'local'
  constraint tasks_audience_check check (audience in ('local', 'org'));

-- Legacy open Tasks were visible as opportunities across the organization.
-- Preserve that reach independently of the later lifecycle-status migration.
update public.tasks
   set audience = 'org'
 where status = 'open';

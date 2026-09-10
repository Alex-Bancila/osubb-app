alter table public.tasks
  add column assignment_mode text not null default 'direct'
  constraint tasks_assignment_mode_check
    check (assignment_mode in ('direct', 'public'));

-- `open` is the only legacy state that proves a Task was offered publicly.
-- Capture that distinction before the later status normalization removes it.
update public.tasks
   set assignment_mode = 'public'
 where status = 'open';

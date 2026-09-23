-- #673: validate every constraint 20260923231125_constraints_kit.sql added NOT VALID; a row that still breaks one stops the migration, naming table and constraint.
alter table public.tasks validate constraint tasks_title_length_ck;
alter table public.tasks validate constraint tasks_description_length_ck;
alter table public.events validate constraint events_title_length_ck;
alter table public.events validate constraint events_description_length_ck;
alter table public.events validate constraint events_capacity_range_ck;
alter table public.campaigns validate constraint campaigns_name_length_ck;
alter table public.groups validate constraint groups_name_length_ck;
alter table public.announcements validate constraint announcements_title_length_ck;
alter table public.announcements validate constraint announcements_body_length_ck;
alter table public.announcements validate constraint announcements_form_link_ck;
alter table public.task_activity validate constraint task_activity_note_length_ck;
alter table public.task_assignments validate constraint task_assignments_end_note_length_ck;
alter table public.task_evaluations validate constraint task_evaluations_note_length_ck;
alter table public.task_evaluations validate constraint task_evaluations_reversal_reason_length_ck;
alter table public.tasks validate constraint tasks_cancel_reason_length_ck;
alter table public.completed_work_requests validate constraint completed_work_requests_decision_note_length_ck;
alter table public.completed_work_requests validate constraint completed_work_requests_description_length_ck;

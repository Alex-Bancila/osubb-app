-- #379: normalize existing policy and constraint names without changing their definitions.
-- Keep free-form tasks.type/profiles.tier and UUID push_tokens.id unchanged:
-- restricting their domains or replacing identities is not cosmetic cleanup.
-- departments.kind is intentionally left for ADR-0009 Wave 3 retirement.

alter policy announcement_reads_self on public.announcement_reads rename to announcement_reads_manage_self;
alter policy announcements_write on public.announcements rename to announcements_manage;
alter policy attendance_insert_self on public.event_attendance rename to event_attendance_create_self;
alter policy attendance_read on public.event_attendance rename to event_attendance_read;
alter policy attendance_update_self on public.event_attendance rename to event_attendance_update_self;
alter policy notifications_mark_read_self on public.notifications rename to notifications_update_self;
alter policy ledger_read on public.points_ledger rename to points_ledger_read;
alter policy ledger_sanction on public.points_ledger rename to points_ledger_create_sanction;
alter policy profiles_self_update on public.profiles rename to profiles_update_self;
alter policy auth_admin_read_profiles on public.profiles rename to profiles_read_auth_admin;
alter policy auth_admin_read_roles on public.roles rename to roles_read_auth_admin;
alter policy auth_admin_read_member_departments on public.member_departments rename to member_departments_read_auth_admin;
alter policy auth_admin_read_team_members on public.team_members rename to team_members_read_auth_admin;

alter table public.rating_guide rename constraint rating_guide_rating_check to rating_guide_rating_ck;
alter table public.difficulty_guide rename constraint difficulty_guide_stars_check to difficulty_guide_stars_ck;
alter table public.tasks rename constraint tasks_assignment_mode_check to tasks_assignment_mode_ck;
alter table public.tasks rename constraint tasks_audience_check to tasks_audience_ck;
alter table public.tasks rename constraint tasks_cancelled_at_state_check to tasks_cancelled_at_state_ck;
alter table public.tasks rename constraint tasks_completed_at_state_check to tasks_completed_at_state_ck;
alter table public.tasks rename constraint tasks_difficulty_check to tasks_difficulty_ck;
alter table public.tasks rename constraint tasks_exactly_one_origin_check to tasks_exactly_one_origin_ck;
alter table public.tasks rename constraint tasks_lifecycle_timestamp_order_check to tasks_lifecycle_timestamp_order_ck;
alter table public.tasks rename constraint tasks_queue_timestamp_state_check to tasks_queue_timestamp_state_ck;
alter table public.tasks rename constraint tasks_rating_check to tasks_rating_ck;
alter table public.tasks rename constraint tasks_review_return_check to tasks_review_return_ck;
alter table public.tasks rename constraint tasks_started_at_state_check to tasks_started_at_state_ck;
alter table public.tasks rename constraint tasks_submitted_at_state_check to tasks_submitted_at_state_ck;
alter table public.tasks rename constraint tasks_unfulfilled_at_state_check to tasks_unfulfilled_at_state_ck;
alter table public.task_assignments rename constraint task_assignments_end_chronology_check to task_assignments_end_chronology_ck;
alter table public.task_assignments rename constraint task_assignments_end_note_check to task_assignments_end_note_ck;
alter table public.task_assignments rename constraint task_assignments_end_reason_check to task_assignments_end_reason_ck;
alter table public.task_assignments rename constraint task_assignments_end_shape_check to task_assignments_end_shape_ck;
alter table public.projects rename constraint projects_name_not_blank to projects_name_not_blank_ck;
alter table public.projects rename constraint projects_status_valid to projects_status_valid_ck;
alter table public.projects rename constraint projects_timestamps_ordered to projects_timestamps_ordered_ck;
alter table public.project_members rename constraint project_members_role_valid to project_members_role_valid_ck;
alter table public.teams rename constraint teams_id_dept_unique to teams_id_dept_key;

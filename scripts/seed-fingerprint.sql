-- Content fingerprint of the demo dataset. Row ids advance with the
-- sequences and are not part of it, so this is what CI (and
-- scripts/check-seed-rerunnable.sh) compares before/after re-applying
-- supabase/seed.sql to prove the file is safe to run against a live
-- database. Dynamic identity values and timestamps are represented by stable
-- content/shape labels so a safe rerun compares meaning rather than sequence
-- allocation or wall-clock time.
select md5(string_agg(x, '|' order by x))
  from (
    select format('member:%s:%s:%s', full_name, role, status) from profiles
    union all select format('points:%s:%s:%s', full_name, points, rank) from leaderboard
    union all select format('dept:%s:%s', member_id, dept_id) from member_departments
    union all select format('team:%s:%s:%s', id, name, for_recruits) from teams
    union all select format('project:%s:%s:%s:%s', project.name, project.status, leader.full_name, creator.full_name)
                from projects project
                join profiles leader on leader.id = project.leader_id
                join profiles creator on creator.id = project.created_by
    union all select format('project-member:%s:%s:%s', project.name, member.full_name, membership.project_role)
                from project_members membership
                join projects project on project.id = membership.project_id
                join profiles member on member.id = membership.member_id
    union all select format('task:%s:%s:%s', title, status, coalesce(rating::text, '-')) from tasks
    union all select format('assignee:%s:%s', t.title, p.full_name)
                from task_assignees a
                join tasks t on t.id = a.task_id
                join profiles p on p.id = a.member_id
    union all select format('assignment:%s:%s:%s:%s:%s:%s:%s',
                            task.title,
                            member.full_name,
                            coalesce(actor.full_name, '-'),
                            case when assignment.assigned_at = task.created_at
                              then 'task-created' else 'other-start' end,
                            case
                              when assignment.ended_at is null then 'active'
                              when assignment.ended_at = task.completed_at then 'completed-at'
                              when assignment.ended_at = task.unfulfilled_at then 'unfulfilled-at'
                              when assignment.ended_at = task.cancelled_at then 'cancelled-at'
                              when assignment.ended_at = assignment.assigned_at then 'at-start'
                              else 'other-end'
                            end,
                            coalesce(assignment.end_reason, '-'),
                            coalesce(assignment.end_note, '-'))
                from task_assignments assignment
                join tasks task on task.id = assignment.task_id
                join profiles member on member.id = assignment.member_id
                left join profiles actor on actor.id = assignment.assigned_by
    union all select format('ledger:%s:%s:%s', p.full_name, l.delta, l.reason)
                from points_ledger l join profiles p on p.id = l.member_id
    union all select format('event:%s:%s', title, scope) from events
    union all select format('rsvp:%s:%s:%s', e.title, p.full_name, a.status)
                from event_attendance a
                join events e on e.id = a.event_id
                join profiles p on p.id = a.member_id
    union all select format('announce:%s:%s:%s', title, priority, pinned) from announcements
    union all select format('notif:%s:%s:%s', p.full_name, n.kind, n.title)
                from notifications n join profiles p on p.id = n.member_id
  ) s (x);

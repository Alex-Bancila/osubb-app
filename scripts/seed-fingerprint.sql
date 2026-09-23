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
    -- Native Groups and their command-appointed rosters are the demo source.
    -- Stable names and settings make a rerun comparable despite new ids.
    union all select format('group:%s:%s:%s:%s:%s:%s:%s:%s:%s', grp.name, grp.category,
                            coalesce(parent.name, '-'), grp.status, grp.competes_in_cup,
                            grp.min_level, grp.automatic_membership,
                            grp.accepts_applications, grp.counts_toward_parent_cup)
                from groups grp left join groups parent on parent.id = grp.parent_id
    union all select format('group-member:%s:%s:%s', grp.name, member.full_name, membership.group_role)
                from group_members membership
                join groups grp on grp.id = membership.group_id
                join profiles member on member.id = membership.member_id
    -- #296: `kind`, `assignment_mode` and `audience` joined this line when the
    -- demo was rebuilt on the normalized model — an Umbrella, a public
    -- Opportunity and a direct Task are three different demo scenarios that
    -- title/status/rating alone could not tell apart.
    union all select format('task:%s:%s:%s:%s:%s:%s', title, status,
                            coalesce(rating::text, '-'), kind,
                            coalesce(assignment_mode, '-'), coalesce(audience, '-'))
                from tasks
    union all select format('campaign:%s:%s:%s:%s',
                            campaign_group.name, campaign.name,
                            campaign.is_active, creator.full_name)
                from campaigns campaign
                join groups campaign_group on campaign_group.id = campaign.group_id
                join profiles creator on creator.id = campaign.created_by
    union all select format('candidate:%s:%s:%s:%s:%s',
                            task.title, task.status, member.full_name,
                            candidate.status,
                            coalesce(decider.full_name, '-'))
                from task_candidates candidate
                join tasks task on task.id = candidate.task_id
                join profiles member on member.id = candidate.member_id
                left join profiles decider on decider.id = candidate.decided_by
    union all select format('request:%s:%s:%s:%s:%s',
                            requester.full_name, request.description,
                            request.status, coalesce(decider.full_name, '-'),
                            case when request.task_id is null then 'no-task' else 'linked' end)
                from completed_work_requests request
                join profiles requester on requester.id = request.requester_id
                left join profiles decider on decider.id = request.decided_by
    -- Activity rows are numerous and their ids and occurred_at move on every
    -- reset, so the fingerprint carries their shape: how many rows of each
    -- kind each Task's timeline holds.
    union all select format('activity-count:%s:%s:%s:%s',
                            task.title, task.status, activity.kind, count(*))
                from task_activity activity
                join tasks task on task.id = activity.task_id
               group by task.title, task.status, activity.kind
    -- #345 retired `task_assignees`; the `assignee:` line that read it is
    -- gone with it. The `assignment:` lines below already covered the same
    -- people on the same Tasks through `task_assignments`.
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
    union all select format('evaluation:%s:%s:%s:%s:%s:%s:%s:%s',
                            task.title,
                            member.full_name,
                            evaluation.outcome,
                            evaluation.difficulty,
                            evaluation.rating,
                            evaluation.points,
                            evaluation.source,
                            case when evaluation.reversed_at is null then 'active' else 'reversed' end)
                from task_evaluations evaluation
                join tasks task on task.id = evaluation.task_id
                join task_assignments assignment on assignment.id = evaluation.assignment_id
                join profiles member on member.id = assignment.member_id
    union all select format('ledger:%s:%s:%s', p.full_name, l.delta, l.reason)
                from points_ledger l join profiles p on p.id = l.member_id
    union all select format('event:%s:%s:%s', e.title, g.name, e.min_level)
                from events e join groups g on g.id = e.group_id
    union all select format('rsvp:%s:%s:%s', e.title, p.full_name, a.status)
                from event_attendance a
                join events e on e.id = a.event_id
                join profiles p on p.id = a.member_id
    union all select format('announce:%s:%s:%s:%s:%s', a.title, g.name,
                            a.audience, a.priority, a.pinned)
                from announcements a join groups g on g.id=a.group_id
    union all select format('notif:%s:%s:%s', p.full_name, n.kind, n.title)
                from notifications n join profiles p on p.id = n.member_id
  ) s (x);

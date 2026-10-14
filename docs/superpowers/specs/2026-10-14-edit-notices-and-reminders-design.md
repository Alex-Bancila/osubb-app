# Edit notices and reminders — design

- **Date:** 2026-10-14
- **Decided by:** Alex Băncilă, in the session of 2026-10-14 (ruling R53)
- **Status:** approved for implementation ("you can start implementing the notification"). Edit notices: #1061. Reminders: the PR that follows it.

## Decisions

Alex chose, from four questions:

1. **Edits:** every content change of an Announcement, an Event or a Task notifies the same people as the original notice. A label-only change (a Campaign, a pin) notifies nobody.
2. **Task deadlines:** the Executor only, at 09:00 Bucharest time, three days before and the day before. With less than three days left, only the day before. A Task nobody executes gets none.
3. **Events:** everyone who answered Particip, at 09:00 the day before.
4. **Announcements:** everyone the original notice reached, Deals included, at 09:00 the day before the Termen. Only Announcements with a Termen.

## What existed (main at 45de2ac7)

| Event                        | Notice                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Announcement posted          | `private.fan_out_announcement` (after insert) → `private.fan_out_announcement_row`; a pending one waits for `approve_announcement`, which fans it out once |
| Announcement edited          | nothing                                                                                                                                                    |
| Event edited                 | `update_event_impl`: audience and going, one notice per changed field among schedule, location, Group, Minimum Level                                       |
| Task edited                  | `update_task_impl`: the Executor, "Task actualizat", with the changed fields                                                                               |
| Task deadline                | cron `osubb-daily-deadline-reminders` (06:00 UTC) → `private.remind_deadlines()`: the Executor, daily while the deadline is within 48 hours                |
| Day before an Event / Termen | nothing                                                                                                                                                    |

## Design

Everything stays in the database, as the reminder job already did: edit notices in the existing commands and one Announcement trigger, reminders in one job. A scheduler outside the database would have to copy the visibility rules; a queue of scheduled reminders would need re-planning on every edit, Particip and assignment.

### 1. New or changed, per Member

Whether a Member hears that an item is **new** or that it **changed** depends on what they already did with it, not on the item: whoever **knows it** — holds a notice about it (`private.told_of`: a key `announcement:<id>` or `event:<id>:…`, read or not), opened the Announcement (`announcement_reads`), or answered the Event (`event_attendance`) — hears that it changed; whoever does not hears that it is new. Members cannot delete their notices, so this record lasts.

A per-item "already announced" flag was rejected: it would tell a moved Event's new Group, or the whole organisation once an Event moved onto OSUBB is approved, that something they never saw had "changed".

### 2. Announcements

- `private.announcement_recipients(row)`: the fan-out's audience rule, moved verbatim, shared by the first notice, an edit notice and the Termen reminder.
- `private.notify_announcement(row, actor, changed)`: "Anunț nou" / "Deal nou" with its text to whoever does not know it, "Anunț actualizat" / "Deal actualizat" to whoever does, never to the actor. Keyed `announcement:<id>`, so an unread notice is refreshed in place and opening the Announcement clears it.
- The fan-out on insert and `approve_announcement` both go through it, so BC's approval of an edit that needed approval says the Announcement changed.
- An after-update trigger: when a signed-in writer changes the content of a published Announcement (title, text, priority, Termen, Minimum Level, links, form, Deal code), its audience hears "Modificat: _câmpuri_.", followed by the current Termen when it has one. A pin, a write with nobody signed in, a decision command, or an edit that sends it back to BC notifies nobody then.
- An Announcement's Group and Audience cannot change once posted (`guard_announcement_origin`), so no edit publishes an Announcement request.
- Opening an Announcement or a Deal reads its notices by subject (`useReadNotificationsAbout`), so an "actualizat" notice is read even by a Member who had opened it before — their `announcement_reads` row already exists, so its trigger does not fire again.

### 3. Events

- `private.notify_event(event, actor, members, changed)`: "Eveniment nou" with its schedule (`event:<id>:created`) to whoever does not know it, "Eveniment actualizat" (`event:<id>:changed`) to whoever does.
- `private.notify_event_created` (create, approval, the move that publishes) goes through it with the same recipients as before.
- `update_event_impl` notifies on **any** content change — title, description, type, schedule, location, capacity, Group, Minimum Level — in one notice per edit: "Modificat: _câmpuri_", then always the current schedule and place, and the new Group or level when those changed. An unread notice is refreshed in place, so carrying the current schedule, place and Termen keeps a later edit from hiding an earlier move. A Campaign-only change notifies nobody, as before.

### 4. Tasks

Unchanged, except that a change of the Campaign alone no longer notifies the Executor.

### 5. Reminders (the next PR)

One job, `private.send_reminders(p_now timestamptz default now())`, scheduled every hour (`osubb-reminders`, minute 5). It acts only when `p_now` falls in the 09:00 hour in Europe/Bucharest, so daylight saving needs nothing. Days are counted between local calendar dates. Each reminder is sent at most once per member per day (an advisory lock and a check for any notification with the day's key, read or not). It replaces `private.remind_deadlines()` and its cron job.

| Reminder             | When (local date) | Who                                                              | Title                                                    | Kind       |
| -------------------- | ----------------- | ---------------------------------------------------------------- | -------------------------------------------------------- | ---------- |
| Task, three days     | deadline − 3      | the current Executor, To do or In progress                       | Mai sunt 3 zile: _titlu_                                 | `deadline` |
| Task, day before     | deadline − 1      | same                                                             | Termenul e mâine: _titlu_                                | `deadline` |
| Event                | start − 1         | every live Member going who can read it; approved, not cancelled | Mâine: _titlu_                                           | `event`    |
| Announcement or Deal | Termen − 1        | `private.announcement_recipients`, minus the author; approved    | Termen mâine: _titlu_ / Oferta se încheie mâine: _titlu_ | `announce` |

- A Task that gets its Executor with fewer than three days left only gets the day-before reminder, because the morning of the third day before has passed. A Task handed in for review gets none.
- Someone assigned, answering Particip or posting after 09:00 on the day before gets no reminder: they just acted. A Member whose latest notice about the Announcement arrived that same day gets no Termen reminder: it is still fresh.
- **An Event's Announcement gets no Termen reminder.** `create_event` and `approve_event` write an Announcement whose Termen is the Event's start; reminding its whole audience would contradict decision 3. `announcements.event_id` (nullable, `on delete set null`) records the Event that wrote it; existing ones are matched by Group, title, author and Termen = start. The approval stamp treats `event_id` as bookkeeping, never content.
- A critical Announcement's reminder is critical. Opening the Announcement clears its reminder too.

### Existing rules that still apply

- The kinds are the existing ones, so each Member's push settings per kind and the email digest cover every new notice.
- Suppression is unchanged: a reminder about your own Task or your own Particip is direct, not a broadcast.
- No notice ever goes to its own author or to whoever made the change.

## Tests

- `edit_notices.test.sql`: an Announcement edited while published, a refreshed unread notice, a pin, a system write, a lowered Minimum Level (new for some, changed for others), a reader without a notice, a request, an edit sent back for approval and its approval, a Deal; an Event title change, a second edit, a Campaign-only change, a move to another Group, an attendee without a notice, an edit sent back for approval and its approval.
- `update_event.test.sql`, `update_task.test.sql`, `approvals.test.sql`, `private_groups.test.sql` restate their notice expectations under R53; `tracker_grants.test.sql` lists the five new private functions.
- The reminders PR: `send_reminders` takes the time as an input, so its suite replays the days before a deadline, an Event and a Termen, including the late-October daylight-saving change.

## Out of scope

- Notifying a Task's Candidate Queue about edits (they received no original notice).
- A reminder for someone who acts after 09:00 on the day before.
- Changing who receives an Announcement or an Event notice in the first place.

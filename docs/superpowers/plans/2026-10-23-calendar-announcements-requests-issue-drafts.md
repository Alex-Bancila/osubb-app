# 2026-10-23 — attendance, expired Announcements, all-day Events, Requests anywhere, name search

Rulings taken in chat on 2026-10-23 (R61–R64), and the five issues filed from them on 2026-10-23 (#1096–#1100).
Each issue is one branch and one PR. None blocks another; they touch different files except where noted.

## Rulings

- **R61 — every BCE reads attendance.** Every BCE, BC member and the Moderator sees **Cine participă** on every Event they can read. Reading the list grants nothing else: editing and cancelling stay with the Event's managers. Amends ADR-0008's 2026-09-29 amendment ("no longer by every BCE and above").
- **R62 — expired Announcements go below.** An Announcement whose Termen has passed leaves the main feed for a second list under it, **Termen expirat**, whether it is pinned or not and whether it is read or not. Each list keeps R15's order: pinned, then unread, then read, newest first. "Passed" is measured at the page's moment (`p_as_of`), so paging stays stable. Amends R15/R56.
- **R63 — all-day and multi-day Events.** An Event may be **Toată ziua**. The box ticks itself when the end falls on a different Bucharest day from the start, and the author may untick it to keep exact times. In the month grid, an Event spanning several days draws as one bar across its days, as in Google Calendar, whether it is all-day or timed. In the day list it appears only on its first day, saying which day it ends. An all-day Event shows no times.
- **R64 — a Request for any visible Group.** A Member may file a Completed-work Request for any active Group they can see whose Minimum Level they meet, member of it or not. A Private Group they are not in stays hidden and refused exactly as an unknown Group. Amends the "where the live caller holds a Group Role or membership" rule of `create_completed_work_request`.

---

## #1096 — BCE read every Event's attendance (R61)

Labels: `ready-for-agent`, `page-calendar`

## Goal

Every BCE, BC member and the Moderator sees **Cine participă** (the RSVP tally and names) on every Event they can read, not only on Events they manage.

## Why

Ruling R61 (2026-10-23). BCE need to see who comes to OSUBB activities across Groups. The 2026-09-29 amendment of ADR-0008 narrowed this to managers; R61 reverses that for reading only.

## Implementation boundary

- New migration: widen the `event_attendance_read` policy (newest definition is in `20260929220000_event_rsvp_managers.sql`) with a separate limb: `coalesce(private.actor_level(), -1) >= 5 and private.can_read_event(event_attendance.event_id)`. **Do not** widen `private.can_manage_event`, because it also gates `update_event` and `cancel_event`.
- Frontend: `app/src/screens/calendar/EventAttendance.tsx` gates on a new "reads attendance" check (manager, or level ≥ 5 from `useCapabilities`) instead of `managesEvent`. The edit and cancel controls in `EventCard.tsx` keep `managesEvent`.
- Amend ADR-0008 (who reads the RSVPs) and add the rule to `CONTEXT.md` under RSVP.

## Acceptance criteria

- A BCE who manages nothing sees the tally and the names on any Event they can read.
- A BCE still cannot edit or cancel an Event they do not manage, in the UI or by RPC.
- An activ, vot, voluntar or recrut Member still sees only their own answer.
- A BCE sees no attendance for an Event they cannot read (e.g. a Private Group's Event).

## Required tests

- pgTAP in `supabase/tests/rls_event_attendance.test.sql`: a BCE non-manager reads others' rows, a level-4 Member does not, and a BCE gets no rows on an unreadable Event. Removing the new limb must fail these tests.
- pgTAP: `update_event` and `cancel_event` still refuse a BCE non-manager.
- vitest: `EventAttendance` renders for a BCE non-manager and not for a level-4 Member.

## Blocked by

None — can start immediately.

---

## #1097 — Expired Announcements in a list of their own (R62)

Labels: `ready-for-agent`, `page-anunturi`

## Goal

In Anunțuri, every Announcement whose Termen has passed appears in a second list, **Termen expirat**, under the Announcements with no Termen or a Termen still ahead.

## Why

Ruling R62 (2026-10-23). An expired call to action ("Completează formularul" after the deadline) should not hold the top of the feed.

## Implementation boundary

- New migration replacing `public.announcement_feed` (newest definition in `20261014220000_announcement_feed.sql`). Add a first sort key before R15's: `case when feed.deadline is not null and feed.deadline < coalesce(p_as_of, now()) then 1 else 0 end`. Also return a column, e.g. `expired boolean`, so the page knows where the second list starts. Paging stays the server's.
- `app/src/queries/announcements.ts` carries `expired`. `AnnouncementsScreen.tsx` splits the loaded rows at the first expired row and renders a second `PageGrid` under a **Termen expirat** heading. The heading appears only once an expired row has loaded.
- The critical banner, the unread count and `announcement_feed_summary` are unchanged.
- Update R15's text in the migration header and in `docs/superpowers/specs/2026-10-14-member-reads-design.md` to name R62.

## Acceptance criteria

- An expired Announcement is listed after every non-expired one, including when it is pinned or unread.
- Inside each list the order is R15's.
- An Announcement whose Termen passes between two page loads does not jump between pages (`p_as_of`).
- An Announcement with no Termen is never in the expired list.

## Required tests

- pgTAP in `supabase/tests/announcement_feed.test.sql`: pinned+expired sorts after unpinned+read+not-expired, `expired` is true only past the Termen at `p_as_of`, and pages cut at `p_as_of` are stable.
- vitest in `AnnouncementsScreen.test.tsx`: the heading and the second list appear, in the server's order.

## Blocked by

None — can start immediately.

---

## #1098 — All-day and multi-day Events (R63)

Labels: `ready-for-agent`, `page-calendar`

## Goal

An Event can be **Toată ziua**, and an Event spanning several days shows as one bar across them in the month grid, as in Google Calendar.

## Why

Ruling R63 (2026-10-23). OSUBB runs weekend trips, festivals and multi-day campaigns; today an Event shows only on its start day and always with times.

## Implementation boundary

- Migration: `events.all_day boolean not null default false`. An all-day Event is stored from 00:00 Bucharest on its first day to 00:00 Bucharest after its last day (end exclusive). A check constraint plus the commands enforce this. `create_event`/`update_event` take `p_all_day` (rebuilt from `main`'s newest definitions); `ends_at` is required when `all_day`. Regenerate `database.types.ts`.
- Event form (`EventForm.tsx`): a **Toată ziua** checkbox. Ticked, the pickers choose dates only. When the end's Bucharest day differs from the start's, it ticks itself once; the author can untick it, and changing a date afterwards does not re-tick it over the author's choice.
- Month grid (`CalendarMonth.tsx`, `calendar-presentation.ts` `itemsByDay`): a multi-day Event (all-day or timed) draws as a continuous bar from its first to its last day, broken at week rows and clamped to the visible month, laid out in lanes so that overlapping bars don't collide. Single-day timed Events keep today's chips.
- Day list (`CalendarAgenda`, `EventCard`): the Event is listed on its first day only. Its time line reads e.g. "Toată ziua · până duminică, 26 oct." or "vin., 24 oct., 18:00 → dum., 26 oct., 14:00".
- Every other reader of Event times: Acasă **Urmează**, Notifications and push text, the Announcement published with an Event (its Termen = start), and an RSVP's "past" test, which uses the end for a multi-day Event.
- Amend ADR-0008 and `CONTEXT.md` (Event).

## Acceptance criteria

- Ticking **Toată ziua** stores midnight-to-midnight Bucharest bounds and shows no times anywhere.
- Picking an end on another day ticks the box; unticking keeps exact times and the bar still spans the days.
- A 3-day Event shows one bar across 3 cells, wrapping correctly over a week boundary and a month boundary.
- In the day list the Event is under its first day only, with its end day named.
- DST days (last Sunday of March and October) keep all-day bounds on Bucharest midnights.

## Required tests

- pgTAP: the `all_day` constraint, the command arguments, and refusal of an all-day Event without an end or with non-midnight bounds.
- vitest: the bar layout (spans, week wrap, lanes, month clamp), the auto-tick rule, and the agenda's end-day text.

## Blocked by

None — can start immediately. It touches `EventCard.tsx`, as #1096 does: merge #1096 first or rebase.

---

## #1099 — File a Request for any Group you can see (R64)

Labels: `ready-for-agent`, `page-taskuri`

## Goal

A volunteer can file a Completed-work Request (Cereri) for work done for any active Group they can see whose Minimum Level they meet, not only for their own Groups.

## Why

Ruling R64 (2026-10-23). Volunteers help other Departments and Projects. Today the server refuses with `request_origin_forbidden` unless the requester holds a Group Role or membership there (`private.create_completed_work_request_impl`, newest in `20261007180000_preferred_groups.sql`).

## Implementation boundary

- Migration rebuilding `private.create_completed_work_request_impl` from `main`'s newest body. It replaces the `group_role_of(...) is null` refusal with: the Group is active, `private.can_see_group(p_group_id, v_actor)`, and the requester's level ≥ the Group's `min_level`. An unseen Group stays `42501 request_origin_forbidden` (nondisclosing). Keep the 30-per-24-hours limit and the decider Notifications.
- Rewrite the function's comment.
- Frontend: the Group picker in `app/src/screens/requests/RequestsView.tsx` offers the same set. Its query is in `app/src/queries/completed-work-requests.ts`, or a new read if the current one returns only the Member's Groups.
- `CONTEXT.md` (Completed-work Request): state who may file for which Group.

## Acceptance criteria

- A voluntar files a Request for a Department they are not in, and its deciders are notified.
- A Private Group the voluntar is not in is neither offered nor accepted.
- A Group with a Minimum Level above the voluntar's is neither offered nor accepted.
- An inactive Group is refused.

## Required tests

- pgTAP in `supabase/tests/completed_work_request_commands.test.sql`: rework the `request_origin_forbidden` cases. A non-member visible Group succeeds; private, min-level, inactive and unknown Groups refuse. Reverting the rule must fail the new success case.
- vitest: the picker lists a visible non-member Group.

## Blocked by

None — can start immediately.

---

## #1100 — Find a Member by Nickname or real name, everywhere

Labels: `ready-for-agent`, `shared`, `max-1h`

## Goal

Every Member search and picker finds a Member by their Nickname or their full name, case- and diacritic-blind.

## Why

A picker that shows only the Nickname (R5) cannot be searched by the real name, and the reverse. Membri (`directory-filters.ts`) and Administrare → Membri (`AdminMembersTab.tsx`) already match both; the pickers do not.

## Implementation boundary

- One shared helper (e.g. `memberSearchText(nickname, name)`, reusing `normalizeSearch`). Every member Combobox filters on it: `components/tasks/VolunteerPicker.tsx` (today `name` is the Nickname-or-name only), `screens/tracker/DirectExecutorSelector.tsx`, `screens/administrare/MemberPicker.tsx` (with the Group Roles, Roster, Role and Deals team panels that use it), and the Work Filter's member field.
- Where a row carries only the display name, add the full name to the row from its existing query. Load no new data.
- The visible label does not change: still the Nickname when set.

## Acceptance criteria

- In each picker, typing part of the real name finds a Member who has a Nickname, and typing the Nickname finds them too.
- "stefan" finds "Ștefan".

## Required tests

- vitest for the helper, and one picker test per picker family: a Member found by the full name while displayed by the Nickname.

## Blocked by

None — can start immediately.

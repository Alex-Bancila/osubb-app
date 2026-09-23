# ADR-0008 — Calendar visibility, relevance, and management

- **Status:** Accepted
- **Date:** 2026-09-07
- **Amended:** 2026-09-18 — ADR-0009: an Event is owned by one Group; the `org`/`dept`/`team`/`project` scope and the per-scope management table are read through Group Roles; Minimum Level choices become 0, 3, 5, 6
- **Amended:** 2026-09-20 — ADR-0009 Wave 2 as built: `create_event` takes the owning Group, `update_event` and `cancel_event` join it, and the level-4 Calendar gate is gone (see the ADR-0009 header for the exact signatures)
- **Amended:** 2026-09-20 — the relevant audience of an Event is its Group's Group Audience (Automatic Membership resolved, every Group below included); archiving a Group cancels its future Events
- **Amended:** 2026-09-23 — past Events readable under the same Minimum Level rule; an Event may carry one Campaign; the month view and the Work Filter
- **Deciders:** Alex Băncilă + team
- **Supersedes:** —
- **Superseded by:** —
- **Related:** ADR-0001, ADR-0003, ADR-0007, `CONTEXT.md`

> **Amended 2026-09-18 by ADR-0009.** Event Scope is the owning Group; organization-wide Events belong to the Organization Group. Read the Event management table as: a Group's Managers and Responsibles, and its ancestors', manage its Events; anyone holding a Group Role may create an Organization Group Event, which only its creator or BC/Moderator edits. `create_event`, `update_event`, and `cancel_event` enforce these Group rules; update and cancellation preserve the creator-only Organization Event rule with BC/Moderator override. "Responsible+" (level 4) is retired as a Minimum Level choice. Visibility, relevance, RSVP, capacity, and notification rules stand, with "the member's Departments, Teams, and Projects" read as "the member's Groups".

> **Amended 2026-09-20 — the enforced shape.** `events_min_level_ck` now admits only `{0, 3, 5, 6}`, and the rows that stood at 4 were moved **up** to 5, never down. An Event's Minimum Level may not fall below its Group's, and a creator may not set one above their own Level. No Calendar command reads a level-4 rank any more; `events` carries a read policy and no client write policy at all, so `create_event`, `update_event`, and `cancel_event` are the only ways in. Wave 3 removed the old scope enum and derived columns; `events.group_id` is the sole Origin.

## Context

The first Calendar implementation uses scope mainly as a visibility boundary and grants every level-4 coordinator the same write authority. OSUBB instead needs members to discover activities across the organization while preserving AG/leadership restrictions, making their own groups easier to scan, and limiting event management to the correct Origin managers.

This ADR defines the target Calendar behavior. Capacity remains informational; waitlists, QR attendance, and hard admission limits remain out of scope.

## Visibility

Every active OSUBB member, including a Recrut, may read every **future** Event whose Minimum Level they satisfy, regardless of Event scope. Future means `starts_at >= current instant`. Ordinary members do not receive past Events in this phase.

Minimum Level is selected from these organization concepts:

| Choice              | Required role level |
| ------------------- | ------------------: |
| Everyone            |                   0 |
| AG / Voting Member+ |                   3 |
| Responsible+        |                   4 |
| BCE+                |                   5 |
| BC+                 |                   6 |

An Event creator cannot choose a Minimum Level above their own organizational level. Moderator retains global override.

Scope identifies Event ownership and relevance, not ordinary-member secrecy:

- `org` — organization-wide;
- `dept` — one Department;
- `team` — one Department Team or Independent Team;
- `project` — one Project.

The schema enforces the valid foreign-key combination for each scope.

## Relevance ordering

The frontend presents two chronological groups:

1. **Primary:** organization Events and Events from the member's Departments, Teams, and Projects.
2. **Other OSUBB Events:** visible Events from scopes the member does not belong to, rendered in a visually neutral gray treatment.

Within each group, Events are ordered by their exact instant. Department-linked Events use the official Department color. Organization, Project, and Independent-Team Events use OSUBB red plus a textual scope label. Color is never the only cue.

When a member answers **Vin** to an Event in the second group, it moves into the primary group and receives its normal context treatment. Answering **Nu vin** moves it back. RSVP does not change authorization or membership.

## RSVP and capacity

An active member may answer `going` or `declined` for any Event they can read. The server derives the member from `auth.uid()`, revalidates visibility, and upserts only that member's Attendance row atomically. A member never writes `checked_in`.

Capacity is displayed as information. It does not block RSVP and does not create a waitlist.

## Event management

Event creation, editing, and cancellation use server commands with the actor derived from `auth.uid()`.

- **Organization Event:** any Responsible+ may create it; only its creator or BC/Moderator may edit or cancel it.
- **Department Event:** local BCE, BC, or Moderator.
- **Department-Team Event:** BCE from the parent Department, BC, or Moderator.
- **Independent-Team Event:** any active member of that Team.
- **Project Event:** Project lead or Project Responsible.
- **Global override:** BC or Moderator.

The command derives a Team's Department rather than trusting a client-supplied Department. Project and Team managers must hold an active membership. Unsupported or inconsistent scope relationships are rejected.

Cancellation requires a nonblank reason and preserves Event and audit history. Deletion is not a public v1 operation.

## Important-change notifications

An edit is important when it changes date/time, location, scope, Minimum Level, or cancellation state. Important changes create targeted in-app notifications for the Event's relevant audience and current attendees. Text/description and capacity edits do not fan out.

Members outside the Event Origin may discover it in the gray group, but that visibility alone never subscribes them to unsolicited notifications. An actor never receives an echo of their own action.

Member Web Push delivery is a later architecture decision. Calendar commands write the same deduplicated in-app notification model regardless of the future transport.

## Consequences

- Scope-specific RLS helpers and commands replace the legacy level-4 global write rule.
- The existing Event schema needs Minimum Level, Project support, cancellation state/reason, valid-scope constraints, and supporting indexes.
- Existing RSVP behavior must be revalidated because cross-scope visibility is broader than membership.
- The frontend must calculate relevance from authorized membership plus the current member's RSVP and must not hide gray Events through client-only filtering.
- The last Ionic Calendar components are removed only after the equivalent shadcn screen, forms, and tests are complete.

## Amendment (2026-09-20) — audience and archiving

**The relevant audience is the Group Audience.** "The Event's relevant audience" in §Important-change notifications, and "the member's Groups" in §Relevance ordering, mean the Event's Group's **Group Audience** as ADR-0009 (amended 2026-09-20) and `CONTEXT.md` define it: every active Member of that Group or of any Group below it, by roster row or by Automatic Membership. An organization-wide Event therefore reaches every active Member on an important change, and a Department Event reaches its Department Teams' members even when they are not on the Department's own roster. No fan-out joins the roster table directly; one server helper resolves the audience. Attendees who answered "Vin" remain part of the audience regardless of membership, as before.

**Archiving a Group cancels its future Events.** When a Group is archived (which ADR-0009 permits only once its work is finished), its future Events and those of every Group below it are cancelled by the same command with the archiving reason, preserving Event and audit history exactly as a manual cancellation does. Past Events stay readable as history.

## Amendment (2026-09-23) — history, Campaigns, and the month view

**Past Events are readable.** §Visibility's "future" restriction is lifted: every active Member reads every Event, past or future, whose Minimum Level they satisfy. Events carry nothing personal, and a month view without its own past days is not a calendar. Relevance, RSVP, and notification rules are unchanged; RSVP stays meaningful only on future Events.

**An Event may carry one Campaign.** `events.campaign_id` is nullable and, like a Task's, must name a Campaign owned by the Event's Group or by a Group above it on its path; `create_event` and `update_event` set it, and a Campaign change alone is not an important change. Campaigns remain labels: they earn points only through Tasks and never decide who may see or manage an Event.

**Month view and filter.** The Calendar offers a month grid beside the agenda. A day shows the Events the Member may read and the deadlines of the Member's own Tasks (Executor or pending Candidate), with a manager-only toggle adding the Tasks they manage. The Work Filter (`CONTEXT.md`) narrows both, with its date range on the Event start. Colours follow the Tracker's rule: the Member's own Groups in their colour, the Organization Group in OSUBB red, Other OSUBB Events grey (grilling of 2026-09-23).

## Amendment (2026-09-24) — Wave 3 cleanup

An Event belongs to one Group. Organization behavior comes from `groups.is_organization`, and Group Audience drives notification recipients. The attendance read threshold for other Members is level 5; self attendance still requires that the Event itself is visible.

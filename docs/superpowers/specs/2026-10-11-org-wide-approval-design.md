# OSUBB-wide Announcements and Events pending BC approval — design

Date: 2026-10-11. Status: approved in conversation by Alex (the decisions below are his words of 2026-10-11); this document is the binding spec for the plan that implements it.

## Decision

An **Announcement or Event on the Organization Group** ("OSUBB-wide") written by anyone **below BC** (a BCE, a Group Manager or Responsible) is not published at once: it becomes a **Cerere de aprobare** (an approval request) that a BC member or the Moderator approves or rejects. BC and the Moderator keep publishing OSUBB-wide items directly. Local Group Announcements and Events are untouched.

Alex's rules:

- "A BCE can create an organization-wide event/announcement": the right to write one stays as today (`private.can_publish_announcement`, `create_event`'s Organization-Group rule) and is not widened or narrowed; everyone below level 6 goes through approval.
- "A rejection reason is required."
- "Editing an approved item re-enters review" (an edit by its author; an edit by BC/Moderator never does).
- Approval works "the same as for tasks": BC opens the item's own form, edits whatever needs editing, and approves from there; the item stays **posted by its original author** (`created_by` never changes, as the authorship trigger already guarantees).
- The requests live behind an **icon with a count**, like the notifications bell, "only when requests exist": in Calendar on the row of the Taskurile gestionate control, in Anunțuri beside Filtrează.

## Model

Both `public.announcements` and `public.events` gain:

| Column                | Type                                                                      | Meaning                                                                |
| --------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `approval_status`     | `text not null default 'approved' check in (pending, approved, rejected)` | `approved` for every existing row and for anything BC/Moderator write. |
| `approval_decided_by` | `uuid references profiles (id)`                                           | Who approved or rejected it last; null while pending.                  |
| `approval_decided_at` | `timestamptz`                                                             |                                                                        |
| `rejection_reason`    | `text`                                                                    | Required (1–1000 characters) when rejected, null otherwise (`check`).  |

`events` also gains `announce_on_approval boolean not null default false`: an OSUBB-wide Event created with "Creează și un anunț" by someone below BC does not write its Announcement yet; approval writes it (see Commands).

**Which rows are pending.** A row is written `pending` when its Group is the Organization Group and the writer's live level is below 6:

- Announcements are inserted by the client under RLS, so a `before insert` trigger (`announcements_approval_stamp`, beside the authorship trigger) sets the status from `auth.uid()`'s level; a client value is ignored.
- Events are written by `create_event`, which sets the status itself.
- Every other row (local Group, or a BC/Moderator author) is `approved`.

**Re-entering review.** A `before update` trigger on each table: when the row is OSUBB-wide, the actor's level is below 6 and a content column changes (title, body/description, dates, place, capacity, links, Minimum Level, Audience, Priority, pinned, Campaign, type, deadline), the status goes back to `pending` and the decision columns are cleared. BC/Moderator edits never change the status. The authorship trigger keeps `created_by`.

**Who sees a pending or rejected row.** The read rule of each table gains one condition: `approval_status = 'approved'`, or the caller is the author, or the caller's live level is ≥ 6 (`events_read`; `announcements_read`, with `private.can_read_announcement` unchanged and the condition added beside it). Everything that reads through these rules follows: the Calendar and Relevant Events, the Anunțuri feed, the unread badge, the critical banner, the readers list, the Member's agenda, Web Push and Email Digest selections.

**Notifications.**

- Nothing is fanned out for a pending row: the Announcement `after insert` fan-out and `create_event`'s "Eveniment nou" notice both skip it.
- On approval the normal fan-out runs once, as if the item had just been published (the same recipients, dedupe keys and push).
- When a row becomes pending (new or re-entered), every live BC member and the Moderator get one Notification, kind `announce` or `event`, title "Cerere de aprobare: <title>", body "<author> · <Group>", link to the item, dedupe key `approval:<kind>:<id>` (one per pending spell). Grupuri preferate do not silence it (the Organization Group is always preferred).
- On a decision the author gets one Notification: "Anunțul tău a fost aprobat" / "Evenimentul tău a fost aprobat", or "… a fost respins" with the reason in the body.

**Commands** (conventions: `public.<verb>_<noun>` over `private.<verb>_<noun>_impl`, security definer, empty `search_path`, four-role revoke then grant to `authenticated`):

- `approve_announcement(p_id)`, `approve_event(p_id)`: level ≥ 6 only (42501 `approval_forbidden`); the row must be pending (PT409 `not_pending`); sets `approved` with the decider and time; runs the fan-out; `approve_event` with `announce_on_approval` also inserts the Event's Announcement as the original author (the same body `create_event` would have written) and clears the flag.
- `reject_announcement(p_id, p_reason)`, `reject_event(p_id, p_reason)`: the same gate; `p_reason` trimmed 1–1000 characters else PT400 `rejection_reason_required` / `rejection_reason_too_long`; sets `rejected` with the reason; notifies the author.
- `approval_requests()`: BC/Moderator read of the pending rows of both tables in one list — `kind`, `id`, `title`, `group_id`, `created_by`, `created_at`, `starts_at` (Events) — newest first; empty for everyone else. The two icons' counts come from it.

Editing by BC is not a new command: the existing paths (`update_event`; the Announcement row update under `announcements_update`) save the edits, then the approve command runs. If the approve command refuses, the edit stands and the item stays pending.

## Interface

**The request icon.** One small icon button (`MailQuestion` from lucide, or the closest "request" glyph the kit already uses), 44 px hit area, with the count in a destructive badge as the notifications bell shows its count; accessible name "Cereri de aprobare, n". **Rendered only when the count is above 0** and the viewer is BC/Moderator. Places:

- Calendar: beside the Taskurile gestionate toggle in the month view, on its row; the Agendă view shows the same icon at the head of its list, in the same position.
- Anunțuri: in the page header's action row, beside Filtrează, before the compose button.

**The requests sheet.** Tapping the icon opens a sheet "Cereri de aprobare" listing the pending items of that page's kind (Events in Calendar, Announcements in Anunțuri): title, author (Member Card), Group, when it was asked, and for an Event its date. Tapping a row opens the item's **own form** — the Event form or the Announcement edit sheet — in review mode.

**Review mode** of the existing forms: every field editable as for the author; the footer reads **Respinge** (outline) and **Aprobă și publică** (primary). Aprobă saves the edits if any, then approves; a refusal shows under the field it names or in the form's error slot. Respinge opens a small dialog "Motivul respingerii" with a required textarea (the server's 1–1000 rule) and a destructive "Respinge" button. After either, the sheet closes, the list refreshes, and the page shows a receipt ("Anunțul a fost publicat." / "Evenimentul a fost respins.").

**For the author.** A pending item shows an "În așteptare" badge on its card and in its details; a rejected one shows "Respins" with the reason and an "Editează" that re-submits on save (the trigger returns it to pending). An approved item looks as today.

**Compose and create.** Nothing changes in the forms except the receipt for a writer below BC posting OSUBB-wide: "Anunțul așteaptă aprobarea BC." / "Evenimentul așteaptă aprobarea BC." (and "… cu anunțul lui" when the Event asked for one).

## Tests

- pgTAP: a new `approvals.test.sql` with the stamp (BCE OSUBB-wide → pending; BC → approved; a local Group → approved), visibility (pending invisible to a third Member, visible to the author and BC), no fan-out while pending and the normal fan-out on approval, the BC request Notification and its dedupe, approve/reject by each actor, the required reason, re-entry on an author's edit and not on BC's, `announce_on_approval` publishing the Announcement on approval as the original author, `approval_requests()` empty for non-BC. The claimless sweep stays green. Every assertion fails if its rule is reverted.
- Vitest: the icon hidden at 0 and shown with the count; the requests sheet listing and opening the forms; review mode's two actions and the reason dialog; the author badges and receipts; the queries.

## Documents

- ADR-0008 amended by reference (an OSUBB-wide Event by a writer below BC is pending until BC approves it).
- `CONTEXT.md` gains **Cerere de aprobare** and amends Announcement and Event.
- `docs/backend/conventions.md` gains the new reasons.
- The grill plan gains ruling R49 with Alex's words above.

## Out of scope

Approval of local Group items; a history of decisions beyond the last; bulk approval; editing the author.

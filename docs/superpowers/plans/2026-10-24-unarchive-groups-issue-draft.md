# 2026-10-24 — Arhivate and unarchiving Groups (R65)

The ruling was taken in chat on 2026-10-24; the issue below was filed as #1110.

## Ruling

- **R65 — archived Groups have their own view and can come back.** Administrare → Grupuri gains a third view, **Arhivate**, beside **Toate** and **Conduse de mine**. Toate and Conduse de mine list active Groups only, and every archived Group the viewer can see is in Arhivate. Whoever may archive a Group may unarchive it: BC or the Moderator for a top-level Group, a Group Manager on the path for a Child Group. Unarchiving mirrors archiving. The Group and every archived Group below it become active again, after a confirmation that lists them. A Child Group cannot be unarchived while its parent is archived. Unarchiving brings back nothing that archiving ended: cancelled Events stay cancelled, declined Applications stay declined. Rosters, Group Roles, settings and history were kept, so they are simply there again.

---

## #1110 — Arhivate: see archived Groups and unarchive them (R65)

Labels: `ready-for-agent`, `page-administrare`

## Goal

In Administrare → Grupuri, a third view, **Arhivate**, lists every archived Group the viewer can see, and lets whoever may archive a Group unarchive it, together with its archived subgroups.

## Why

Ruling R65 (2026-10-24). Today an archived Group sits in Toate with an **Arhivat** badge, and nothing can bring it back. `public.archive_group` (newest in `20260922224243_group_applications.sql`) has no inverse. A Group archived by mistake, or a yearly project that returns, can only be created again from scratch, which loses its history and Department Cup attribution.

## Implementation boundary

- **New command `public.unarchive_group(p_group_id bigint)`** with a `private.unarchive_group_impl`. Follow `archive_group_impl`'s shape, authority and locks (docs/backend/conventions.md: parent/Umbrella rows `for no key update`):
  - Authority is the same rule as archive and delete-for-good: BC or the Moderator for a top-level Group, `private.require_group_manager` on the path for a Child Group. A refusal is `42501 group_manage_forbidden`.
  - `PT409 group_not_archived` when the Group is active.
  - `PT409 group_parent_archived` when its parent is archived.
  - It sets the Group and every archived Group below it to `active` in one statement.
  - It touches no Event, Application, Task or roster.
  - Comment, grants and revokes follow the conventions.
- **A preview read** so the confirmation can list what returns. It could be a `public.unarchive_group_preview(p_group_id)` returning the subgroups, or the client can derive it from the Groups it already reads, if that set is exact (state which in the PR).
- **Frontend (`app/src/screens/administrare/AdminGroupsTab.tsx`):**
  - The `ViewToggle` / `SegmentedToggle` ("Grupuri afișate") gains **Arhivate**, with URL state like Conduse de mine's `?vedere=conduse` (e.g. `?vedere=arhivate`).
  - Toate and Conduse de mine drop archived Groups.
  - Arhivate shows the archived Groups as a tree. An active parent appears as context when only a child is archived, the way Conduse de mine shows context parents.
  - Each archived Group the viewer may unarchive gets a **Dezarhivează** action.
  - Its confirmation names the Group and lists the subgroups that return, and says that cancelled Events and declined Applications stay as they are.
  - Hide or disable the action, with the reason, when the parent is archived.
  - The Group page (`/administrare/grupuri/:id`) of an archived Group offers the same action where it shows the archived state today.
  - The empty state reads "Niciun grup arhivat."
- **Other lists:** check every other place that lists Groups for the viewer (Grupuri for Members, pickers, Clasament filters) still behaves. They should already read active Groups, and an unarchived Group simply reappears.
- **Docs:** add an amendment to ADR-0009 (2026-10-24, ruling R65), add unarchiving to `CONTEXT.md` (the lifecycle and archiving text), and list the new error codes in `docs/backend/conventions.md`.

## Acceptance criteria

- Toate and Conduse de mine list no archived Group. Arhivate lists every archived Group the viewer can see.
- BC unarchives a top-level Department archived with two subgroups. All three are active again, rosters and Group Roles intact, and its Events are still cancelled.
- A Group Manager on the path unarchives a Child Group. A Member who may not archive it gets no action, and the RPC refuses them with `42501`.
- Unarchiving a Child Group whose parent is archived is refused with `PT409 group_parent_archived`, and the UI says why.
- Unarchiving an active Group is refused with `PT409 group_not_archived`.

## Required tests

- pgTAP for `unarchive_group`:
  - the subtree returns;
  - Events and Applications are untouched;
  - authority holds for each actor kind;
  - the three refusals fire;
  - grants and conventions hold (`tracker_grants` roster).
- A mutation check: drop the subtree clause, and the subtree test must fail.
- vitest:
  - the third view and its URL state;
  - Toate without archived Groups;
  - the confirmation listing subgroups;
  - the hidden action for non-managers and the disabled one under an archived parent.

## Blocked by

None — can start immediately.

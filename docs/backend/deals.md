# Atribuții, OSUBB Deals and five Attached Links

The server contract behind rulings R44, R45 and R46 (2026-10-07, `docs/superpowers/plans/2026-09-23-prod-readiness-grill.md`). Three migrations carry it: `20261007190000_attached_links_five.sql` (R46), `20261007190100_bc_assignments.sql` (R44) and `20261007190200_osubb_deals.sql` (R45). Vocabulary: **Atribuție**, **Deal**, **Deal Code**, **Attached Link** in `CONTEXT.md`.

## Atribuții (R44)

An Atribuție is a named responsibility the Moderator gives to exactly one BC member. The only one today is `osubb_deals`, **Responsabil OSUBB Deals**; adding another is a new value in `bc_assignments_assignment_ck`, in the commands' step-1 lists and in `private.assignment_label`.

| Object                                                                                 | What it is                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.bc_assignments`                                                                | One row per held Atribuție (primary key `assignment`), so there is exactly one holder. Readable by every live Member; no direct writes.                                                                                                         |
| `public.assignment_team`                                                               | The holder's team: at most one `coordinator` and one `responsible` (primary key `(assignment, team_role)`), never one person twice. Cascades away with the Atribuție. Readable by every live Member; no direct writes.                          |
| `public.set_bc_assignment(p_assignment, p_member_id, p_granted, p_move default false)` | The Moderator gives or takes away an Atribuție.                                                                                                                                                                                                 |
| `public.set_assignment_team_member(p_assignment, p_team_role, p_member_id)`            | The holder sets either place; the Coordonator sets only the Responsabil. A null member clears the place.                                                                                                                                        |
| `public.bc_assignments_directory()`                                                    | The Moderator's Administrare BC list: every live BC member (and any holder who no longer is one, `is_bc` false) with `assignments: [{assignment, label, granted_at, granted_by, team: [{team_role, member_id, full_name, nickname, set_at}]}]`. |
| `private.assignment_team_role(p_assignment, p_member)`                                 | The one live definition: `holder` (holds it and is live bc), `coordinator` (live bce), `responsible` (live activ), or null. Every capability, policy and command reads it; nothing reads the token.                                             |

**Granting** needs a live BC target (`PT400 bc_assignment_not_bc`). While someone else holds it, `PT409 bc_assignment_held` unless `p_move`, which replaces the holder and keeps the team (a new holder who was the Responsabil leaves that place). Two first grants at once serialize on a transaction advisory lock, so the second hears `bc_assignment_held`, not a unique violation. **Taking it away** from its holder deletes the row and the team and tells the three. Taking it from anyone else, or giving it again to its holder, changes nothing.

**Notifications** (kind `system`): the new holder "Ai primit atribuția Responsabil OSUBB Deals" (`/administrare/deals`); a removed or moved-from holder, the Coordonator and the Responsabil "Atribuția Responsabil OSUBB Deals a fost retrasă" (no link); a team member set "Ești acum Coordonator/Responsabil OSUBB Deals" (`/administrare/deals`), the one replaced or cleared "Nu mai ești Coordonator/Responsabil OSUBB Deals".

**Capabilities** (`public.my_capabilities()`, mapped in `app/src/lib/capabilities.ts`): `administer_bc` (live Moderator), `manage_deals` (any place in the team), `manage_deals_team` (holder or Coordonator), `pick_deals_coordinator` (holder); `administer` is also true for `manage_deals`, so a Responsabil reaches Administrare with only the OSUBB Deals tab.

## OSUBB Deals (R45)

A Deal is a row of `public.announcements` with `kind = 'deal'` and an optional `code` (the Deal Code). Publishing, editing and deleting stay direct writes under RLS.

- **Shape.** Organization Group, Audience `org`, Minimum Level 0, priority `normal`, not pinned: `announcements_guard_settings` answers anything else with `23514 invalid_deal_settings` (and `announcements_deal_shape_ck` holds the column part underneath). The code is trimmed (blank is none), at most 80 characters, and only on a Deal. `kind` never changes after insert (`23514 announcement_kind_immutable`).
- **Publish.** `announcements_create` reads `private.can_publish_announcement(group_id, kind)`: for a Deal, a place in the OSUBB Deals team; for an Announcement, the rule it always had. Deals count against the `announcement` daily cap (20 per author in 24 hours).
- **Edit and delete.** `private.can_manage_deal(created_by)`: BC and the Moderator (live level ≥ 6) and the holder and Coordonator any Deal, the Responsabil their own. Leftover Deals of a dissolved team stay deletable by BC and the Moderator.
- **Read.** `private.can_read_announcement(…, kind, deadline)`: every live Member until the Termen; afterwards only the team and live level ≥ 6. The unread badge, `public.my_unread_announcements_count(p_kind default null)`, counts one tab when asked and never an expired Deal.
- **Fan-out.** The organization-wide Announcement rule (R32, R43), titled "Deal nou: <titlu>", linking `/anunturi/deals?deal=<id>`, subject `announcement:<id>`. The readers list (`announcement_readers`) is open to the team for a Deal.
- **Deal Code reveal.** `public.reveal_deal_code(p_announcement_id)` returns the code to a live Member who can read the Deal and records one `public.deal_code_reveals` row (idempotent; nothing is recorded for a Deal without a code). A Member reads their own reveals (PostgREST can embed `deal_code_reveals(revealed_at)` beside `announcement_reads(read_at)`); the team, BC and the Moderator read the count through `public.deal_code_reveal_count(p_announcement_id)`. `deal_code_reveals` is excluded from the live-change broadcast: a personal record nobody else watches live.

## Five Attached Links (R46)

`announcements.links` and `tasks.links` are jsonb arrays of at most five `{label, url}` objects (`*_links_ck`). `private.require_attached_links(p_links, p_label, p_url)` judges and normalizes a list: each link by the one-link rule (`link_incomplete`, `link_label_too_long`, `link_url_too_long`, `link_url_invalid`), plus `invalid_links` (not a list, or an element that is not a `{label, url}` object) and `too_many_links`; labels and addresses are trimmed and a wholly blank row dropped.

- **Tasks.** `create_task`, `update_task`, `preview_task_update`, `create_completed_task` and `approve_completed_work_request` take `p_links` (`PT400` at step 1). `update_task` and `preview_task_update` default it to null — not sent — and the others to `[]`; when it is null or empty and the old `p_link_label`/`p_link_url` pair is given, the pair is the one link. `update_task` is a full-state replace: a sent `[]` clears the links, and a pair-only call from an old app leaves exactly that one link. An edit names `links` in `task_updated`'s `changed`/`before`/`after` (label "linkuri"). `duplicate_task` copies the list; `leadership_member_tasks` returns it. `submit_task_for_review`'s Submission Note link and a Group's application form stay single.
- **Announcements.** The app writes `links` directly; `announcements_guard_text` judges it and answers as `23514` with the same reasons.
- **The old pair, for one release.** Both tables were backfilled from `form_label`/`form_url` and `link_label`/`link_url`, which now mirror `links[0]` on every write (`announcements_guard_text`, `tasks_mirror_links`). A write from an app version before R46 that changes only the pair has it taken as `links[0]`, keeping the other links. The follow-up issue drops the pair, the mirror and the legacy RPC parameters after the links column has shipped.

## Error reasons

| Code    | Reasons                                                                                                                                                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `42501` | `bc_assignment_forbidden`, `assignment_team_forbidden`, `deal_code_forbidden`                                                                                                                                                                   |
| `PT400` | `invalid_assignment`, `bc_assignment_not_bc`, `granted_required`, `invalid_team_role`, `coordinator_not_bce`, `invalid_team_member`, `assignment_team_duplicate`, `deal_code_too_long`, `code_only_on_deals`, `invalid_links`, `too_many_links` |
| `PT404` | `deal_not_found`                                                                                                                                                                                                                                |
| `PT409` | `bc_assignment_held`                                                                                                                                                                                                                            |
| `23514` | `invalid_deal_settings`, `announcement_kind_immutable`, and from `announcements_guard_text` the link reasons above                                                                                                                              |

`deal_code_too_long` and `code_only_on_deals` are `PT400` although a row guard raises them: the contract fixed them so, and the app normalizes on the message.

## Tests

`supabase/tests/bc_assignments.test.sql`, `osubb_deals.test.sql` and `attached_links.test.sql`, with Attached Links additions in `completed_work_tasks.test.sql` and `update_task.test.sql`. Each rule was proved by mutation: its function line reverted on the local database, the suite run, the named assertions red, the line restored.

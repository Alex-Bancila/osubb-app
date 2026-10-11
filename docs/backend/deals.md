# Atribuții, OSUBB Deals and five Attached Links

The server contract behind rulings R44, R45 and R46 (2026-10-07, `docs/superpowers/plans/2026-09-23-prod-readiness-grill.md`). Three migrations carry it: `20261007190000_attached_links_five.sql` (R46), `20261007190100_bc_assignments.sql` (R44) and `20261007190200_osubb_deals.sql` (R45); `20261008090000_moderator_deals_team.sql` carries R44's amendment of 2026-10-08 (the Moderator holds every Atribuție's powers); `20261011120000_atributii_held_by_bc.sql` carries R47 (2026-10-11): every BC member and the Moderator hold every Atribuție's powers, nobody is a holder. Vocabulary: **Atribuție**, **Deal**, **Deal Code**, **Attached Link** in `CONTEXT.md`.

## Atribuții (R44, R47)

An Atribuție is a named BC responsibility area. Since R47 (2026-10-11) **every live BC member (level 6) and the Moderator (level 9) hold every Atribuție's powers by default; nobody is its holder.** The only one today is `osubb_deals`, **OSUBB Deals**; adding another is a new value in `assignment_team_assignment_ck`, in `set_assignment_team_member_impl`'s step-1 list and in `private.assignment_label`.

| Object                                                                      | What it is                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `public.assignment_team`                                                    | The team: at most one `coordinator` and one `responsible` (primary key `(assignment, team_role)`), never one person twice; `assignment` is checked against the known Atribuții. Readable by every live Member; no direct writes.                                          |
| `public.set_assignment_team_member(p_assignment, p_team_role, p_member_id)` | BC and the Moderator set either place; the Coordonator sets only the Responsabil. A null member clears the place. Serialized per Atribuție by a transaction advisory lock.                                                                                                 |
| `private.assignment_team_role(p_assignment, p_member)`                      | The one live definition: `holder` (any live BC member or the live Moderator -- the word the callers know), `coordinator` (the place and live bce), `responsible` (the place and live activ), or null. Every capability, policy and command reads it; nothing reads the token. |

| Actor (live rows)                      | Publish a Deal | Edit / delete any Deal | Edit / delete own Deal | Set Coordonator | Set Responsabil |
| -------------------------------------- | -------------- | ---------------------- | ---------------------- | --------------- | --------------- |
| Moderator (9) or BC member (6)         | yes            | yes                    | yes                    | yes             | yes             |
| Coordonator (live 5, in the place)     | yes            | yes                    | yes                    | no              | yes             |
| Responsabil (live activ, in the place) | yes            | no                     | yes                    | no              | no              |
| anyone else                            | no             | no                     | no                     | no              | no              |

**Setting a place.** A Coordonator must be live bce (`PT400 coordinator_not_bce`), a Responsabil a live activ Member (`invalid_team_member`); the member of the other place is refused (`assignment_team_duplicate`); naming the current member again changes nothing. **Notifications** (kind `system`): the member set hears "Ești acum Coordonator/Responsabil OSUBB Deals" (`/administrare/deals`), the one replaced or cleared "Nu mai ești Coordonator/Responsabil OSUBB Deals". R44's holder table (`bc_assignments`), `set_bc_assignment`, `bc_assignments_directory` and the grant/withdraw notifications were dropped by R47; the team rows survived the migration (only their foreign key went).

**Capabilities** (`public.my_capabilities()`, mapped in `app/src/lib/capabilities.ts`): `manage_deals` (any Deals power), `manage_deals_team` (BC, the Moderator, the Coordonator), `pick_deals_coordinator` (BC, the Moderator); `administer` is also true for `manage_deals`, so a Responsabil reaches Administrare with only the OSUBB Deals tab. `administer_bc` no longer exists.

## OSUBB Deals (R45)

A Deal is a row of `public.announcements` with `kind = 'deal'` and an optional `code` (the Deal Code). Publishing, editing and deleting stay direct writes under RLS.

- **Shape.** Organization Group, Audience `org`, Minimum Level 0, priority `normal`, not pinned: `announcements_guard_settings` answers anything else with `23514 invalid_deal_settings` (and `announcements_deal_shape_ck` holds the column part underneath). The code is trimmed (blank is none), at most 80 characters, and only on a Deal. `kind` never changes after insert (`23514 announcement_kind_immutable`).
- **Publish.** `announcements_create` reads `private.can_publish_announcement(group_id, kind)`: for a Deal, any Deals power (BC, the Moderator, the Coordonator, the Responsabil); for an Announcement, the rule it always had. Deals count against the `announcement` daily cap (20 per author in 24 hours).
- **Edit and delete.** `private.can_manage_deal(created_by)`: BC, the Moderator and the Coordonator any Deal, the Responsabil their own.
- **Read.** `private.can_read_announcement(…, kind, deadline)`: every live Member until the Termen; afterwards only the team and live level ≥ 6. The unread badge, `public.my_unread_announcements_count(p_kind default null)`, counts one tab when asked and never an expired Deal.
- **Fan-out.** The organization-wide Announcement rule (R32, R43), titled "Deal nou: <titlu>", linking `/anunturi/deals?deal=<id>`, subject `announcement:<id>`. The readers list (`announcement_readers`) is open to the team for a Deal.
- **Deal Code reveal.** `public.reveal_deal_code(p_announcement_id)` returns the code to a live Member who can read the Deal and records one `public.deal_code_reveals` row (idempotent; nothing is recorded for a Deal without a code). A Member reads their own reveals (PostgREST can embed `deal_code_reveals(revealed_at)` beside `announcement_reads(read_at)`); the team, BC and the Moderator read the count through `public.deal_code_reveal_count(p_announcement_id)`. `deal_code_reveals` is excluded from the live-change broadcast: a personal record nobody else watches live.

## Five Attached Links (R46)

`announcements.links` and `tasks.links` are jsonb arrays of at most five `{label, url}` objects (`*_links_ck`). `private.require_attached_links(p_links, p_label, p_url)` judges and normalizes a list: each link by the one-link rule (`link_incomplete`, `link_label_too_long`, `link_url_too_long`, `link_url_invalid`), plus `invalid_links` (not a list, or an element that is not a `{label, url}` object) and `too_many_links`; labels and addresses are trimmed and a wholly blank row dropped.

- **Tasks.** `create_task`, `update_task`, `preview_task_update`, `create_completed_task` and `approve_completed_work_request` take `p_links` (`PT400` at step 1). `update_task` and `preview_task_update` default it to null — not sent — and the others to `[]`; when it is null or empty and the old `p_link_label`/`p_link_url` pair is given, the pair is the one link. `update_task` is a full-state replace of `p_links`: a sent `[]` clears the links. A pair-only call (`p_links` not sent) comes from an app version before R46, which shows only the first link: the pair replaces that first link and the other links are kept, so an old app editing a title never deletes links it cannot show (`preview_task_update` judges the same list). An edit names `links` in `task_updated`'s `changed`/`before`/`after` (label "linkuri"). `duplicate_task` copies the list; `leadership_member_tasks` returns it. `submit_task_for_review`'s Submission Note link and a Group's application form stay single.
- **Announcements.** The app writes `links` directly; `announcements_guard_text` judges it and answers as `23514` with the same reasons.
- **The old pair, for one release.** Both tables were backfilled from `form_label`/`form_url` and `link_label`/`link_url`, which now mirror `links[0]` on every write (`announcements_guard_text`, `tasks_mirror_links`). A write from an app version before R46 that changes only the pair has it taken as `links[0]`, keeping the other links. The follow-up issue drops the pair, the mirror and the legacy RPC parameters after the links column has shipped.

## Error reasons

| Code    | Reasons                                                                                                                                                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `42501` | `assignment_team_forbidden`, `deal_code_forbidden`                                                                                                                                                                   |
| `PT400` | `invalid_assignment`, `invalid_team_role`, `coordinator_not_bce`, `invalid_team_member`, `assignment_team_duplicate`, `deal_code_too_long`, `code_only_on_deals`, `invalid_links`, `too_many_links` |
| `PT404` | `deal_not_found`                                                                                                                                                                                                                                |
| `23514` | `invalid_deal_settings`, `announcement_kind_immutable`, and from `announcements_guard_text` the link reasons above                                                                                                                              |

`deal_code_too_long` and `code_only_on_deals` are `PT400` although a row guard raises them: the contract fixed them so, and the app normalizes on the message.

## Tests

`supabase/tests/assignment_team.test.sql`, `osubb_deals.test.sql` and `attached_links.test.sql`, with Attached Links additions in `completed_work_tasks.test.sql` and `update_task.test.sql`. Each rule was proved by mutation: its function line reverted on the local database, the suite run, the named assertions red, the line restored.

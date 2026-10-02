# ADR-0011 — Live updates: database broadcast as the cache-invalidation signal

- **Status:** Accepted
- **Date:** 2026-09-30
- **Amended:** 2026-10-02 — `difficulty_guide` dropped (#989); its successor `task_difficulty_levels` (#985) broadcasts the same way
- **Deciders:** Alex Băncilă (request of 2026-09-30, launch week: "every change should appear instantly in the app")
- **Supersedes:** the "polling first, Realtime only where it visibly helps" stance of the architecture spec §6 and the frontend mini-spec; the Wave-3 limit "Realtime limited to own Notification rows, invalidation only" (D8)
- **Superseded by:** —
- **Related:** ADR-0002, ADR-0003, ADR-0007 (Realtime is only a cache-invalidation signal), #604 (the notifications channel), #959 (claims refresh on a system Notification), #961 (this decision)

## Context

Every screen reads through TanStack Query with a 30-second `staleTime` and a refetch on regained focus. The only live signal was the Member's own `notifications` rows (#604), which drives the badges and, since #959, the refresh of the Organization Claims. A change made by someone else — a Task created, a Group setting edited, an Event RSVP, an Announcement, a role change — reached another open screen only on the next focus or navigation.

Two ways to make every change live exist on Supabase Realtime:

1. **`postgres_changes` on each table.** No server code, but Realtime evaluates the table's `select` policy once per changed row per connected Member. `private.can_read_task` is a multi-join over profiles, roles, tasks, groups, task_assignments, task_candidates and group_members; one `evaluate_task` writes several rows across five tables, so the policy would run dozens of times per connected Member for one command. DELETE events are not filtered by RLS at all, and `old` records carry only primary keys. The cost grows with changes × members × policy cost.
2. **Broadcast from the database.** A statement-level trigger sends one message — the table name and the operation, never a row — on one private topic. Realtime authorizes the join once, against a `select` policy on `realtime.messages`, and then fans each message out to the connected clients. The cost grows with changes × (connected members + 1) only — Realtime bills the message the database sends plus one delivery per subscribed client — and every screen still refetches its rows through RLS.

ADR-0007 already rules that Realtime is only a signal to invalidate caches and never a second authorization path. Option 2 keeps that literally.

## Decision

1. **One private topic, `org:changes`.** Migration `20260930180000_live_change_broadcast.sql` adds `private.broadcast_change()`, a `security definer` statement-level trigger function (`set search_path = ''`) that calls `realtime.send(jsonb_build_object('table', tg_table_name, 'op', tg_op), 'change', 'org:changes', true)`, and the trigger `broadcast_change` (`after insert or update or delete … for each statement`) on every domain table: `tasks`, `task_assignments`, `task_candidates`, `task_evaluations`, `task_activity`, `points_ledger`, `groups`, `group_members`, `group_applications`, `profiles`, `events`, `event_attendance`, `announcements`, `announcement_reads`, `campaigns`, `completed_work_requests`, `roles`, `org_settings`, `role_history`, `role_evaluations`, `promotion_candidates`, `promotion_rules`, `promotion_thresholds`, `promotion_threshold_changes`, `privacy_notice_acknowledgements`, `rating_guide`, `difficulty_guide` (since dropped, #989; its successor `task_difficulty_levels` broadcasts the same way, #985). `realtime.send` swallows its own failure with a warning, so a change never fails for want of its signal.
2. **Who may join.** The policy `org_changes_receive` on `realtime.messages` (`for select to authenticated`) requires `realtime.topic() = 'org:changes'`, `extension = 'broadcast'` and `public.auth_is_member()`: a signed-in account without Organization Claims is refused, as everywhere else (ADR-0003).
3. **The browser invalidates, never renders.** `useLiveChanges(memberId)` (`app/src/queries/live-changes.ts`) joins the topic once per session from the member shell, maps each table to the query families it feeds (including the families a visibility table — `groups`, `group_members`, `profiles` — filters), collects signals for 250 ms and invalidates each affected family once; screens refetch through RLS. A re-subscribe after a dropped socket invalidates everything once, because signals may have been missed; the first join does not.
4. **The notifications channel stays.** `postgres_changes` on the Member's own `notifications` rows keeps driving the badges and the claims refresh; it is member-filtered and cheap.
5. **Excluded on purpose:** `notifications`, `push_tokens`, `push_deliveries`, `notification_push_preferences`, `notification_email_preferences`, `notif_suppression` — self-only settings or machinery nobody watches live. `supabase/tests/live_changes.test.sql` fails on any public table that neither carries the trigger nor is on that list: a new table must be decided, not forgotten.

## Consequences

- **Cost model.** Realtime bills messages: one for the signal the database sends plus one per connected client it is delivered to, so a signal costs connected members + 1; Free 2M/month, Pro 5M/month. Statement-level triggers keep a fan-out or a seed run at one signal per statement. Concurrent connections are unchanged (channels multiplex over the one socket the notifications channel already opens).
- **Failure mode.** With Realtime down, the database logs `WarnSendingBroadcastMessage` warnings and nothing else changes; the app falls back to `staleTime` and the focus refetch. A missing `realtime.messages` partition (created daily by the Realtime service) behaves the same way.
- **What is not live.** Reading an Announcement signals only its readers list; the push machinery and per-Member preferences signal nothing.
- **Conventions.** A new domain table gets the trigger in the migration that creates it, or its name on the exclusion list, and a line in `FAMILIES_BY_TABLE` (`docs/backend/conventions.md`). `private.broadcast_change` is pinned as a `trigger`-category function in `tracker_grants.test.sql`.
- **Hosted.** `realtime.send` and `realtime.messages` exist on every hosted project; the migration creates the policy as the `postgres` role, which has the rights for it on hosted projects and locally.

## Alternatives considered

- **`postgres_changes` per table** — rejected for the per-row-per-subscriber policy cost on the Task and Announcement policies, and for DELETE events bypassing RLS.
- **Polling (`refetchInterval`)** — not instant, and request volume grows with members × mounted screens on a Micro compute instance; rejected.
- **Per-Group topics** — would cut fan-out for Group-scoped tables at the price of one join per Group per client and a policy per topic; not needed at OSUBB's size, revisit if the message quota is approached.

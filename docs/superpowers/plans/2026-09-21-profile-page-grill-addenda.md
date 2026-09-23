# Profile page — grill addenda (2026-09-21)

> Rulings from the grilling of 2026-09-21 on the member's own profile page (`/profil`, issue #108), the
> promotion model it has to display, and the account actions it hosts. `CONTEXT.md`, ADR-0004 and ADR-0009
> carry the dated amendments already. The five issue drafts, the #108 rewrite, and the eight issue edits below
> are applied to GitHub only after Alex's go-ahead, in the order given under "Posting order".

## Facts established before the rulings

- `/profil` is not broken: it is routed, on the mobile tab bar, guarded by `RequireMember`, and renders
  `app/src/screens/Placeholder.tsx` pointing at #108. The screen has never been written.
- The database already lets a Member change exactly `full_name`, `phone`, and `avatar_color` on their own row
  (`profiles_self_update` + `guard_profile_privileged_columns`, pinned by `rls_profiles_write.test.sql`).
  `email` is BC-only and readable by self only through `profiles_contact`.
- Sign-in is Magic Link / Sign-in Code. Sessions persist through rotating refresh tokens with no timebox or
  inactivity limit in `config.toml`; the password grant is technically enabled for the demo seeds but the app
  has no password UI, and no issue asks for one.
- `promotion_rules`, `role_history`, Evaluation Periods, and every promotion function are absent from the
  whole repo (schema, seed, test, fixture). `role_history` exists only in dobre's PR #527.
- Global points views (`leaderboard`, `dept_cup`, `member_points`) are BCE-and-above since #254; ordinary
  Members read only `my_points` (#255) and their own ledger rows (#256).
- No per-member notification preferences exist; only role-level `notif_suppression` and per-device
  `push_tokens`. Fan-out (#68) and the push provider (#70) are unbuilt.
- `profiles.tier` is a BC-only text column with no definition after ADR-0009's seven ranks; nothing computes
  it.
- The repo holds 17 stale agent worktrees under `.claude/worktrees/` and `.codex-artifacts/worktrees/`, each
  a full copy of `app/` and `supabase/`; unscoped `grep -r` from the root reads them.

## Rulings

| #   | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Lands in                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| R1  | No password, ever, on the profile page. Sign-in stays Magic Link / Sign-in Code; a signed-out Member requests a new one.                                                                                                                                                                                                                                                                                                                                                                                                        | #108 copy                                            |
| R2  | "Status as a volunteer" is the **Role** (`Rol organizațional`). Membership Status is never shown to self: anyone who can open the page is active.                                                                                                                                                                                                                                                                                                                                                                               | #108                                                 |
| R3  | BC, BCE, Moderator, and Voluntar cu Drept de Vot sit in the Adunarea Generală by Role alone (Automatic Membership at Minimum Level 3). Nothing to build; the page shows a chip.                                                                                                                                                                                                                                                                                                                                                 | #108                                                 |
| R4  | Theme toggle: yes, client-side. Role history: yes, as a timeline. Notification preferences: yes.                                                                                                                                                                                                                                                                                                                                                                                                                                | #108; P2; P4                                         |
| R5  | No "Demisie AG" and no sanctions section yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | #108 boundary                                        |
| R6  | No rank line and no leaderboard on the page, for any Role.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | #108 boundary                                        |
| R7  | Self-service sign-in email change without BC: Supabase Auth update with double confirmation, then a server-side sync into `profiles.email`. It only helps a Member who can already sign in; a wrong address at provisioning stays BC's fix.                                                                                                                                                                                                                                                                                     | P1; #54 edit                                         |
| R8  | Role history renders like a LinkedIn timeline: "Recrut timp de X, Voluntar din Y", from `profiles.joined_at` and `role_history`.                                                                                                                                                                                                                                                                                                                                                                                                | P2                                                   |
| R9  | **Two doors into Voluntar Activ, one tenure gate.** At a Period's close, every Voluntar in that Period's top x% with the required tenure (one semester in the organization, from `joined_at`) is promoted. During the following Period the **Promotion Threshold** (Task Points of the last Member inside the top x% at the previous close) is constant; a Voluntar with tenure whose Period points reach it is promoted on the spot and notified. Without tenure: no promotion, no notification. BC seeds the first threshold. | ADR-0004 amendment; #47, #49, #51, #52 edits         |
| R10 | **Retention Signal**, never demotion: at close, a Voluntar Activ or a Voluntar cu Drept de Vot below their Role's share of the closing Period triggers a notice to BC, who may withdraw the Role by hand.                                                                                                                                                                                                                                                                                                                       | ADR-0004 amendment; #48, #51, #52, #512 edits        |
| R11 | Glossary: `Promotion Rule` reworded; new terms `Promotion Threshold` and `Retention Signal`; `AG Eligibility` reworded.                                                                                                                                                                                                                                                                                                                                                                                                         | `CONTEXT.md` (done)                                  |
| R12 | **AG Eligibility follows from the Voluntar Activ Role alone**, because that Role already required tenure and the threshold. Promotion offers the adherence form; BC's confirmation grants Drept de Vot. There is no second threshold, so the separate "Drept de Vot eligibility signal" of #51/#52/#512 collapses into the promotion notification.                                                                                                                                                                              | ADR-0004/0009 amendments; #51, #52, #512, #594 edits |
| R13 | Points are **display only**: the profile hides the whole points block at level ≥ 5. `evaluate_task`, the Cup, and the Leadership Leaderboard are untouched. Recrut and Voluntar see their total; Voluntar Activ and Drept de Vot see their total plus the Promotion Threshold as a reference line.                                                                                                                                                                                                                              | #108; P3                                             |
| R14 | Hide the Completed-work Request submission form and "Cererile mele" at level ≥ 5, keeping the route, the nav item, and the decision queue (corrected 2026-09-22: PR #557 hosts the queue on `/cereri`, and decision authority is Group-based). The backend command stays.                                                                                                                                                                                                                                                       | P5                                                   |
| R15 | Self-edit is `full_name`, `phone`, `avatar_color`, and the email through R7. No "despre mine", faculty, or avatar image until the priorities are set.                                                                                                                                                                                                                                                                                                                                                                           | #108 boundary                                        |
| R16 | Groups section reads the Member's own `group_members` rows joined to `groups` now: explicit memberships with their Group Role, plus the Adunarea Generală chip client-side at level ≥ 3. No client-side inheritance. `my_groups()` (#576) replaces the query later.                                                                                                                                                                                                                                                             | #108; #576 note                                      |
| R17 | Notification preferences control **push only**. The in-app list is always complete. Never mutable: critical Announcements, `task`, and `system` kinds. Own issue blocked on the push provider; the profile section appears only once it exists.                                                                                                                                                                                                                                                                                 | P4                                                   |
| R18 | Before tenure the page shows the date from which the Member can become Voluntar Activ and no bar; the bar appears after that date. At close the tenure rule runs before the ranking rule, so a Recrut reaching one semester at that close and inside the top x% becomes Voluntar Activ in the same run, with two history rows. (Stated as assumptions; Alex did not object.)                                                                                                                                                    | P3; #51 edit                                         |

**Checked and unchanged:** #33 (closed parent, superseded by the #108 rewrite), #55 (Google, wontfix), #204/#532
(magic link only), #598 (refresh on focus — not a blocker, just makes the Role badge and the nav agree
sooner), #576 (replaces the Groups query later), #103/#105 (Administrare views of other Members are theirs,
not the profile's), #104 (sanctions stay deferred), #610/#613 (duplicates of each other; not this session's
to merge).

## Posting order

1. P5, P1 — independent, startable.
2. P2, P3, P4 — blocked, so they need their blockers' numbers only.
3. Rewrite #108 last among the drafts, so it can link P1–P4 by real number.
4. Edits: #47, #49, #51, #52, #48, #512, #594, #54.

Every draft is `needs-triage` per `docs/agents/triage-labels.md`; Alex flips the startable ones to
`ready-for-agent` on go-ahead. P2 stacks on dobre's branch for #50 (PR #527) and must not close #50.

## Issue drafts to post

### P1 — Profile: change my sign-in email without BC

```markdown
## Profile: change my sign-in email without BC

**Labels:** `needs-triage`, `backend`, `database`, `auth`, `frontend`, `testing`

## Goal

Let a Member move their account to a different email address from their own profile, confirmed at both the
old and the new address, with `profiles.email` following the confirmed change automatically.

## Why

The sign-in address is the Member's identity (ADR-0003), yet today only BC may change `profiles.email`
(`guard_profile_privileged_columns`), and nothing synchronizes it with `auth.users.email`. A Member who was
provisioned on a university address and wants their personal one has to ask BC, and if BC ever changes the
Auth address through the dashboard the two columns drift silently, which also breaks `invite-member`'s
"already a Member" check. Supabase Auth already has the flow — `config.toml` sets `double_confirm_changes =
true` on purpose — so what is missing is the sync and the form. Ruling R7 of
`docs/superpowers/plans/2026-09-21-profile-page-grill-addenda.md`.

## What to build

- A migration adding `private.sync_profile_email()`, `security definer`, `set search_path = ''`, fired
  `after update of email on auth.users for each row`, writing `lower(trim(new.email))` into
  `public.profiles.email` for that id when it differs. The guard trigger already admits non-client roles, so
  no grant changes; the function is owned by `postgres` and executable by nobody else (house rule 4).
- On the profile page (#108), an "Adresa de e-mail" section showing the current address from
  `profiles_contact` and a form that calls `supabase.auth.updateUser({ email })` with the trimmed, lowercased
  address. Copy explains that two confirmation emails follow, one to each address, and that the change
  applies only after both. On success the form shows the pending state; the `profile.me` query is invalidated
  on the next `USER_UPDATED` auth event.
- Romanian error mapping for the Auth responses (address already in use, invalid address, rate limited) in
  `app/src/lib/auth-error-message.ts`.
- A line in #54's staging checklist and the production checklist: `double_confirm_changes` on, and the
  "Change Email Address" template in Romanian beside the Magic Link one.

## Implementation boundary

No change to who may write `profiles.email` from a client: it stays BC-only. No name or phone edit here (that
is #108), no password, no phone-number auth. A wrong address at provisioning is still BC's fix through
Administrare (#103), because the affected Member cannot sign in to use this form.

## Acceptance criteria

- [ ] Updating `auth.users.email` as the Auth role updates `profiles.email` to the lowercased, trimmed value;
      updating any other `auth.users` column leaves `profiles.email` alone.
- [ ] A client below level 6 still cannot write `profiles.email` directly (existing `42501` guard holds).
- [ ] The form sends the trimmed, lowercased address to Auth and renders the double-confirmation copy.
- [ ] An address already used by another account is refused by Auth and shown in Romanian.
- [ ] After confirmation the profile page shows the new address without a reload beyond the auth event.

## Required tests

pgTAP (`supabase/tests/profile_email_sync.test.sql`): the sync on an `auth.users` email update, the no-op on
an unrelated update, the lowercase/trim normalization, and a mutation guard — dropping the trigger must turn
the suite red. `rls_profiles_write.test.sql` keeps its `email` assertion. Vitest: the form calls
`auth.updateUser` with the normalized address, renders the pending copy, and maps the "already in use" error
to Romanian.

## Blocked by

None — can start immediately.
```

### P2 — Profile: role timeline

```markdown
## Profile: role timeline

**Labels:** `needs-triage`, `frontend`, `max-1h`

## Goal

Show a Member their own Role history as a timeline: each Role held, from when to when, how long, and the
current Role since its start date.

## Why

Ruling R8: the profile page shows the ladder the way LinkedIn shows positions — "Recrut timp de 4 luni,
Voluntar din 12 feb 2026". `role_history` (#50) records every change with `from_role`, `to_role`, and
`created_at`, and `profiles.joined_at` (#160) gives the start of the first segment, so the timeline is a pure
read.

## What to build

- A `useMyRoleHistory()` query reading the caller's own `role_history` rows (self-read policy from #50)
  ordered by `created_at`, keyed with the member id like `profile.me` (#360).
- A presentation function that turns `joined_at`, the rows, and the current Role into segments: the first
  segment's Role is the earliest row's `from_role` (or the current Role when there are no rows), each row
  starts a new segment, the last segment is open. Display names come from `useRoles()`.
- A section on the profile page rendering the segments oldest first with start date, end date, duration in
  Romanian ("4 luni", "1 an și 2 luni"), and "din <date>" for the current one. When `joined_at` is null the
  timeline shows the current Role only, with "Membru din <joined_year>".

## Implementation boundary

Read-only. No promotion targets or progress here (that is the promotion progress issue). No history of other
Members (Administrare, #103).

## Acceptance criteria

- [ ] A Member with no `role_history` rows sees one open segment from `joined_at` in their current Role.
- [ ] A Member with two changes sees three segments with correct boundaries and durations.
- [ ] A null `joined_at` degrades to the current Role and the join year, with no durations.
- [ ] Nothing on the page reads another Member's history.

## Required tests

Vitest for the segment builder (no rows, one row, two rows, null `joined_at`, a row dated before `joined_at`
clamped to it) and a rendering test with the Romanian duration copy.

## Blocked by

- #50
- #108
```

### P3 — Profile: promotion progress toward Voluntar Activ

```markdown
## Profile: promotion progress toward Voluntar Activ

**Labels:** `needs-triage`, `frontend`

## Goal

Show a Member where they stand on the automatic ladder: the date they become eligible, and once eligible, a
progress bar toward the Promotion Threshold of the open Evaluation Period.

## Why

The mandate asks for a gamified, self-updating volunteer category (Direcții §2.2). ADR-0004 as amended on
2026-09-21 defines the target precisely: a Voluntar with the required tenure becomes Voluntar Activ during a
Period by reaching the Promotion Threshold, a constant fixed at the previous close, so the bar has an honest,
fixed target all semester. Rulings R9, R13, R18.

## What to build

Per Role, reading `promotion_rules` (#49), the Promotion Threshold in force (#49), and the Member's own row
of the open Period's ranking (#47):

- **Recrut:** "Devii Voluntar din <joined_at + tenure>". No bar.
- **Voluntar below tenure:** "Poți deveni Voluntar Activ din <date>". No bar.
- **Voluntar with tenure:** a bar from 0 to the Promotion Threshold showing the Member's Task Points inside
  the open Period, with "Mai ai Z puncte până la Voluntar Activ"; once past it, "Ai depășit pragul — rolul
  se acordă automat" (the promotion itself is #52's job).
- **Voluntar Activ and Voluntar cu Drept de Vot:** their Period points beside "Pragul semestrului: y puncte",
  as the reference the Retention Signal will use. No bar.
- **Level ≥ 5:** nothing (ruling R13).
- **No open Period:** the tenure lines only; the bar is hidden, never faked.

## Implementation boundary

Read-only. No promotion, no notification, no threshold editing (Administrare). Not a leaderboard: the page
never shows another Member's points or a rank (ruling R6).

## Acceptance criteria

- [ ] Each of the six states above renders from fixtures, and only that state.
- [ ] The bar's target is the stored Promotion Threshold, not a live percentile.
- [ ] Below tenure, the eligibility date is shown and nothing about points is.
- [ ] At level ≥ 5 the block is absent from the DOM.

## Required tests

Vitest with fixtures for every state, including the day before and the day of the tenure date, a Member
exactly at the threshold, and no open Period.

## Blocked by

- #47
- #49
- #108
- #594
```

### P4 — Notifications: per-member push preferences

```markdown
## Notifications: per-member push preferences

**Labels:** `needs-triage`, `backend`, `database`, `rls`, `frontend`

## Goal

Let a Member choose which notification kinds reach their devices as push, while the in-app list stays
complete.

## Why

Ruling R17: muting the phone buzz is the real need; silencing the organisation's channel in-app is not.
Today the only muting is role-level `notif_suppression` for BC and BCE broadcasts, and nothing per Member.

## What to build

- A `notification_push_preferences` table: `member_id`, `kind noti_kind`, `push_enabled boolean`, primary
  key `(member_id, kind)`, RLS enabled in the creating migration, self-only select/insert/update/delete
  gated on `auth_is_member()` (house rule 12). Absent row = enabled.
- Kinds a Member may disable: `announce` (normal and important priority), `event`, `deadline`. Never
  disabled, and rejected by a check or trigger: critical Announcements, `task`, `system`.
- The push delivery step honours the table: a disabled kind writes the in-app row and skips the push.
- A "Notificări pe dispozitiv" section on the profile page with one switch per mutable kind and copy naming
  the three kinds that always arrive.

## Implementation boundary

Push only; no change to in-app rows or to `notif_suppression`. No per-Group preferences, no quiet hours.

## Acceptance criteria

- [ ] A Member reads and writes only their own rows; a claimless session reads nothing.
- [ ] Disabling `announce` skips push for a normal Announcement and still pushes a critical one.
- [ ] Rows for `task` or `system` are rejected.
- [ ] The in-app notification row exists regardless of the preference.

## Required tests

pgTAP: self-only policies across claimless, self, another Member, BC; the rejected kinds; the push step's
skip and the critical override. Vitest: the switches write the preference and the always-on copy renders.

## Blocked by

- #68
- #70
- #108
```

### P5 — Requests: hide the submission form from BCE, BC, and Moderator (#631, corrected 2026-09-22)

```markdown
## Requests: hide the submission form from BCE, BC, and Moderator

**Labels:** `needs-triage`, `frontend`, `max-1h`

## Goal

Members at level 5 and above stop seeing the Completed-work Request submission form and "Cererile mele", and
keep the decision queue.

## Why

Ruling R14 of `docs/superpowers/plans/2026-09-21-profile-page-grill-addenda.md`, corrected on 2026-09-22: BC
and BCE do not work by points, so they have no use for filing a Request for their own work. But `/cereri` is
also where managers decide Requests. PR #557 (#353) renders the decision queue on that same screen, and
decision authority comes from live Group roles (`private.can_decide_request`), not from level: a Voluntar
Activ who is a Coordonator Principal decides too. Hiding the nav item or redirecting the route at level 5
would lock every BCE and BC out of deciding, so the gate belongs on the two member-facing sections, not on
the screen.

## What to build

- `capabilities.ts`: a `submitsWorkRequests(claims)` helper, true below level 5, so the level number lives in
  one place until `my_capabilities()` (#576) carries the flag.
- `CompletedWorkRequestScreen.tsx`: render the submission form and "Cererile mele" only when
  `submitsWorkRequests(claims)`. The decision queue renders as #353 defines, for anyone it admits.
- Page copy: drop any sentence that invites the reader to submit a Request when the form is hidden.
- The `/cereri` route and its nav item stay visible to every Member, and a deep link works at every level.

## Implementation boundary

Frontend only, and only the two sections above. Do not touch the decision queue, the route guard, or the nav
filter. `create_completed_work_request` and its policies stay callable at any level: this is display only,
the same stance as ruling R13 for points. Build it as a delta on the branches of PR #539 and PR #557, do not
close #352 or #353, and do not review or merge those PRs.

## Acceptance criteria

- [ ] At level 4 and below the screen renders exactly as #352 and #353 leave it: form, "Cererile mele", and
      the queue for a Member with decision authority.
- [ ] At level 5, 6, and 9 the form and "Cererile mele" are absent from the DOM and the decision queue still
      renders, including its empty state.
- [ ] The nav item is present at every level, and `/cereri` opens at every level without a redirect.

## Required tests

Vitest with mocked claims at levels 4 and 5: the form and "Cererile mele" present and absent, the queue
rendered in both, and the nav item present at level 5.

## Blocked by

- #352
- #353
```

### #108 — rewrite (replace body; keep `frontend`, drop `max-1h`)

```markdown
## Profile screen: Profilul meu

**Labels:** `frontend`

## Goal

Replace the `/profil` placeholder with the Member's own profile: who they are, their Role, their Groups,
their points where that applies, the three fields they may edit, and the theme toggle.

## Why

`/profil` is routed, on the mobile tab bar, and renders `Placeholder.tsx`. The parent #33 scoped the screen
and ruled that a Member edits their own contact fields only; the grilling of 2026-09-21
(`docs/superpowers/plans/2026-09-21-profile-page-grill-addenda.md`) fixed the rest. Everything this issue
reads and writes exists on `main` today.

## What to build

- **Header:** avatar with `avatar_color`, `full_name`, the Role's display name from `useRoles()` labelled
  "Rol organizațional", and "Membru din <joined_at>" (year only when `joined_at` is null). Membership Status
  is not shown (ruling R2).
- **Contact:** email and phone from `profiles_contact` (the only place a Member may read their own address),
  with a note that sign-in is by link or code to that address. Email change is P1.
- **Edit:** a form for `full_name`, `phone`, `avatar_color` writing the Member's own `profiles` row through
  the existing `profiles_self_update` policy (this is not a Task table; direct DML is the sanctioned path,
  #60). Invalidate `profile.me` on success.
- **Groups:** the Member's own `group_members` rows joined to `groups`, grouped by category as
  "Departamente", "Echipe", "Proiecte", each with its colour, name, and Group Role label (Group Manager under
  the Group's `manager_title`, Group Responsible under `position_title`, otherwise "Membru"). Add an
  "Adunarea Generală" chip at level ≥ 3. The Organization Group is not listed. No inherited roles (ruling
  R16); `my_groups()` (#576) replaces this query later.
- **Points:** `my_points` total for level ≤ 4, labelled "Punctaj personal". Absent from the DOM at level ≥ 5
  (ruling R13). No rank, no leaderboard, no Cup (ruling R6).
- **Theme toggle:** light/dark, persisted per device, as #33 asked.
- Sections that later issues add (timeline P2, promotion progress P3, push preferences P4) are not rendered
  as placeholders; the page simply has no such section until they land.
- Update `app/README.md`'s tree and routes rows for `/profil`.

## Implementation boundary

No password (ruling R1), no email change (P1), no "Demisie AG", no sanctions (ruling R5), no "despre mine",
faculty, or avatar image (ruling R15). Do not read `profiles.tier`; it is undefined. Memberships come from
the tables, never from the `group_ids` claim. No write to any table other than the Member's own `profiles`
row.

## Acceptance criteria

- [ ] A Voluntar sees header, contact, edit, Groups, points total, and the theme toggle.
- [ ] A BCE sees the same without the points block, and the Adunarea Generală chip.
- [ ] A Member with `role = 'vot'` sees the Adunarea Generală chip; a Voluntar does not.
- [ ] Saving the form changes only `full_name`, `phone`, `avatar_color`, and the header re-renders.
- [ ] A Member in a Department, a Team of it, and a Project sees three groups under three headings with the
      right Group Role labels.
- [ ] Nothing on the page shows another Member's data or a rank.

## Required tests

Vitest with fixtures for a Voluntar, a Voluntar cu Drept de Vot, and a BCE: section presence per Role, the
Groups grouping and labels, the form's submitted columns, and the points block's absence at level 5.

## Blocked by

None — can start immediately.
```

## Issue edits to apply

Each edit replaces the quoted sentence or adds the listed paragraph; everything else in the body stands.

- **#47 Evaluation Periods.** Add to _What to build_: "Closing a Period stamps `closing_threshold`: the Task
  Points held by the last Member inside the top x% of that Period's ranking (the percentage from #49's
  `top_percent` rule). The **Promotion Threshold in force** is the most recently closed Period's
  `closing_threshold`, or the BC-seeded initial value from #49 when no Period has closed." Add an acceptance
  criterion and a test line for the stamp and for the fallback.
- **#49 promotion_rules.** The `top_percent` row carries the percentage, the minimum tenure, and an
  `initial_threshold` that BC seeds by hand before the first close (the "placeholder BC ratifies"). Add a
  helper readable by any Member returning the Promotion Threshold in force (gamification needs the number),
  and a test for it. Strike nothing else.
- **#51 detect_promotions().** Replace the Voluntar → Voluntar Activ rule with two: (a) continuous — a
  Voluntar with the required tenure whose open-Period Task Points reach the Promotion Threshold in force; (b)
  at close — a Voluntar with the required tenure inside the closing Period's top x%. At close the tenure rule
  runs before the ranking rule (R18). **Strike the Drept de Vot eligibility signal entirely** (R12) and add
  **Retention Signals** at close: every Voluntar Activ below the top x% and every Voluntar cu Drept de Vot
  below the top y% of the closing Period. Update the acceptance criteria and tests accordingly; the
  "eligibility signal" bullets become Retention Signal bullets.
- **#52 apply_promotions().** Runs daily for the continuous rules and once from the close command for the
  close-time rules. The Voluntar Activ promotion notification carries the benefits and the adherence-form
  link (AG Eligibility by Role, R12). Replace the "Drept de Vot eligibility signal" behavior with: for every
  Retention Signal, change nothing and notify BC (and the Adunarea Generală's Group Responsibles per #512)
  naming the Member and their Role. Idempotence per Member and Period stands.
- **#48 Vote retention ranking.** Generalize: at close, mark both Voluntar Activ holders against the top x%
  and Voluntar cu Drept de Vot holders against the top y%; the decision aid BC reads before withdrawing
  either Role by hand. The notification is #52's; nothing here changes a Role.
- **#512 AG eligibility visibility.** Replace the paragraph beginning "ADR-0009 §Promotion hooks defines what
  there is to see" with: "AG Eligibility follows from the Voluntar Activ Role alone (ADR-0004, amended
  2026-09-21); there is no second threshold and no eligibility signal. What BC and the Adunarea Generală's
  Group Responsibles read is the Period ranking, the Promotion Threshold, and the Retention Signals at
  close." Adjust the policies list from "the Drept de Vot eligibility signal (#51)" to "the Retention Signals
  (#51)".
- **#594 Wave 4 umbrella.** In _Outcome_, replace "Voluntar Activ → Voluntar cu Drept de Vot is signalled to
  BC for human confirmation" with "a new Voluntar Activ is offered the adherence form and BC confirms Drept
  de Vot by hand; at close BC receives Retention Signals for both Roles". Add P3 to _Children_.
- **#54 staging auth checklist.** Add: `double_confirm_changes` on, and the "Change Email Address" template
  in Romanian (P1).

## Posted (2026-09-21, after Alex's go-ahead)

P5 → #631 (rewritten 2026-09-22 after Alex asked whether the issues block Dobre's work) · P1 → #632 · P2 → #633 · P3 → #634 · P4 → #635 · #108 rewritten and retitled "Profile screen:
Profilul meu" (`max-1h` dropped). Edits applied to #47, #49, #51, #52, #48, #512, #594, #54.

Two adjustments made while applying the edits, so the dependency graph stays acyclic: the close-time
`closing_threshold` **stamp and the in-force helper live in #49** (which owns the percentage), and #47 only
adds the nullable column; #51 gained #48 as a blocker (it reads the retention share) and #48 gained #49 (the
Voluntar Activ share is the promotion x%, not configured twice).

## Plan and doc text touched

- `CONTEXT.md`: Promotion Rule, Promotion Threshold, Retention Signal, AG Eligibility (done this session).
- `docs/adr/0004-promotion-policy.md`: amendment of 2026-09-21 (done this session).
- `docs/adr/0009-groups.md`: header line and a note under Promotion hooks (done this session).
- `app/README.md` and `docs/superpowers/specs/frontend-mini-spec.md`: the `/profil` rows change when #108
  lands, not before.

# ADR-0004 — Promotion policy: automatic up to Membru Activ, manual above

- **Status:** Accepted
- **Date:** 2026-08-12
- **Amended:** 2026-09-18 — ADR-0009: the level-2 rank is displayed as Voluntar Activ and its rule becomes top x% of the Evaluation Period's Leaderboard plus tenure; Drept de vot is granted only after BC confirms; level 4 (`responsabil`) leaves the ladder
- **Amended:** 2026-09-20 — Moderator is a transferable Role, not a fixed account; a manual Role change notifies the Member and, when it drops them below a Group's Minimum Level, removes them from that Group
- **Amended:** 2026-09-21 — profile grilling: Voluntar → Voluntar Activ has two doors behind one tenure gate (the top x% at a Period's close, or the Promotion Threshold during the following Period); a Retention Signal to BC replaces any downward automation for Voluntar Activ and Drept de Vot; AG Eligibility follows from the Voluntar Activ Role alone; BC seeds the first threshold (superseded 2026-09-27)
- **Amended:** 2026-09-27 — ruling R28: no Period is opened or closed; BC runs Role Evaluations over a chosen date range, of two kinds with one BC-editable Promotion Threshold each; Voluntar → Voluntar Activ is BC-confirmed from a list of Promotion Candidates; only Recrut → Voluntar stays automatic
- **Amended:** 2026-09-29 — ruling R31: every BC member, not only the Moderator, grants and removes the BC and Moderator Roles; whoever removes the last active Moderator or BC member names the replacement in the same change
- **Deciders:** Alex Băncilă (IT Coordinator)
- **Supersedes:** —
- **Superseded by:** —
- **Related:** `docs/org/directii-prioritati-it.md` §2.2, `docs/org/plan-managerial.md` §IV.3, architecture spec §8.4, `docs/superpowers/specs/2026-06-28-osubb-app-mockup-design.md` (Revizia 2)

> **Amended 2026-09-18 by ADR-0009.** Read "Membru Activ" as Voluntar Activ, read the points threshold for Voluntar → Voluntar Activ as "top x% of the current Evaluation Period's Leaderboard and at least the required tenure", and read "Responsabil (4)" as retired: Coordonator Principal and Responsabil are Group Roles, not ranks. The hybrid split, the manual tiers, and the no-automatic-demotion rule stand.

## Context

The documents disagreed on how role promotions happen. The architecture spec (§8.4) recommended _manual with suggestions_. The mandate documents promise the opposite for the lower tiers: the volunteer category "să se updateze automat… **GAMIFICAT**" (Direcții 2.2), and members reaching the threshold "vor primi **automat** în aplicație rolul de membru activ" plus a notification with their benefits and the adherence form (Plan IV.3). There was also a threshold discrepancy: "6 months" (mockup Revizia 2) vs "one semester" for Recrut→Voluntar.

Roles carry permissions (level thresholds drive RLS), so automatic promotion is automatic privilege escalation — safe only where the target role has low privileges.

## Decision

**Hybrid, split by level:**

1. **Automatic (threshold-driven), with gamified notification:**
   - **Recrut (0) → Voluntar (1):** time-based — default **one semester** since `profiles.joined_at`.
   - **Voluntar (1) → Membru Activ (2):** points-based — a configurable points threshold over the member's ledger total. **Default value: to be ratified by BC** (together with the scoring-guide content, Direcții 1.2); seeded as a placeholder until then.
   - On crossing a threshold the app applies the new role, notifies the member (benefits + link to the _formular de aderare_ with ROF/Statut, per Plan IV.3), and records the change. The adherence form does **not** gate the role change (revisit if BC wants it to).
2. **Manual only (suggestions surfaced, human decides):** Drept de vot (3) — an AGO/governance decision fed by the `ag_eligibility` / `ag_quorum_top25` views; Responsabil (4), BCE (5), BC (6) — named by BC/AG; Moderator (9) — fixed account.
3. **Demotions are never automatic** (including the top-25% vote retention at AGO — the views suggest, BC applies).

**Mechanics:** a `promotion_rules` config table (from_role, to_role, kind `time|points`, threshold, enabled) — thresholds editable without code changes; a `role_history` audit table (member, from, to, actor — `'system'` for automatic changes, changed_at); a scheduled job (pg_cron or Edge Function) for the time rule and a ledger-driven check for the points rule; every automatic change writes `role_history` + a notification.

## Consequences

- **+** Keeps the mandate's gamified promise where it matters (the tiers every volunteer passes through) while high-privilege roles (level ≥ 3) stay human decisions.
- **+** Automatic escalation is bounded: the highest auto-granted level is 2, which unlocks no management capability (those start at level ≥ 4).
- **+** Thresholds are data, not code — BC can tune them per semester.
- **−** Requires `profiles.joined_at` (full date; `joined_year` is not enough) and the promotion engine (Phase 2, before org-wide rollout — BC/BCE launch users are all manual-tier, so v1 for them doesn't need it).
- **−** An automatic role change with wrong data self-corrects only via manual intervention; `role_history` makes every change auditable and reversible.

## Amendment (2026-09-20) — the Moderator seat and manual Role changes

Read "Moderator (9) — fixed account" as **a transferable Role held by the IT Coordinator**. The sitting Moderator grants it to the successor, who then removes it from the predecessor; nobody may change their own Role, and only a Moderator may change the Role or Status of a Member holding BC or Moderator, so the seat can never be emptied by its holder or by BC (ADR-0003, amended 2026-09-20).

Every manual Role change, upward or downward, writes `role_history` with the real actor and notifies the Member of their new Role; when the change grants Drept de Vot the notification names the seat in the Adunarea Generală it brings. When a change puts the Member below a Group's Minimum Level they leave that Group entirely at that moment (ADR-0009, amended 2026-09-20), and the notification names the Groups left. Demotions remain a human act; nothing in the promotion engine ever lowers a Role.

## Amendment (2026-09-21) — two doors, one tenure gate, and the Retention Signal

> **Superseded 2026-09-27** by the amendment of that date (ruling R28): the two doors, the automatic close-time promotion and the Promotion Threshold fixed at a Period's close no longer apply. The tenure gate, the Retention Signal and AG Eligibility by Role stand as reworded there.

Read decision 1's Voluntar → Voluntar Activ rule, and the 2026-09-18 reading of it, as follows.

**One tenure gate.** A Voluntar needs the required tenure in the organization, measured from `profiles.joined_at`, before anything happens; below it there is neither promotion nor notification, whatever their points.

**Two doors.** When an Evaluation Period closes, every Voluntar with the required tenure inside that Period's top x% becomes Voluntar Activ. The close also fixes the **Promotion Threshold**: the Task Points held by the last Member inside the top x%. That number stays constant through the following Period, and a Voluntar with the required tenure whose Task Points inside that Period reach it becomes Voluntar Activ on the spot, with the notification. The close-time door guarantees the top x% are always promoted; the threshold door gives every Voluntar a fixed, visible target all semester. BC seeds the first threshold by hand, which is the placeholder decision 1 already planned. At close the tenure rule runs before the ranking rule, so a Recrut reaching the required tenure at that close and inside the top x% becomes Voluntar Activ in the same run, with two `role_history` rows.

**Retention Signal, never demotion.** When a Period closes, a Voluntar Activ below the top x% and a Voluntar cu Drept de Vot below the top y% each produce a Retention Signal to BC, who may withdraw the Role by hand through the role panel. Decision 3 stands unchanged: nothing lowers a Role automatically.

**AG Eligibility by Role.** A Voluntar Activ is eligible for the Adunarea Generală by that Role alone, because reaching it already required tenure and the threshold; there is no second threshold. The promotion notification offers the adherence form, and only BC's confirmation grants Drept de Vot. The separate "Drept de Vot eligibility signal" the Wave 4 issues described is withdrawn.

The `ag_eligibility` / `ag_quorum_top25` views named in decision 2 have no successor (#47); their role is taken by the Period ranking, the Promotion Threshold, and the Retention Signals.

## Amendment (2026-09-27) — Role Evaluations over a date range, two thresholds, manual promotion

Ruling R28 (`docs/superpowers/plans/2026-09-23-prod-readiness-grill.md`). It supersedes the 2026-09-21 amendment's two doors and its Promotion Threshold fixed at a Period's close; read decision 1 and the earlier amendments as follows.

**No Period is opened or closed.** BC runs a **Role Evaluation** from Administrare over an **Evaluation Period** chosen at that moment, a date range from one day to another, of one kind: Voluntar Activ or Adunarea Generală. It ranks the Task Points of the Task Evaluations falling in that range; nothing ranks live between runs.

**Two Promotion Thresholds, one per kind.** BC enters each by hand the first time and may edit either at any time; every edit is audited. Each Role Evaluation records the threshold in force when it ran and computes a new one, the Task Points of the last Member inside its kind's top share (x% for Voluntar Activ, y% for Adunarea Generală), which is in force for that kind's next run unless BC edits it.

**Voluntar → Voluntar Activ is BC-confirmed.** The Voluntar Activ kind ranks active Voluntar and Voluntar Activ holders. A Voluntar with the required tenure (the tenure gate stands) at or above the threshold becomes a **Promotion Candidate**: a row in the candidates list and one Notification per Member per run to BC and Moderator. Nobody is promoted by the run; BC promotes by hand in the Role panel, which writes `role_history` and notifies the Member as the 2026-09-20 amendment rules. Decision 1's automatic Voluntar → Membru Activ is withdrawn; **Recrut → Voluntar by tenure is the only automatic promotion left**, and the daily job keeps only that rule.

**Retention Signals.** The Voluntar Activ kind raises one for each Voluntar Activ below the top x%; the Adunarea Generală kind ranks only current Voluntar cu Drept de Vot holders and raises one for each below the top y%, with no promotion path. Decision 3 stands: nothing lowers a Role automatically.

**AG Eligibility** still follows from the Voluntar Activ Role alone; no threshold leads to Drept de Vot, which only BC's confirmation grants.

## Amendment (2026-09-29) — BC shares the leadership ranks (ruling R31)

Supersedes the 2026-09-20 amendment's "only a Moderator may change the Role … of a Member holding BC or Moderator". **Every active BC member, like the Moderator, grants and removes the BC and Moderator Roles** and changes the Role of a Member who holds either. Nobody changes their own Role, with one exception below. The Status of a BC member or a Moderator stays the Moderator's alone, and so does provisioning a new account at either rank.

**The seats can never be emptied.** A change that takes BC or Moderator from its last active holder must name a replacement in the same save: any active Member, the person making the change included (the one self-change allowed). The replacement is given the rank first, then the change applies, in one transaction; each writes its own `role_history` row and Notification naming the real actor. A replacement who is the last holder of the other leadership rank is refused, unless the Member being changed takes that rank in the same save (the two swap seats). Two such changes made at the same moment are serialized, so neither can count on a holder the other is removing. The Moderator seat's transfer reads as before, and may now be made by BC as well.

# ADR-0004 — Promotion policy: automatic up to Membru Activ, manual above

- **Status:** Accepted
- **Date:** 2026-08-12
- **Amended:** 2026-09-18 — ADR-0009: the level-2 rank is displayed as Voluntar Activ and its rule becomes top x% of the Evaluation Period's Leaderboard plus tenure; Drept de vot is granted only after BC confirms; level 4 (`responsabil`) leaves the ladder
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

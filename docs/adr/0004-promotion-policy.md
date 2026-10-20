# ADR-0004 — Promotion policy: automatic up to Membru Activ, manual above

- **Status:** Accepted
- **Date:** 2026-08-12
- **Amended:** 2026-09-18 — ADR-0009: the level-2 rank is displayed as Voluntar Activ and its rule becomes top x% of the Evaluation Period's Leaderboard plus tenure; Drept de vot is granted only after BC confirms; level 4 (`responsabil`) leaves the ladder
- **Amended:** 2026-09-20 — Moderator is a transferable Role, not a fixed account; a manual Role change notifies the Member and, when it drops them below a Group's Minimum Level, removes them from that Group
- **Amended:** 2026-09-21 — profile grilling: Voluntar → Voluntar Activ has two doors behind one tenure gate (the top x% at a Period's close, or the Promotion Threshold during the following Period); a Retention Signal to BC replaces any downward automation for Voluntar Activ and Drept de Vot; AG Eligibility follows from the Voluntar Activ Role alone; BC seeds the first threshold (superseded 2026-09-27)
- **Amended:** 2026-09-27 — ruling R28: no Period is opened or closed; BC runs Role Evaluations over a chosen date range, of two kinds with one BC-editable Promotion Threshold each; Voluntar → Voluntar Activ is BC-confirmed from a list of Promotion Candidates; only Recrut → Voluntar stays automatic
- **Amended:** 2026-09-29 — ruling R31: every BC member, not only the Moderator, grants and removes the BC and Moderator Roles; whoever removes the last active Moderator or BC member names the replacement in the same change; extended the same day (#917) to the Status of a BC member or Moderator and to provisioning or re-inviting at either rank
- **Amended:** 2026-10-02 — ruling R35 (#983): a Voluntar who holds the required tenure and reaches the Promotion Threshold in force between Role Evaluations becomes a Promotion Candidate at once, not only at the next run; BC still promotes by hand
- **Amended:** 2026-10-18 — ruling R58 (Portofoliu Interne): nothing promotes by the calendar any more, Recrut → Voluntar included; a Membership Cutoff Date replaces tenure; an Eligibility Floor gates who is ranked and the percentile is taken over the eligible alone, in one ranking of every Member below BCE for the Voluntar Activ kind; a run measures its Candidates and Signals against the line it computes; only a UBB student may hold Drept de Vot; a Simulation precedes every finalised run
- **Amended:** 2026-10-20 — R58 amendment (#1089): Portofoliu Interne gets a Setări view, the only place the Eligibility Floor (Prag minim) and the Membership Cutoff Date (Data limită de intrare) are set; a finalised run uses the values in force, records them on its own row and writes back only the share it used, never the Floor or the cutoff
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

Supersedes the 2026-09-20 amendment's "only a Moderator may change the Role … of a Member holding BC or Moderator". **Every active BC member, like the Moderator, grants and removes the BC and Moderator Roles** and changes the Role of a Member who holds either. Nobody changes their own Role, with one exception below. Extended the same day (Alex: "Both, same as roles", #917): every active BC member also changes the Status of a BC member or a Moderator and provisions or re-invites an account at either rank. Deactivating the last active holder of either rank needs a replacement named in the same save, exactly as a Role change does, except that there is no swap: the Member leaving `activ` keeps their rank.

**The seats can never be emptied.** A change that takes BC or Moderator from its last active holder must name a replacement in the same save: any active Member, the person making the change included (the one self-change allowed). The replacement is given the rank first, then the change applies, in one transaction; each writes its own `role_history` row and Notification naming the real actor. A replacement who is the last holder of the other leadership rank is refused, unless the Member being changed takes that rank in the same save (the two swap seats). Two such changes made at the same moment are serialized, so neither can count on a holder the other is removing. The Moderator seat's transfer reads as before, and may now be made by BC as well.

## Amendment (2026-10-02) — a Promotion Candidate the moment they qualify (ruling R35)

Amends the 2026-09-27 amendment's "Voluntar → Voluntar Activ is BC-confirmed". Alex (2026-10-02, issue #983): "when a volunteer is eligible for voluntar activ, add them directly to the list of eligible volunteers, not only when the evaluation period comes".

**Listed at once.** A Voluntar with the required tenure whose net Task Points since the day after the latest Voluntar Activ Role Evaluation's range (all time before any run — the same count Profil shows them) reach the Promotion Threshold in force becomes a Promotion Candidate the moment they do: a row in the candidates list without a run, and one Notification to BC and the Moderator. The list is kept by a refresh that every write able to change who qualifies triggers — an award or a reversal, a threshold edit, a Promotion Rule edit, a change of Role, Status or join date — plus the daily tenure job, for a tenure the calendar alone reaches. A Member listed this way leaves the list again when they stop qualifying; a Member who leaves Voluntar closes their row as before (promoted or superseded, by the actor).

**Runs stand.** A Role Evaluation still supersedes every open row, lists from its range, and computes the next threshold; nothing ranks live and no Retention Signal is raised between runs. After a run, the window restarts and whoever is already at the threshold in it is listed at once. A rejection made between runs holds until the next Voluntar Activ run; a run row's rejection holds for its run only.

**Nothing is promoted.** Decision 1's withdrawal of the automatic Voluntar → Membru Activ stands: BC promotes by hand in the Role panel, and only Recrut → Voluntar by tenure is automatic.

## Amendment (2026-10-18) — Portofoliu Interne: no calendar, an Eligibility Floor, one ranking, the UBB rule (ruling R58)

Design: `docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md`. Alex (2026-10-18): "remove vechime, it doesn't hold to how we work anymore"; "just drop for good the promotion to voluntar"; "only volunteers that are students of BBU are able to become Voluntar cu Drept de Vot, this is a must and won't ever change". Read decision 1 and every earlier amendment as follows.

**Nothing promotes by the calendar.** Decision 1's automatic Recrut → Voluntar is withdrawn: BC promotes Recruți by hand in Roluri like every other Role. The tenure gate of the 2026-09-21 amendment is withdrawn too; in its place a **Membership Cutoff Date**, a calendar day BC sets from Portofoliu Interne at any time, every change audited: a Voluntar who joined on or before it may become a Promotion Candidate, at a run or between runs. Both Promotion Rules, the months, and the daily job go. The trade-off accepted: a cohort is promoted by hand rather than on a timer, because the real criterion ("about a semester in") is a date Interne chooses, never a fixed number of days.

**An Eligibility Floor gates the ranking.** One Task Points value of at least 1, shared by both kinds (Prag minim, the (department meetings + general meetings) / 2 of the Interne document, entered by hand; until it is set no run or Simulation can start): a Member below it in the Evaluation Period is not ranked and does not shape the percentile. The Promotion Threshold a run computes is the Task Points of the last Member inside the kind's top share **of the eligible Members alone** (x = 35 % and y = 25 % by default, both still BC-editable). It is therefore never below the Floor.

**One ranking for the Voluntar Activ kind.** The run ranks every active Member below BCE, Recruți and Voluntari cu Drept de Vot included, in one cohort; the per-Role share of the 2026-09-27 amendment (R28 decision 2) is withdrawn. Recruți are ranked on purpose, since their points are part of the semester's results, though they are never listed. The Adunarea Generală kind still ranks the Voluntar cu Drept de Vot holders alone and has no cutoff: UBB student and Voluntar Activ are the only conditions for that Group, so the run only finds who is no longer active enough.

**A run measures against the line it computes.** A finalised run computes its kind's line from this period's eligible Members and measures its own Promotion Candidates and Retention Signals against it; that line is then in force until the next run of its kind (the live Candidates read it; BC may still edit it by hand). The previous line plays no part in the run, which keeps it beside the new one in its history; a run that ranks nobody computes no line, hands nothing over, lists no Candidate and raises a Signal for every holder. A **Simulation** computes the same with chosen values and writes nothing; only a finalised run is a Role Evaluation, and the share it used becomes the one in force (the Floor and the cutoff are Setări's alone: the run records the values it used on its own row and never writes them back; amended 2026-10-20, R58 amendment, #1089 — the 2026-10-18 text had all three values become the settings in force).

**Retention Signals are stored, and one of them is live.** A Signal is raised for a holder ranked below the line, for a holder left unranked below the Floor, and, for a voter, the moment their Universitate stops being Universitatea Babeș-Bolyai. Points-based Signals come only from a finalised run; the Universitate Signal is live because it is a fact, not a score. Nothing lowers a Role automatically (decision 3 stands). A stored Signal stays open until BC changes the Member's Role, the fact reverses (Universitate back to UBB) or the next run of its kind supersedes it. When the model shipped, the Signals of the latest run of each kind before it were rebuilt from the Notifications that run had sent, one per Member named, and any whose Member's Role had changed since arrived closed. A Signal's Notification opens the Member's Tracker membru page, not Portofoliu Interne, because the Adunarea Generală's BCE Group Responsibles receive it and cannot open Administrare.

**The window between runs.** The Promotion Candidates listed between runs, and the progress Profil shows toward the threshold, count a Voluntar's Task Points from the later of the day after the latest Voluntar Activ run's range and the Points Start Date, so the figure a Member sees and the list BC acts on agree. A run's own Evaluation Period is explicit and ignores the Points Start Date.

**Only a UBB student holds Drept de Vot.** The application refuses to grant Voluntar cu Drept de Vot to a Member whose Universitate is not Universitatea Babeș-Bolyai, an unknown value included. This is a rule of the organization, not a setting: it has no toggle.

**AG Eligibility** is therefore two facts, Voluntar Activ and UBB student; no threshold leads to Drept de Vot, which only BC's confirmation of the adherence form grants.

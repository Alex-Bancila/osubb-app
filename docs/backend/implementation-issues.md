# OSUBB App — Implementation Issues

The build, divided into GitHub issues grouped by epic (milestone), in dependency order.

> **2026-08-19 restructure:** every remaining issue was split into **≤1h student-sized tasks** (label `max-1h`), numbered `x.ya`, `x.yb`, … after their parent. The original one-shot filing script (`scripts/create-github-issues.sh`) is historical — **never re-run it**. The split itself was also a one-shot (issues #43–#112). GitHub is the live source of truth; this file is the map. Full how/why per task: each issue body + the **Road to October** guide (artifact).

**Design source of truth:** `docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md` (incl. **Revision 3**). **Glossary:** `CONTEXT.md`. **Calendar:** `docs/roadmap.md`. **Team workflow:** `docs/team/team-plan.md`.

Legend: ✅ delivered · 🧍 needs a human (browser/account/BC) · everything else is `ready-for-agent`.

---

## Epic 0 — Foundation

- ✅ 0.1 Repo & Supabase scaffold · 0.2 Domain & decision docs · 0.3 Hosted staging project (#1)

## Epic 1 — Database schema

- ✅ 1.1 Enums/roles/departments/guides · 1.2 Members/teams (migration `0001`)
- ✅ 1.3 Tasks & requests (#2, PR #38) · 1.4 Points engine (#3, PR #39)
- ✅ 1.5a events + attendance (#43, PR #114) · 1.5b announcements + reads (#44, PR #115)
- ✅ 1.6a notifications (#45, PR #116) · 1.6b suppression bc+bce + push_tokens (#46, PR #117)
- **#47 1.7a** ag_eligibility view · **#48 1.7b** ag_quorum_top25 view
- **#6 1.8** P1 deltas: `profiles.joined_at` + `points_ledger.note`
- _(Phase 2)_ **#49 1.9a** promotion_rules · **#50 1.9b** role_history · **#51 1.9c** detect_promotions() · **#52 1.9d** promotion job + notification (ADR-0004)

## Epic 2 — Auth & login

- ✅ 2.2 JWT claims hook + auth_*() helpers (#10, PR #40)
- **#53 2.1a** verify + document local auth config · 🧍 **#54 2.1b** staging dashboard checklist (hook, URLs) · 🧍 **#55 2.1c** Google OAuth (Phase 2)
- ✅ 2.3a provision_profile() RPC (#56, PR #119) · **#57 2.3b** invite-member Edge Function · **#58 2.3c** invite e2e + runbook

## Epic 3 — RLS & permissions

- ✅ 3.1 Capabilities + RLS everywhere (#12, PR #41) · 3.3 Tasks & points policies (#14, PR #42)
- 🔎 **#59 3.2a** profiles read + contact gating _(PR #122, in review — adds `auth_is_member()`)_ · **#60 3.2b** self-edit + role-change guard · ✅ 3.2c teams + reference-data policies (#61, PR #120) · **#123 3.2d** apply `auth_is_member()` to the reference-data policies
- 🔎 **#62 3.4a** event visibility + write _(PR #125)_ · **#63 3.4b** RSVP policies
- 🔎 **#64 3.5a** announcements _(PR #124)_ · **#65 3.5b** notifications (suppression) · **#66 3.5c** Interne gating + push_tokens
- Merge the review stack bottom-up: **#122 → #124 → #125**.
- **#67 6.1u** umbrella: per-role suite complete (tests ship inside each policy issue)

## Epic 4 — Business logic

- **#68 4.2a** in-app notification fan-out (v1!) · **#69 4.2b** deadline reminder job · 🧍 **#70 4.2c** push provider (Phase 2, ADR at build)
- **#71 4.1a** CSV parser module · **#72 4.1b** csv-import Edge Function · **#73 4.1c** CSV e2e + runbook

## Epic 5 — Seed & demo data

- ✅ 5.1 Lookup seed (migration `0001`)
- **#74 5.2a** demo people (one login/role) · **#75 5.2b** demo tasks + points · **#76 5.2c** demo events/announcements/notifications

## Epic 6 — Testing

- ✅ 6.2 Points-engine tests (#21, PR #39) · per-role suites land inside each Epic-3 issue → tracked by **#67 6.1u**

## Epic 7 — Deploy & CI

- ✅ 7.1 CI + staging auto-push (#22)
- 🧍 **#77 7.2a** production project on Pro (Sprint 3) · **#78 7.2b** gated production deploy workflow

## Epic 8 — Frontend foundation

- **#79 8.1a** frontend mini-spec · **#80 8.1b** scaffold `app/` · **#81 8.1c** frontend CI
- **#82 8.2a** client + session provider · **#83 8.2b** login (magic link) · **#84 8.2c** shell + role-gated nav · **#85 8.2d** guards + no-profile screen
- **#86 8.3a** generated DB types · **#87 8.3b** query conventions + first hooks

## Epic 9 — Screens (mirroring the mockup)

- Tracker _(demo gate)_: **#88 9.1a** my tasks · **#89 9.1b** open + claim · **#90 9.1c** create · **#91 9.1d** grading · **#92 9.1e** requests
- Dashboard _(demo gate)_: **#93 9.2a** points card · **#94 9.2b** mini-leaderboard · **#95 9.2c** dept cup
- Calendar: **#96 9.3a** list · **#97 9.3b** RSVP · **#98 9.3c** create/edit
- Announcements: **#99 9.4a** feed · **#100 9.4b** compose · **#101 9.4c** notifications screen + badge
- Volunteers: **#102 9.5a** directory · **#103 9.5b** member detail/edit
- BC panel: **#104 9.6a** award/sanction · **#105 9.6b** roles · **#106 9.6c** requests queue · **#107 9.6d** CSV import UI
- Profile: **#108 9.7a** profile screen

## Epic 10 — Launch ops

- 🧍 **#109 10.1a** first Cloudflare Pages deploy · **#110 10.1b** previews + env
- 🧍 **#111 10.2a** BC/BCE sheet mapping doc · **#112 10.2b** import script (one-shot, dry-run first)
- 🧍 **#36 10.3** BC/BCE onboarding (Oct 1) · **#37 10.4** org-wide rollout umbrella (Phase 2)

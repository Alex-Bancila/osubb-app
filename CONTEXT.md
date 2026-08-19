# OSUBB App — Domain Context & Glossary

The **ubiquitous language** for the OSUBB app. Use these exact terms in code, table/column names, issue titles, tests, and docs. Romanian terms are the organization's real vocabulary; the English is the code-level name.

> Consumed by the engineering skills via `docs/agents/domain.md`. The authoritative data model lives in `docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md`; this file is the shared glossary.

## The organization

- **OSUBB** — *Organizația Studenților din Universitatea Babeș-Bolyai*, a student NGO in Cluj. This app is its internal tool for tasks, points, calendar, announcements, and the volunteer database.
- **BC** — *Biroul de Conducere* (the board / leadership). Highest operational authority in-app.
- **BCE** — *Biroul de Conducere Extins* (extended board, e.g. the IT Coordinator). One level below BC.
- **AG / AGO** — *Adunarea Generală (Ordinară)*, the general assembly where voting members decide org matters.

## People & structure

- **Member** (`profiles`) — one person in the org, tied to a Supabase Auth user. Has a **Role**, a **Status**, and belongs to one or more **Departments** and **Teams**.
- **Role** (`member_role`) — one of eight, each with a numeric **Level** that drives permissions:
  `recrut`(0) · `voluntar`(1) · `activ`/Membru Activ(2) · `vot`/Drept de vot(3) · `responsabil`(4) · `bce`(5) · `bc`(6) · `moderator`(9).
- **Level** — the integer rank of a Role. Permissions are expressed as thresholds (e.g. "manage tasks = level ≥ 4"), **not** as per-role lists.
- **Status** (`member_status`) — `activ` | `inactiv` | `alumni`. `alumni` keeps history for people who left.
- **Department** (`departments`) — the five real ones: **Educational** (`edu`), **Imagine & PR** (`pr`), **Tineret** (`youth`), **Financiar** (`fin`), **Resurse Umane** (`hr`). Plus two non-department units: **IT** (`it`, a *coordination* unit led by the IT Coordinator — not a department) and **org** (a pseudo-scope meaning "whole organization").
- **Team** (`teams`) — a working group inside a department (e.g. *Echipa Aplicație*). Has a **lead**, a `for_recruits` flag (recruits may see it), and an `is_interne` flag (the VP-Interne team).
- **Interne** — the *Vicepreședinte Interne* + *Echipa Interne*, who track AG eligibility. Their sheets are visible only to BC-level members.

## Tasks & points

- **Task** (`tasks`) — a unit of work. Has a **Difficulty**, an optional **Rating** (null until graded), a **Status**, a deadline, a department/team, and one or more assignees.
- **Difficulty** — 1–5 stars; how hard the task is.
- **Rating** — 1–5; the quality grade a task receives when reviewed. Drives a **Multiplier**: 1→−1, 2→0, 3→+1, 4→+2, 5→+3.
- **Points** — awarded per graded task: `Points = Difficulty × Multiplier(Rating)`. A rating of 1 is a **penalty** (negative points).
- **Points Ledger** (`points_ledger`) — the append-only source of truth for every point change (graded tasks, manual awards, penalties). A member's total is the **sum** of their ledger; never store a running total on the member.
- **Task Status** (`task_status`) — `todo` | `progress` | `done` | `overdue` | `open`. **open** = unassigned, first-taker: any member may claim it.
- **Task Request** (`task_requests`) — a member's proposal to **award points** or **create a task**, awaiting approval by a level ≥ 4 member.
- **Tier** — a display band derived from points + role (Recrut → Voluntar → Membru Activ → …).
- **Promotion Rule** (`promotion_rules`) — a configurable threshold that promotes automatically (ADR-0004): Recrut→Voluntar after one semester (time), Voluntar→Membru Activ at a BC-set points threshold. Roles level ≥ 3 (vot, responsabil, bce, bc, moderator) change **only manually**; demotions are never automatic. Every change lands in **Role History** (`role_history`, actor `'system'` for automatic ones).
- **Sanction** — a negative manual ledger entry granted by BC (`points_ledger.reason = 'sanction'`) with a reason note; the member is notified. Sanctions appear in the AGO report.
- **Leaderboard** / **Cupa departamentelor** ("Departments' Cup") — rankings of members / departments by total points (SQL views over the ledger).

## Calendar, announcements, notifications

- **Event** (`events`) — calendar entry with a **Type** (`sedinta`, `activitate`, `call`, `eveniment`, `deadline`, `recrutare`) and a **Scope**.
- **Scope** (`event_scope`) — who can see an event: `team` | `dept` | `project` | `org`. Governs calendar visibility together with role level.
- **Announcement** (`announcements`) — an org message with a **Priority** (`critical` | `important` | `normal`), optionally **pinned**, optionally linking a form.
- **Notification** (`notifications`) — a per-recipient alert of a **Kind** (`announce`, `deadline`, `event`, `task`, `system`).
- **Suppression** (`notif_suppression`) — role-based rule that hides certain notification kinds from a role: **BC and BCE do not receive broadcast task/event/deadline notifications** (spec Revision 3, resolution 2 — supersedes the older bc-only wording). Notifications about a member's **own** tasks are always delivered.
- **Fan-out** — the server-side act of turning one event (an announcement, a deadline) into one `notifications` row per intended recipient, applying Suppression via the lookup, never hardcoded roles.

## Governance thresholds

- **AG eligibility** — a member with **≥ 300 points** may participate in the AG.
- **Quorum / top-25%** — the top 25% of eligible members keep their voting right at each AGO.

## Access model (see ADR-0003)

- **Invite-only** — anyone may *authenticate* (email or Google), but access requires a BC-provisioned `profiles` row. No self-service sign-up; RLS denies everyone without a profile.
- **Magic link** — the passwordless login email an invited member receives; the only way accounts come into existence. Nobody generates or distributes passwords.
- **Provisioning** — creating the `profiles` row + department/team links for an invited auth user, atomically, via one shared server-side path (single invite and CSV import both use it).
- **Claims** — the member's `member_role`, `member_level`, `dept_ids`, `team_ids`, stamped into the JWT at login by the custom access-token hook. RLS helpers (`auth_level()`, `auth_role()`, `auth_in_dept()`, `auth_in_team()`) read only these.
- **RLS** — *Row-Level Security*: all authorization lives in Postgres policies, keyed off the Claims. The client holds no authority. The database is **deny-by-default**: every table has RLS enabled; a role sees only what an explicit policy grants.
- **Capability** (`role_capabilities`) — a named permission derived from Level thresholds (e.g. `manageTasks` = level ≥ 4, `manageRoles` = level ≥ 6), stored as data so BC can adjust without code. UI reads it for nav gating; policies use `auth_level()` directly.

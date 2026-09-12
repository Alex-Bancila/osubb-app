# OSUBB App — Roadmap (mandate 2026–2027)

> **Historical** — superseded by [`CLAUDE.md`](../CLAUDE.md)'s Status section and the live GitHub issue graph for what's next.
>
> Kept for provenance; where it conflicts with `CLAUDE.md`, `CONTEXT.md`, or the ADRs, those win.

Delivery calendar for the mandate. Scope authority: architecture spec (incl. **Revision 3** traceability — every mandate item is mapped to a phase there). Issues: `docs/backend/implementation-issues.md`. Team operating model: `docs/team/team-plan.md`. Rollout decisions: ADR-0005.

## North-star dates

| Date                | Gate                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| **~15 Sep 2026**    | Full core-app **demo to BC** on staging (auth + Task Tracker + Dashboard; calendar/announcements stretch) |
| **1 Oct 2026**      | **Live for BC/BCE** (~20 people) — replaces the leadership Google Sheets tracker                          |
| **end of Nov 2026** | **Org-wide** — all members, recruits onboarded via CSV during the recruitment campaign                    |

## Sprint calendar (2-week sprints + 3-day review buffer)

| Sprint                              | Dates                                     | Contents (issue numbers)                                                                                                                                                                             | Exit gate                                                             |
| ----------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Sprint 0** (compressed, parallel) | Aug 13–19                                 | Team trainings ×3 (see team plan) · env setup · 0.3 staging project                                                                                                                                  | Every team member has the local stack running                         |
| **Sprint 1** — foundation slice     | Aug 13–26 (review 27–29)                  | Backend in order: 1.3 → 1.4+6.2 → 1.8 → 2.2 → 3.1 → 3.3 (+6.1 subset) → 2.1 → 2.3. Frontend in parallel: 8.1 → 8.2 → 10.1 (staging deploy)                                                           | Invited user logs in; a graded task moves the leaderboard, RLS-tested |
| **Sprint 2** — the tracker          | Aug 30–Sep 12 (review 13–15)              | 8.3, 9.1 Task Tracker, 9.2 Dashboard, 5.2 demo seed                                                                                                                                                  | 🎯 **BC demo Sep 15**                                                 |
| **Sprint 3** — go-live              | Sep 16–29 (review 30)                     | 1.5+3.4+9.3 calendar · 1.6+3.5+9.4 announcements/notifications · 9.5 directory · 9.6 BC panel + 4.1 CSV import · 1.7 AG views · 9.7 profile · 7.2 production · 10.2 data migration · 10.3 onboarding | 🎯 **BC/BCE live Oct 1**                                              |
| **Phase 2** — org-wide              | Oct–Nov                                   | 1.9 promotion engine (ADR-0004) · notification prefs · overlap detection · P2 schema deltas (templates, is_primary, birthday, events.status) · 4.2 push (provider ADR) · 10.4 rollout at recruitment | 🎯 **Org-wide by end of Nov**                                         |
| **Phase 3** — integrations          | Dec–Feb _(exams mid-Jan–Feb: light load)_ | QR check-in → points · ICS calendar feed · AGO report + sanctions report (`ago_sessions`) · AG extras (Demisie AG, agenda points) · `projects` entity                                                | First AGO report exported from the app                                |
| **Phase 4** — subsystems            | Mar–Jun _(exams Jun)_                     | HR recruitment pipeline · native forms/feedback engine · volunteer contracts — each starts with its own brainstorm → spec                                                                            | Autumn-2027 recruitment runnable in-app                               |

## Success metrics (mandate-aligned)

- Demo delivered Sep 15 · BC/BCE live Oct 1.
- 100% of BC/BCE tasks tracked in-app by the first AGO.
- ≥80% of active members with accounts by Dec 1.
- Every department has run ≥1 event through the calendar by Dec.
- ≥2 volunteers with 5+ merged PRs by Nov (bus-factor metric).

## Deferred-decisions log

| Decision                                              | Default                                         | Decide when                                                          |
| ----------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| Push provider (spec §8.3)                             | OneSignal (free, role/dept tag targeting)       | Phase 2, before 4.2 — gets its own ADR                               |
| Calendar sync depth                                   | Read-only ICS feed per member                   | Phase 3; OAuth write-back only if ICS proves insufficient            |
| Native app stores                                     | Not for launch (ADR-0005)                       | When the phone surface demands it; Apple nonprofit waiver + Play $25 |
| Forms engine (native vs Google Forms)                 | Google Forms links (`announcements.form_label`) | Phase 4, own spec                                                    |
| Membru Activ points threshold + scoring-guide content | Placeholder seed                                | **BC meeting** — agenda item (Direcții 1.2 assigns it to BC)         |

## Risk register

| Risk                                                       | Mitigation                                                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Mid-Sept demo is tight (1–3 students + Alex)               | Claude on `ready-for-agent` issues; demo gate is auth+tracker+dashboard only; cut breadth (directory, BC panel), never RLS tests |
| RLS subtly wrong → data leak between roles                 | pgTAP per-role suite (6.1) gates every policy PR; policies live in one place                                                     |
| Student capacity dips (recruitment Oct, exams Jan–Feb/Jun) | Phases shaped around the academic calendar; no launches in exam windows                                                          |
| Bus factor = Alex                                          | Recorded trainings, docs/ADRs current, ≥2 volunteers per area by Nov, everything in issues                                       |
| Real-data migration mismatch (10.2)                        | Import script diffed against the sheet; Alex signs off totals before go-live                                                     |
| Supabase free tier pauses after 7 idle days                | Staging: acceptable; production created directly on Pro with Spend Cap ON (7.2)                                                  |

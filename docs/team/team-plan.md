# OSUBB App — Team Plan (Echipa Aplicație)

Operating model for the volunteer dev team, per the mandate commitments (`docs/org/plan-managerial.md` §IV.6). Current shape: **small core (1–3 volunteers) + Alex**. Echipa Site-uri (WordPress → GitHub Pages) is a separate stream and not covered here.

## Roles

| Who | Role |
|---|---|
| Alex | Tech lead · product owner · reviewer of every PR (initially) |
| Volunteer 1 (backend-leaning) | SQL / migrations / RLS — pairs with Claude on `ready-for-agent` issues |
| Volunteer 2 (frontend-leaning) | Ionic/React screens (Epic 8–9) |
| Volunteer 3 (if present) | QA · demo data · docs · release notes |

Names/availability to be slotted by Alex when the core is confirmed.

## Sprint 0 — onboarding (this week, compressed)

Three **recorded** sessions, ≤2h each (recordings double as onboarding for autumn recruits and mitigate the bus factor):

1. **Git/GitHub & the workflow** — clone, branch, PR, review, the issue board, triage labels.
2. **Working with Claude Code** — live: pick a `ready-for-agent` issue → implement → PR. The AI-agents training promised in the mandate.
3. **Architecture walkthrough** — the spec, `CONTEXT.md` vocabulary (use it in PRs/issues), the RLS mental model ("the client holds no authority").

Environment checklist per member: Docker Desktop · Node · `npx supabase start` green · can run the mockup · GitHub access.

## Cadence (mandate-committed)

- **2-week sprints + 3-day review buffer**: Alex reviews everything, merges stragglers, preps the next sprint so it starts unblocked.
- **Weekly 30-min sync** + async check-ins Mon/Thu in the org chat.
- **Demo at every sprint end** — Sep 15 is the BC demo; monthly BC demos after.
- **One-to-ones** at sprint boundaries and on request (mandate promise).

## Work rules

- **Everything is a GitHub issue.** Labels drive flow: `ready-for-agent` = fully specced, do it with Claude; `ready-for-human` = needs judgment/design; `needs-triage` cleared weekly by Alex (see `docs/agents/triage-labels.md`).
- **One issue = one PR** into `main`; CI must be green (migrations apply + pgTAP per-role suite). *(Enforced branch protection isn't available on a free-plan private repo — the rule is discipline for now; apply for [GitHub for Nonprofits](https://github.com/nonprofit) or move to an org plan to enforce it.)*
- **Review:** Alex reviews every PR until two volunteers have each landed ~5; then peer review, with Alex retained on migrations/RLS (the security core).
- **Spec-first for new features:** brainstorm → `docs/superpowers/specs/` → issues. Use `CONTEXT.md` terms everywhere.
- **Definition of Done:** migration applies on `db reset` · pgTAP green (incl. per-role) · PR reviewed · deployed to staging · issue AC checked off.
- **Branch protection on `main`:** Required status checks are `Migrations + db tests`, `Edge Function checks`, and `Frontend checks`. One approving review is required; linear history is optional. Enabling protection is a human action in [repo settings](https://github.com/Alex-Bancila/osubb-app/settings/branches).

## Mentorship & growth

- Alex pairs on each volunteer's **first two issues**.
- Goal: a volunteer runs the sprint demo by Phase 2; ≥2 volunteers with 5+ merged PRs by Nov.
- Mentorship covers management too (mandate §IV.6): sprint planning shadowing in Phase 2+.

## Capacity honesty

Students: semester starts Oct (recruitment-campaign load), exam sessions mid-Jan–Feb and Jun. The roadmap phases are shaped around this — **never schedule a launch inside an exam window**, and treat Phase 3 (Dec–Feb) as half-capacity.

## Bus-factor mitigations

Recorded trainings · docs/ADRs kept current (they gate PRs) · everything in issues, nothing in DMs · ≥2 people familiar with each area by Nov · secrets in the team Bitwarden, never in git.

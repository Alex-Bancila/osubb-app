# ADR-0009 — Groups: one entity for Departments, Teams, Projects, and the Adunarea Generală

- **Status:** Accepted
- **Date:** 2026-09-18
- **Amended:** 2026-09-20 — Wave 2 as built: `create_event`'s Group signature, `update_event` / `cancel_event`, Campaign ownership by any Group, and the retirement of the level-4 Calendar gate
- **Deciders:** Alex Băncilă (grilling session of 2026-09-18)
- **Supersedes:** the work-origin, Campaign, and authorization sections of ADR-0007; the scope model and management rules of ADR-0008; the Voluntar → Membru Activ rule of ADR-0004 (each amended by reference, none retired)
- **Superseded by:** —
- **Related:** ADR-0003, ADR-0004, ADR-0007, ADR-0008, `CONTEXT.md`, `docs/backend/conventions.md`

> **Amended 2026-09-20 — what Wave 2 actually landed.** The decision below stands; these are the shapes it took, recorded so the ADR can be read against the schema.
>
> - **`create_event` takes the owning Group, not a scope.** `create_event(p_title, p_type, p_group_id, p_starts_at, p_ends_at, p_location, p_capacity, p_description, p_min_level)` — the Group is the third argument and is required; everything after `p_starts_at` defaults. An unknown, archived, or unauthorized Group is refused as `42501 calendar_manage_forbidden`, so an id no one may use is indistinguishable from an id that does not exist; naming no Group at all is the caller's mistake, not a refusal, and answers `PT400 event_group_required` ahead of every gate (#370).
> - **Two new commands complete the Calendar triple.** `update_event(p_event_id, p_title, p_type, p_group_id, p_starts_at, p_ends_at, p_location, p_capacity, p_description, p_min_level)` replaces an Event's whole content state and demands authority over both the old and the new Group when it moves one; `cancel_event(p_event_id, p_reason)` keeps the row and requires a reason. Both keep the Organization Group's creator-only rule, with BC and Moderator overriding it.
> - **Moving an Event onto the Organization Group takes `create_event`'s rule, not the Group-Manager rule.** `update_event` normally re-runs `require_group_work_manager` on the target Group, but an Organization-Group **target** is admitted by level ≥ 6 or by holding any live Group Role anywhere — the same rule that lets a Department Coordonator raise an organization-wide Event (#370). It has to be: the Organization Group is _a_ root with no ancestor of its own, like every Department, Independent Team, and Project Group, so nobody could ever reach it through an ancestor role. This is a deliberate widening — any Group Responsible may pull an Event they already manage onto the organization calendar. `created_by` is not rewritten by a move, so a Responsible who moves someone else's Event there loses the right to edit it again the moment they do (the Organization **source** rule is creator or level ≥ 6), while the original creator keeps it. The target's `status = 'active'` requirement belongs to the move alone: an edit that leaves an Event in its own, since-archived Group is decided by the source rule by itself, so such an Event stays correctable by whoever may still manage it instead of being cancel-only (#248).
> - **The level-4 Calendar gate is gone.** No Calendar command reads `member_level >= 4`; Event authority is the Group Role on the owning Group's path, and `events.min_level` now admits only `{0, 3, 5, 6}` (`events_min_level_ck`), with staging rows at 4 moved up to 5 rather than down.
> - **A Campaign belongs to any Group.** `campaigns.group_id` is the owner and `create_campaign(p_group_id, p_name)` is the Group-side command; the Department-only `create_campaign(p_department_id, p_name)` survives Wave 2 only as a compatibility overload, disambiguated by parameter name, and goes in Wave 3.
> - **`tasks`, `events`, `campaigns`, and `completed_work_requests` each carry `group_id`** with a `*_sync_group_origin` `before` trigger bridging it to the legacy columns in both directions. `events.scope` is derived, never written by a command. `docs/backend/conventions.md` §10 is the working rulebook for all of this, including the trigger-ordering rule the bridge depends on.

## Context

Before this decision, the completed Tracker backend repeated authority rules across three structures. Departments, Teams, and Projects are three tables with three roster tables, and the `private` helpers deciding who may read, manage, or evaluate a Task carried a `dept_id / team_id / project_id` branch; migrations and pgTAP suites repeated the shape. Adding the Adunarea Generală, Project teams, or any body OSUBB invents next means new tables and new branches in every helper.

The vocabulary is also split. `responsabil` is a global rank at level 4 in `member_role`, and `responsible` is a per-Project role in `project_members`; Events gate "Responsible+" on the rank while the Tracker gates on the Project role. The Department Cup depends on `departments.kind`, Campaigns are Department-only, and organization-wide Events hang off an `org` pseudo-department row.

Alex asked for a generalization: everything in OSUBB works under the umbrella of a Group, created and constrained by BC, with one set of rules.

## Decision

### Groups

A **Group** is one entity. BC or Moderator creates a top-level Group with a custom name and settings; a Group's Managers create its Child Groups. Every Task Origin and every Event Scope is a Group.

A Group carries **settings, not a kind**:

| Setting                        | Meaning                                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parent Group                   | Optional, to any depth: a Child Group may have Child Groups of its own; cycles are impossible.                                                        |
| Competes in the Department Cup | Top-level only. On for the five departments; off for Diverse, Secretariat, every Project, every Independent Team, and the AG.                         |
| Counts toward the parent's Cup | Child only, default on. A Group's Task Points reach the Cup of its nearest competing ancestor only when this setting is on at every link of the path. |
| Minimum Level                  | Join and visibility gate (below).                                                                                                                     |
| Accepts Applications           | On or off, with an Application Level at or above the Minimum Level.                                                                                   |
| Shared Work Visibility         | Every member sees every Task of the Group. Pre-filled on for the Team category, off otherwise.                                                        |
| Automatic Membership           | Every active Member at or above the Minimum Level belongs; the roster follows the Role and is never edited by hand.                                   |
| Position display names         | What this Group calls its Group Manager ("BCE", "Coordonator Principal") and each Group Responsible ("Responsabil Logistică").                        |
| Lifecycle                      | Active or archived; archiving keeps history.                                                                                                          |

**Department**, **Project**, and **Team** are presentation categories chosen at creation. They pre-fill settings and label the interface. No authority, visibility, membership, notification, or Cup rule may branch on the category, and a conventions test enforces it.

Two Groups are special only by their settings. The **Organization Group** ("OSUBB") is a root Group with Automatic Membership at Minimum Level 0; it replaces the `org` pseudo-department and the `org` Event scope, so organization-wide Events and Opportunities are its Events and Opportunities. The **Adunarea Generală** is a Group BC creates and names, with Automatic Membership at Minimum Level 3, Cup off, and Applications off; its teams are Child Groups and its Events follow the normal rules.

### Minimum Level

A Member below a Group's Minimum Level cannot join it, cannot be assigned or appointed into it, and does not see the Group, its org-wide Opportunities, or its Events. Holding a Group Role on the Group or on one of its ancestors overrides that gate for the Group row and its roster, because authority flows down the chain. A Child Group's Minimum Level is at least its parent's. An Event may raise the bar with its own Minimum Level but never lower it below its Group's. A creator cannot set a Minimum Level above their own Level; Moderator is exempt, as ADR-0008 already rules for Events. Event Minimum Level choices become 0, 3, 5, and 6.

### Entry paths

Two ways into a Group, the same everywhere. **Appointment**: a Group Manager, a Group Responsible, BC, or Moderator adds a Member directly; Provisioning appoints the initial Department. **Application**: a Member at or above the Application Level asks to join a Group that accepts Applications, and a Group Manager or Responsible accepts or declines. There is no instant self-join and no "primary Department" flag: the initial Department is simply the first membership. Departments set Minimum 0 and Application 1, so a Recrut is placed but only a Voluntar applies; Projects set both to 0.

### Group Roles

Every Group has the same three positions: **Group Manager**, **Group Responsible**, and ordinary membership.

- BC or Moderator appoints the Group Managers (one or more) of a top-level Group; the parent's Group Managers appoint a Child Group's, and authority flows down the whole chain: an ancestor's Group Managers and Responsibles hold their positions in every Group below.
- A Group Manager appoints Group Responsibles, each under its own custom display name.
- A Group with no Group Manager is run by the Group Managers of its nearest ancestor that has one, or by BC and Moderator when none does.
- An **Independent Team** is a top-level Group in the Team category with no Group Manager in which every member is a Group Responsible: they jointly manage its planned work, and BC or Moderator evaluates theirs. This reproduces ADR-0007's Independent Team without a special case.

BCE remains a rank and is also the display name of a Department's Group Manager; the two are linked by Appointment, never by the schema. Coordonator Principal is the display name of a Project's Group Manager, appointed by BC or Moderator; Responsabil de Proiect is a Group Responsible of a Project.

### Ranks

The organization-wide Role ladder has seven ranks: Recrut 0, Voluntar 1, Voluntar Activ 2, Voluntar cu Drept de Vot 3, BCE 5, BC 6, Moderator 9. Level 4 is retired and its number stays unused so nothing is renumbered. A higher Role holds every attribute of the Roles below it. Level 2 is displayed as Voluntar Activ; the identifier `activ` does not change.

Every rule that gated on level 4 — Events' "Responsible+", organization-wide Event creation, the UI's `manageTasks: 4` — is re-expressed as **holds a Group Role** (Group Manager or Group Responsible somewhere), derived live from rosters rather than from claims. A Coordonator Principal who is a Voluntar stays level 1 globally; all their authority lives in their Project.

### Authority

One matrix, five rows, applied to a Group and every Group below it:

| Actor             | May                                                                                                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BC / Moderator    | Everything, everywhere: create and archive top-level Groups, appoint their Managers, change Roles, manage and evaluate any Task.                                                                                                                                                                  |
| Rank BCE          | Read everything: every Task, every roster, the leadership metrics. Write nothing by rank alone.                                                                                                                                                                                                   |
| Group Manager     | Everything inside the Group and every Group below it: roster, Applications, Group Responsibles, Child Groups, Campaigns, Events, and every Task, including evaluating Group Responsibles and their own Task.                                                                                      |
| Group Responsible | Ordinary members' Tasks, Applications, and Events in the Group and every Group below it. May create a Task for themselves but never manages or evaluates their own Task, another Group Responsible's, or a Group Manager's; those go to the Group Manager, or to BC/Moderator when there is none. |
| Ordinary member   | Own Tasks and Candidatures, the Opportunities their Groups' Minimum Levels admit, and every Task of a Group whose Shared Work Visibility is on.                                                                                                                                                   |

Direct assignment may still target any active Member (ADR-0007), except one below the Group's Minimum Level. The Task Manager remains the Task's creator; where ADR-0007 says "the Origin's managers", read the Group's Managers, then its ancestors' from the nearest up, then BC. Leadership metrics stay gated at rank 5 and above, and their Department, Team, and Project filters become one Group filter that includes every Group below it.

### Campaigns

A Campaign is a label owned by one Group, any Group. It tags Tasks whose Origin is that Group or any Group below it and is managed by the owning Group's Managers and Responsibles. It has no roster, no roles, and no Minimum Level, and it is never an Origin.

### Calendar

An Event is owned by one Group. Wave 2 stores `events.group_id`; the origin-sync trigger maintains the legacy scope and foreign keys until Wave 3 removes them. A Group's Managers and Responsibles, and those of its ancestors, create, edit, and cancel its Events. Anyone holding a Group Role may create an Event in the Organization Group; only its creator or BC/Moderator edits or cancels it. `create_event` accepts the owning Group directly; `update_event` replaces the full content state, requires authority over both source and target when moving an Event, and `cancel_event` preserves the Event with a required reason. Important changes notify the relevant roster and going attendees through the shared notification helper with a `/calendar` link; text and capacity-only edits do not fan out. Relevance, RSVP, capacity, and important-change notifications keep ADR-0008's rules with "the member's Departments, Teams, and Projects" read as "the member's Groups".

### Promotion hooks

Promotion rules are deferred behind the Tracker and Calendar, but the schema leaves these hooks. BC opens and closes named **Evaluation Periods**, typically AGO to AGO. Recrut → Voluntar stays ADR-0004's automatic tenure rule. Voluntar → Voluntar Activ is automatic when a Member is in the top x% of the Period's Leaderboard and has at least the required tenure, measured from the exact join date (#160). Voluntar Activ → Voluntar cu Drept de Vot is human-confirmed: reaching the threshold sends the adherence form to BC, and only BC's confirmation grants the Role, which through Automatic Membership seats the Member in the Adunarea Generală. When a Period closes, the top y% ranking is shown to BC, who withdraws Drept de Vot by hand; nobody is demoted automatically, as ADR-0004 already rules.

### Management surface

One "Administrare" area, scoped by authority. BC and Moderator see the whole Group tree and may create top-level Groups, change Roles, run Evaluation Periods, and provision Members. A Group Manager or Responsible sees only their Groups and, inside one, the roster, Applications, Group Roles, Child Groups, Campaigns, and settings. The same screen is reached from the panel by BC and from a Group's page by its Managers, so there is one flow and one command set. #103, #105, and #107 fold into it.

### Other rulings

- Interne's duty of tracking AG eligibility is expressed by appointing its members Group Responsibles of the Adunarea Generală; the `is_interne` flag is retired. Interne itself stays a Department Team of Diverse.
- Diverse and Secretariat are Departments whose Cup setting is off; `departments.kind` has no successor.
- A Member with the retired `responsabil` rank is re-ranked by BC before the value is dropped; the migration refuses to run while a holder remains.

### Migration

A strangler in three waves, every PR merged green, each wave its own plan:

1. **Wave 1 — schema.** Add `groups`, `group_members` with the Group Role, the settings above, and the Organization Group; backfill from `departments`, `teams`, `projects`, `member_departments`, `team_members`, and `project_members`; keep those tables as the write master, mirrored one way into `groups`/`group_members` by triggers (no compatibility views); add `group_ids` to the organization claims. Wave 1's `groups_read` publishes every active Group to every Member at or above its Minimum Level, which for the backfilled rows is 0 — so Team and Project names become organization-visible before Wave 2 re-expresses `teams_read`/`projects_read`, and Team/Project rosters become visible to rank BCE. Accepted: it is ADR-0009's end state and the shadow carries no personal data beyond membership.
2. **Wave 2 — authority and commands (implemented by #519–#524, #370, and #248).** Tracker authority and command decisions read Group Roles, paths, and settings; legacy Origin signatures remain compatibility inputs. `tasks`, `events`, `campaigns`, and `completed_work_requests` carry `group_id` with two-way Origin-sync triggers. Campaigns are owned by any Group, leadership filters include descendants, Department Cup follows settings at every ancestor link, and Calendar creation/update/cancellation use Group authority. `conventions.test.sql` enforces the category-word boundary; the 23-step smoke test exercises allowed and refused Group behavior. This closeout branch contains the implementation; consult the PR graph before treating the entire stack as merged to `main`.
3. **Wave 3 — Group administration and cleanup (next).** Ship Group settings/roster/appointment/application commands and the Administrare surface, finish moving frontend consumers to Groups, then remove compatibility signatures, legacy structure/Origin columns and tables, mirror and bridge triggers, `groups.legacy_*`, the `event_scope` enum, and the retired level-4 rank. Regenerate database types from the resulting schema.

## Consequences

- One roster and one authority helper family replace three; a new kind of body is a row, not a migration.
- Groups nest to any depth, so authority, visibility, Campaign tagging, and Cup attribution walk the ancestor chain. Wave 1 stores each Group's ancestor path and forbids cycles; the helpers read that path rather than recursing per row.
- Until Wave 3 dedupes legacy names, the sibling-name rule binds native Groups only.
- ADR-0007, ADR-0008, and ADR-0004 are amended by reference in their headers; `CONTEXT.md` is updated in the same change; house rule 13 in `CLAUDE.md` names this ADR.
- The pinned `private` roster, the claimless sweep, the points authorization matrix (#262), and the actor-helper suites now prove the Wave 2 matrix; the Tracker smoke script exercises four additional Group scenarios.
- `capabilities.ts` loses `manageTasks: 4`; management controls render from server capability rows, as the 2026-09-18 Tracker plan already requires.
- Issues to reframe: #47, #48, #49–#52 on Evaluation Periods; #66 on the Adunarea Generală roster; #103, #105, #107 into Administrare; #354 filters by Group; #248 and #370 by Group Role; #160 becomes a Wave 1 prerequisite. New issues are filed per wave.
- Until Wave 3 lands, code still speaks `dept_id / team_id / project_id`; new authority written in the meantime must read Groups, never add a fourth branch.

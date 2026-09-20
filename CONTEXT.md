# OSUBB App — Domain Context

The shared language for the OSUBB app. Use these terms consistently in product discussions, issue titles, tests, and user-facing Romanian copy. Architectural and implementation decisions belong in `docs/adr/`, not in this glossary.

## Organization

**OSUBB**:
Organizația Studenților din Universitatea Babeș-Bolyai, the student NGO whose internal work this application supports.

**BC**:
Biroul de Conducere, the organization’s highest operational leadership group.

**BCE**:
Biroul de Conducere Extins, the extended leadership group immediately below BC.

**AG / AGO**:
Adunarea Generală / Adunarea Generală Ordinară, where voting members make organization decisions. In the application the Adunarea Generală is a Group with Automatic Membership at Minimum Level 3, created and named by BC; a Member joins it by gaining Drept de Vot and leaves it only when BC withdraws that Role.

## Members and structure

**Member**:
A person recognized as part of OSUBB. A Member has one organizational Role, one Membership Status, and belongs to Groups, holding a Group Role in each.
_Avoid_: User, account, volunteer when referring to every possible role

**Role**:
One of the seven organization-wide ranks: Recrut, Voluntar, Voluntar Activ, Voluntar cu Drept de Vot, BCE, BC, or Moderator. A higher Role holds every attribute of the Roles below it. Coordonator Principal and Responsabil are Group Roles, not Roles.
_Avoid_: Rank, grade, position; Membru Activ; Role alone where a Group Role is meant

**Level**:
The number attached to a Role: 0, 1, 2, 3, 5, 6, or 9; 4 is no longer used. Level decides what a Member may see or join across OSUBB; authority inside a Group comes only from a Group Role.

**Membership Status**:
Whether a Member is active, inactive, or alumni. Only an active Member may perform organization work in the application.
_Avoid_: Task status

**Group**:
A named body of OSUBB people and work, created by BC or Moderator with its own name and settings. A Group holds one roster of Members with Group roles and one Minimum Level. Departments, Teams, Projects, and the Adunarea Generală are Groups; every Task Origin and Event Scope is a Group.
_Avoid_: Scope, structure, org unit, entity

**Child Group**:
A Group created inside a parent Group and overseen by the parent's Group Managers; a Child Group may have Child Groups of its own, to any depth. A Department Team is a Child Group of its Department; a Child Group's Task Points count toward the Department Cup of its nearest competing ancestor when every Group on the path is set to count.
_Avoid_: Sub-team, child team, nested team

**Group Category**:
The presentation label chosen when a Group is created: Department, Project, or Team. It pre-fills the Group's settings and names it in the interface; no authority, visibility, or Cup rule depends on it.
_Avoid_: Kind, type, group type

**Minimum Level**:
The lowest Level allowed to join a Group or to discover it and what it publishes, such as its Opportunities and Events. A Child Group's Minimum Level is at least its parent's, an Event may raise it but never lower it, and a creator cannot set it above their own Level.
_Avoid_: Min level, access level, role gate

**Group Role**:
The position a Member holds in one Group: Group Manager, Group Responsible, or ordinary membership. The same three positions exist in every Group.
_Avoid_: Project role, team role, local role

**Group Manager**:
A Member appointed to run a Group: its roster, Group Responsibles, Child Groups, work, and Events. BC or Moderator appoints the Group Managers of a top-level Group; the parent's Group Managers appoint a Child Group's, and the position carries down to every Group below. The Group's settings give the position its display name, such as BCE or Coordonator Principal. A Group with no Group Manager is run by the Group Managers of its nearest ancestor that has one, or by BC and Moderator.
_Avoid_: Lead, leader, coordinator, owner; Manager alone where it could be read as Task Manager

**Group Responsible**:
A Member appointed by a Group Manager to manage the ordinary members, their work, and the Events of a Group and every Group below it, under a custom display name. A Group Responsible never manages or evaluates the Tasks of a Group Manager or of another Group Responsible.
_Avoid_: Deputy, sub-manager, co-lead

**Appointment**:
A Group Manager, Group Responsible, BC, or Moderator adding a Member to a Group directly. Provisioning uses an Appointment to place a new Member in their initial Department.
_Avoid_: Assignment (a Task term), invite, enrolment

**Application**:
A Member's request to join a Group that accepts applications, made at or above the Group's Application Level and accepted or declined by a Group Manager or Group Responsible.
_Avoid_: Join request, call form, candidature (a Task term)

**Application Level**:
The lowest Level allowed to apply to a Group, never below its Minimum Level. A Member below it may still be placed by Appointment.
_Avoid_: Apply level, join level

**Shared Work Visibility**:
A Group setting under which every member sees every Task of the Group, not only their own. It is pre-filled on for the Team category and off for the others; it never grants management authority.
_Avoid_: Team visibility, open board, transparency mode

**Automatic Membership**:
A Group setting under which every active Member at or above the Group's Minimum Level belongs to it. The roster follows each Member's Role, is never edited by hand, and accepts no Applications; Group Roles are still appointed.
_Avoid_: Derived roster, virtual group, implicit membership

**Organization Group**:
The root Group named OSUBB, with Automatic Membership at Minimum Level 0, so every active Member belongs to it. Organization-wide Events and Opportunities are its Events and Opportunities.
_Avoid_: Org scope, org pseudo-department, everyone group

**Department**:
A top-level Group in the Department category: Educațional, Imagine & PR, Tineret, Financiar, or Resurse Umane, which compete in the Department Cup; or Diverse and Secretariat, which share every Department setting except competing.

**Diverse**:
The Department hosting the IT and Interne Department Teams. Its Cup setting is off, so it never competes in the Department Cup.

**Secretariat**:
The organization's secretariat, a Department whose Cup setting is off, so it never competes in the Department Cup.

**Project**:
A top-level Group in the Project category, independent of Departments and never in the Department Cup. Its Group Manager is the Coordonator Principal; its Group Responsibles carry custom names. Any Member may belong to a Project.

**Coordonator Principal**:
The display name of a Project's Group Manager, appointed by BC or Moderator.
_Avoid_: Project Lead, leader, team lead

**Responsabil de Proiect**:
A Group Responsible of a Project, shown under the custom display name chosen at appointment.
_Avoid_: Project Responsible, project manager

**Team**:
A Group in the Team category: a Child Group of any other Group, or an Independent Team with no parent.

**Department Team**:
A Child Group of a Department in the Team category, overseen by the Department's Group Managers.

**Independent Team**:
A top-level Group in the Team category with no parent Group and no Group Manager: every member is a Group Responsible, so they jointly manage its planned work while BC or Moderator manages its roster and evaluates their Tasks.

**Interne**:
The Vicepreședinte Interne and Echipa Interne, a Department Team of Diverse. Its members track AG eligibility and voting-right information as Group Responsibles of the Adunarea Generală.

## Task Tracker

**Task**:
A planned or recognized unit of OSUBB work with one Origin, one Audience, one Assignment Mode, and a defined lifecycle.

**Task Origin**:
The Group that owns a Task. Every Task has exactly one Origin.
_Avoid_: Scope when ownership is meant

**Task Audience**:
Whether a public Task opportunity is local to its Origin Group or open to every Member its Minimum Level admits.

**Assignment Mode**:
Whether a Task is assigned directly to one active Member or offered publicly through the Candidate Queue.

**Campaign**:
A label owned by one Group that tags Tasks whose Origin is that Group or any Group below it. A Campaign filters the Tracker, Leaderboard, and Department Cup; it is not an Origin, has no roster, and is managed by the owning Group's Managers and Responsibles.
_Avoid_: Campaign as a Task Origin

**Umbrella Task**:
A Task that groups Subtasks one level deep. It has no Executor, Candidate Queue, Difficulty, Rating, or Task Points and is completed by its Task Manager only when every Subtask is terminal.

**Subtask**:
An ordinary Task whose Origin is inherited immutably from its Umbrella Task.

**Task Manager**:
The Member who created a Task, recorded by the server. They receive the Task's manager notifications; when they are the actor or no longer active, the Origin's managers receive them instead.

**Executor**:
The one Member currently accountable for completing a Task.
_Avoid_: Assignee for the current accountable person

**Assignment**:
A historical record of a Member serving as a Task’s Executor. A Task may have several Assignments over time but at most one active Executor.

**Opportunity**:
A public Task whose Candidate Queue is open to eligible Members.
_Avoid_: Open status

**Candidate**:
A Member who has expressed interest in a public Task and is waiting, selected, withdrawn, or closed in its queue.

**Candidate Queue**:
The ordered list of Candidates for a public Task after the first eligible Member becomes Executor.

**Give Up**:
An Executor’s recorded decision to leave a Task before review, with a required explanation and preserved history.

**Task Status**:
The current lifecycle stage: To do, In progress, In review, Completed, Unfulfilled, or Cancelled.
_Avoid_: Open and Overdue as statuses

**Overdue**:
An unfinished Task whose deadline has passed. Overdue is a condition derived from time, not a lifecycle stage. A Task completed after its deadline is shown as completed late.

**Feedback pending**:
The derived condition of an In-progress Task that a Reviewer returned with a note. It is shown as a badge and filter, never stored as a status.

**Unfulfilled**:
The terminal outcome of an overdue Task evaluated as not delivered. It carries Difficulty and Rating like a completion and may award zero or negative Task Points to the Executor.
_Avoid_: Failed

**Task Activity**:
The immutable chronological history of Task lifecycle, assignment, queue, evaluation, and cancellation events.

**Evaluation**:
The final review that sets Difficulty and Rating together and determines Task Points for the active Executor. Difficulty is not proposed at creation.

**Difficulty**:
A 1–5 estimate of how demanding a Task is.

**Rating**:
A 1–5 assessment of the quality of completed work.

**Task Points**:
Points produced by a completed Task’s Difficulty and Rating. They belong only to the evaluated Executor.

**Points Ledger**:
The append-only history of every change contributing to a Member’s Personal Score.

**Personal Score**:
The total visible to an individual Member from their own Points Ledger entries.

**Leadership Leaderboard**:
A BCE/BC/Moderator view of Members ordered by Task Points only.

**Department Cup**:
A BCE/BC/Moderator comparison of Task Points earned in the top-level Groups set to compete and in every Group below them set to count toward them. Project and Independent-Team work never contributes.

**Completed-work Request**:
A Member’s request to recognize work already completed for one Origin. Approval creates the completed Task, Assignment, Evaluation, and Task Points together.
_Avoid_: Award request, new-task request, `task_requests`

**Sanction**:
A deferred BC/Moderator action that may reduce a Member’s Personal Score and must include a visible explanation.

## Calendar

**Event**:
A future or past OSUBB activity owned by one Group.

**Event Scope**:
The Group that owns an Event. An organization-wide Event belongs to the Organization Group.

**Relevant Event**:
An Event of a Group the Member belongs to, which includes every Event of the Organization Group.

**Other OSUBB Event**:
A visible Event of a Group the Member does not belong to, presented separately until the Member answers “Vin”.

**RSVP**:
A Member’s “Vin” or “Nu vin” response to an Event.

**Capacity**:
Informational attendance guidance for an Event. It does not reject an RSVP or create a waitlist.

## Communication

**Announcement**:
An OSUBB message that may have normal, important, or critical Priority and may link to an external form.

**Notification**:
A personal in-app alert delivered to one intended Member.

**Suppression**:
A rule preventing selected broadcast notification kinds from reaching a Role while preserving direct notifications about a Member’s own work.

**Fan-out**:
Turning one organization event into targeted Notifications for its intended recipients.

## Governance

**Evaluation Period**:
A named span of time opened and closed by BC, typically from one AGO to the next, within which Task Points are ranked for Promotion Rules and the vote re-check.
_Avoid_: Season, scoring window, semester when the ranking window is meant

**Promotion Rule**:
A BC-set rule that moves a Member to a higher Role. Automatic for Recrut to Voluntar (tenure) and for Voluntar to Voluntar Activ (a top share of the Evaluation Period's Leaderboard plus tenure); human-confirmed for Voluntar Activ to Voluntar cu Drept de Vot; never automatic downward.
_Avoid_: Auto-promotion, level-up, threshold alone

**AG Eligibility**:
The qualification a Voluntar Activ reaches under the Promotion Rule for Drept de Vot. It sends the adherence form to BC; only BC's confirmation grants the Role and, through Automatic Membership, a seat in the Adunarea Generală.

**Vote Retention Threshold**:
The top share of the Evaluation Period's Leaderboard a Voluntar cu Drept de Vot must reach to keep the Role. BC decides each withdrawal by hand after the Period closes; nobody is removed automatically.
_Avoid_: Quorum, Top 25%

## Access

**Invite-only Access**:
The rule that only a person provisioned by OSUBB leadership becomes a Member of the application.

**Magic Link**:
The passwordless email link used by a provisioned Member to sign in.

**Provisioning**:
Creating the organization membership information associated with an invited person, including their initial Department by Appointment.

**Organization Claims**:
The signed membership facts attached to a session, including Role, Level, and the Groups the Member belongs to.

**Capability**:
A named product action available at or above an organizational Level, without replacing Group Role authority.

## Term → identifier

Where a term above is not spelled the same way in the schema. Use the Term in prose and Romanian copy; use the identifier in code, migrations, issues, and tests. Read from `supabase/migrations/0001_core_schema.sql` unless noted otherwise.

**Department id → name**:
`edu` → Educațional (the identifier never carries the diacritic; only the display name does — corrected in `supabase/migrations/20260911004317_educational_display_name.sql`) · `pr` → Imagine & PR · `youth` → Tineret · `fin` → Financiar · `hr` → Resurse Umane · `diverse` → Diverse · `secretariat` → Secretariat. `it` is retired (`supabase/migrations/20260910173341_departments_diverse_secretariat.sql` folds it into `diverse`) — don't reuse it for a new Department Team.

**`activ` as a Role vs. `activ` as a Status**:
Two different columns share this identifier. `profiles.role = 'activ'` is the Role Voluntar Activ (`member_role` enum, level 2); `profiles.status = 'activ'` is the Membership Status active (`member_status` enum). A row can be `role = 'activ', status = 'inactiv'` — a Membru Activ who is not currently active — so never assume one from the other.

**`profiles` rows are Members**:
`public.profiles` is the Member table; there is no separate `members` table. Every `member_id` column elsewhere is a foreign key to `profiles (id)`, not to an identity table of its own — see `points_ledger.member_id`, `notifications.member_id`, `project_members.member_id`, and the rest.

**`event_scope` ↔ Event Origin**:
The legacy enum backing an Event's Origin: `org`, `dept`, `team`, or `project`. The Group model replaces the four values with the owning Group, the Organization Group standing in for `org`. From Wave 2 the enum is derived by trigger from `events.group_id` — no command writes `scope` any more — and it is dropped, with the enum itself, in Wave 3.

**`noti_kind` ↔ Notification kind**:
The enum distinguishing what a Notification is about: `announce`, `deadline`, `event`, `task`, or `system`.

**`roles.id` → Role display name**:
`recrut` → Recrut · `voluntar` → Voluntar · `activ` → Voluntar Activ · `vot` → Voluntar cu Drept de Vot · `responsabil` → retired: level 4 is no longer a rank, and Responsabil de Proiect is a Group Role · `bce` → BCE · `bc` → BC · `moderator` → Moderator.

**Group → `groups`; Group Role → `group_members.group_role`**:
`group_members.group_role` spells the three Group Roles as `manager` → Group Manager, `responsible` → Group Responsible, and `member` → ordinary membership. `groups.category` is the Group Category (Department, Project, Team, or the one Organization root); `groups.path` is the root-first ancestor chain, ending in the row's own id. `legacy_dept_id` / `legacy_team_id` / `legacy_project_id` name the legacy `departments` / `teams` / `projects` row that still masters a Wave 1 Group — the six legacy tables remain the structure write master, mirrored by trigger, while Wave 2 authority reads Groups — and are dropped in Wave 3.

**Organization Group → the `groups` row with `legacy_dept_id = 'org'`**:
The root Group named OSUBB, with `automatic_membership = true` so every active Member belongs to it. Never the `departments` row itself, which is the legacy row this Group mirrors, not the Group. It is also `create_event`'s organization rule: an organization-wide Event is one created with this row's id as `p_group_id`, which any holder of a Group Role anywhere may do, and which only its creator or BC/Moderator may then `update_event` or `cancel_event`.

**Group settings → `groups` columns**:
Minimum Level → `groups.min_level` · Application Level → `groups.application_level` · Shared Work Visibility → `groups.shared_work_visibility` · Automatic Membership → `groups.automatic_membership` · the Group Manager's display name → `groups.manager_title` · the two Department Cup settings → `groups.competes_in_cup` and `groups.counts_toward_parent_cup`. Wave 2 reads all of them; until Wave 3 ships the Group commands, only a migration, a mirror, or a rolled-back test fixture writes one.

**`group_ids` claim**:
The organization claim listing the Groups a Member explicitly belongs to, via `group_members` rows only, memberships of archived Groups included — Automatic Membership is derived from Role and Minimum Level and is never in the token, the same rule `dept_ids`/`team_ids` already follow.

**Work ownership → `group_id`**:
`tasks.group_id`, `events.group_id`, `campaigns.group_id`, and `completed_work_requests.group_id` name one owning Group. Wave 2's two-way Origin triggers keep the legacy columns consistent until Wave 3 removes them. Organization-wide Events belong to the Organization Group (`groups.legacy_dept_id = 'org'`); an organization-wide Task Audience opens an Opportunity beyond its owning Group and does not move its Origin.

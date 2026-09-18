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
Adunarea Generală / Adunarea Generală Ordinară, where voting members make organization decisions.

## Members and structure

**Member**:
A person recognized as part of OSUBB. A Member has one organizational Role, one membership Status, and may belong to Departments, Teams, and Projects.
_Avoid_: User, account, volunteer when referring to every possible role

**Role**:
One of the eight organization positions: Recrut, Voluntar, Membru Activ, Voluntar cu Drept de Vot, Responsabil, BCE, BC, or Moderator.

**Level**:
The ordered authority associated with a Role. A higher Level may grant broader organizational responsibility, but membership in a Department, Team, or Project still determines local authority.

**Membership Status**:
Whether a Member is active, inactive, or alumni. Only an active Member may perform organization work in the application.
_Avoid_: Task status

**Group**:
A named body of OSUBB people and work, created by BC or Moderator with its own name and settings. A Group holds one roster of Members with Group roles and one Minimum Level. Departments, Teams, Projects, and the Adunarea Generală are Groups; every Task Origin and Event Scope is a Group.
_Avoid_: Scope, structure, org unit, entity

**Child Group**:
A Group created inside a parent Group and overseen by the parent's managers. A Department Team is a Child Group of its Department; a Child Group's Task Points count toward its parent's Department Cup only when both are set to compete.
_Avoid_: Sub-team, child team, nested team

**Group Category**:
The presentation label chosen when a Group is created: Department, Project, Team, or Adunarea Generală. It pre-fills the Group's settings and names it in the interface; no authority, visibility, or Cup rule depends on it.
_Avoid_: Kind, type, group type

**Minimum Level**:
The lowest Level allowed to join a Group or to discover it and what it publishes, such as its Opportunities and Events. A Child Group's Minimum Level is at least its parent's, an Event may raise it but never lower it, and a creator cannot set it above their own Level.
_Avoid_: Min level, access level, role gate

**Department**:
A top-level Group in the Department category: Educațional, Imagine & PR, Tineret, Financiar, or Resurse Umane, which compete in the Department Cup; or Diverse and Secretariat, which share every Department setting except competing.

**Diverse**:
The coordination structure hosting the IT and Interne Department Teams. It is a Department for Task Origins and authority and is excluded from the Department Cup.

**Secretariat**:
The organization's secretariat, modeled as a Department for Task Origins and authority and excluded from the Department Cup.

**Project**:
A temporary or ongoing body of work independent of Departments. A Project has one Project Lead, Members, and may have Project Responsibles.

**Project Lead**:
The active Project Member who manages Project membership, Project Responsibles, and Project work.
_Avoid_: Team lead

**Project Responsible**:
An active Project Member trusted to manage Project work alongside the Project Lead.
_Avoid_: Project manager when the organizational role is meant

**Team**:
A working group whose Members share a work context. A Team is either a Department Team or an Independent Team and does not have a single internal lead.

**Department Team**:
A Child Group of a Department in the Team category, overseen by that Department's managers.

**Independent Team**:
A top-level Group in the Team category, with no parent Group. Its active Members jointly manage its planned work, while BC or Moderator manages membership.

**Interne**:
The Vicepreședinte Interne and Echipa Interne, a Department Team of Diverse flagged `is_interne`, responsible for tracking AG eligibility and voting-right information.

## Task Tracker

**Task**:
A planned or recognized unit of OSUBB work with one Origin, one Audience, one Assignment Mode, and a defined lifecycle.

**Task Origin**:
The Department, Project, or Team that owns a Task. Every Task has exactly one Origin.
_Avoid_: Scope when ownership is meant

**Task Audience**:
Whether a public Task opportunity is local to its Origin or open across OSUBB.

**Assignment Mode**:
Whether a Task is assigned directly to one active Member or offered publicly through the Candidate Queue.

**Campaign**:
A Department-owned label grouping Tasks whose Origin is that Department or one of its Department Teams. A Campaign filters the Tracker, Leaderboard, and Department Cup; it is not an Origin and has no members.
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
A BCE/BC/Moderator comparison of Task Points earned in the top-level Groups set to compete and in their Child Groups set to count toward them. Project and Independent-Team work never contributes.

**Completed-work Request**:
A Member’s request to recognize work already completed for one Origin. Approval creates the completed Task, Assignment, Evaluation, and Task Points together.
_Avoid_: Award request, new-task request, `task_requests`

**Sanction**:
A deferred BC/Moderator action that may reduce a Member’s Personal Score and must include a visible explanation.

## Calendar

**Event**:
A future or past OSUBB activity owned by the organization, a Department, a Team, or a Project.

**Event Scope**:
The organization structure that owns an Event: organization, Department, Team, or Project.

**Relevant Event**:
An organization Event or an Event belonging to one of the Member’s Departments, Teams, or Projects.

**Other OSUBB Event**:
A visible Event outside the Member’s own structures, presented separately until the Member answers “Vin”.

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

**AG Eligibility**:
The qualification that allows a Member to participate in the AG after reaching the accepted Task-Point threshold.

**Quorum / Top 25%**:
The ranking rule used to determine which eligible Members retain voting rights at an AGO.

## Access

**Invite-only Access**:
The rule that only a person provisioned by OSUBB leadership becomes a Member of the application.

**Magic Link**:
The passwordless email link used by a provisioned Member to sign in.

**Provisioning**:
Creating the organization membership information associated with an invited person.

**Organization Claims**:
The signed membership facts attached to a session, including Role, Level, Departments, and Teams.

**Capability**:
A named product action available at or above an organizational Level, without replacing local Department, Team, or Project authority.

## Term → identifier

Where a term above is not spelled the same way in the schema. Use the Term in prose and Romanian copy; use the identifier in code, migrations, issues, and tests. Read from `supabase/migrations/0001_core_schema.sql` unless noted otherwise.

**Department id → name**:
`edu` → Educațional (the identifier never carries the diacritic; only the display name does — corrected in `supabase/migrations/20260911004317_educational_display_name.sql`) · `pr` → Imagine & PR · `youth` → Tineret · `fin` → Financiar · `hr` → Resurse Umane · `diverse` → Diverse · `secretariat` → Secretariat. `it` is retired (`supabase/migrations/20260910173341_departments_diverse_secretariat.sql` folds it into `diverse`) — don't reuse it for a new Department Team.

**`activ` as a Role vs. `activ` as a Status**:
Two different columns share this identifier. `profiles.role = 'activ'` is the Role Membru Activ (`member_role` enum, level 2); `profiles.status = 'activ'` is the Membership Status active (`member_status` enum). A row can be `role = 'activ', status = 'inactiv'` — a Membru Activ who is not currently active — so never assume one from the other.

**`profiles` rows are Members**:
`public.profiles` is the Member table; there is no separate `members` table. Every `member_id` column elsewhere is a foreign key to `profiles (id)`, not to an identity table of its own — see `points_ledger.member_id`, `notifications.member_id`, `project_members.member_id`, and the rest.

**`event_scope` ↔ Event Origin**:
The enum backing an Event's Origin: `org`, `dept`, `team`, or `project`.

**`noti_kind` ↔ Notification kind**:
The enum distinguishing what a Notification is about: `announce`, `deadline`, `event`, `task`, or `system`.

**`roles.id` → Role display name**:
`recrut` → Recrut · `voluntar` → Voluntar · `activ` → Membru Activ · `vot` → Voluntar cu Drept de Vot (the database's `roles.name` still reads "Membru cu Drept de Vot" — known drift; the glossary term wins) · `responsabil` → Responsabil (the database's `roles.name` still reads "Responsabil de proiect" — known drift; the glossary term wins) · `bce` → BCE · `bc` → BC · `moderator` → Moderator.

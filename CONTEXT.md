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

**Nickname**:
The short name a Member chooses for themselves, shown wherever the application names them; when unset, the full name stands in. A Member changes their own Nickname; BC and Moderator may change anyone's. The full name itself is changed only by BC or Moderator.
_Avoid_: Display name, alias, username, handle

**Member Card**:
The summary opened from any Member's name: Nickname, full name, Role, join date, and Groups. Contact details appear only to viewers already allowed to read them; Task Points and rank never appear.
_Avoid_: Profile pop-up, tooltip, user card

**Group**:
A named body of OSUBB people and work, created by BC or Moderator with its own name and settings. A Group holds one roster of Members with Group roles and one Minimum Level. Departments, Teams, Projects, and the Adunarea Generală are Groups; every Task Origin and Event Scope is a Group.
_Avoid_: Scope, structure, org unit, entity

**Child Group**:
A Group created inside a parent Group and overseen by the parent's Group Managers; a Child Group may have Child Groups of its own, to any depth. Its parent is chosen at creation and never changes; a wrongly placed Group is archived and created again. A Department Team is a Child Group of its Department; a Child Group's Task Points count toward the Department Cup of its nearest competing ancestor when every Group on the path is set to count.
_Avoid_: Sub-team, child team, nested team

**Group Category**:
The presentation label chosen when a Group is created: Department, Project, or Team. It pre-fills the Group's settings and names it in the interface; no authority, visibility, or Cup rule depends on it.
_Avoid_: Kind, type, group type

**Minimum Level**:
The lowest Level allowed to join a Group or to discover it and what it publishes, such as its Events. A Child Group's Minimum Level is at least its parent's, an Event may raise it but never lower it, and a creator cannot set it above their own Level.
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
A Member's request to join a Group that accepts applications, made at or above the Group's Application Level and accepted or declined by a Group Manager or Group Responsible. A Group may instead point applicants to an external form through an Attached Link; joining then happens by Appointment.
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

**Private Group**:
A Group setting under which the Group, every Group below it, and their Tasks and Events are visible only to their members, to the Group Managers and Group Responsibles on its path, and to BC and Moderator. A Private Group accepts no Applications and offers no organization-wide Opportunity; a Member enters it by Appointment and sees it from that moment.
_Avoid_: Hidden group, secret group, invite-only group

**Group Audience**:
Every active Member of a Group or of any Group below it, whether through a roster row or through Automatic Membership. A Group's Announcements and the important changes to its Events reach its Group Audience, and a Member's Relevant Events are those of the Groups whose Audience they are in. Task notifications never use it; they target the Executor, the Task Manager, and the Candidates.
_Avoid_: Recipients, subscribers, the roster when Automatic Membership is meant

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
Whether a public Task is visible and joinable only by the Origin Group's members or by every active Member; a directly assigned Task carries the local Audience.
_Avoid_: Visibility, scope

**Assignment Mode**:
Whether a Task is assigned directly to one active Member or offered publicly through the Candidate Queue.

**Campaign**:
A label owned by one Group that tags Tasks and Events whose Origin is that Group or any Group below it. A Campaign filters the Tracker, the Calendar, the Leaderboard, and the Department Cup; it is not an Origin, has no roster, earns points only through its Tasks, and is managed by the owning Group's Managers and Responsibles.
_Avoid_: Campaign as a Task Origin

**Work Filter**:
The one filter every page uses to narrow Tasks, Events, Campaigns, and Leaderboard rows: a top-level Group, then a Group below it, then a Campaign, then a date range. Choosing a Group always means that Group and every Group below it; the Campaign choices are those able to tag a Task in the chosen Group. The date range reads a Task's deadline, an Event's start, or the day Task Points were awarded.
_Avoid_: Origin filter, scope filter, search when the filter is meant

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
The arrival-ordered list of every Member who expressed interest in a public Task. Nobody becomes Executor by arriving first: the Task Manager selects the Executor from the queue, and selects again when an Executor gives up.
_Avoid_: Waitlist, first come first served

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

**Submission Note**:
The optional note an Executor attaches when submitting a Task for review, with at most one Attached Link. It is part of the Task's history and is what the reviewer reads first.
_Avoid_: Feedback (the reviewer's note), completion description, comment

**Attached Link**:
One labelled external address carried by an Announcement, a Task, or a Submission Note, shown as a button under its label. Text fields stay plain text and never carry links themselves.
_Avoid_: Form link, URL field, inline link

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
An Event of a Group whose Group Audience includes the Member, which includes every Event of the Organization Group.

**Other OSUBB Event**:
A visible Event of a Group the Member does not belong to, presented separately until the Member answers “Vin”.

**RSVP**:
A Member’s “Vin” or “Nu vin” response to an Event.

**Capacity**:
Informational attendance guidance for an Event. It does not reject an RSVP or create a waitlist.

## Communication

**Announcement**:
An OSUBB message posted on behalf of one Group, its Origin, by one of that Group's Managers or Responsibles, with an Announcement Audience, a normal, important, or critical Priority, and an optional link to an external form. An Announcement of the Organization Group may be posted by anyone holding a Group Role.
_Avoid_: Post, news item, broadcast when the Audience is local

**Announcement Audience**:
Whether an Announcement reaches only the Group Audience of its Origin or every active Member of OSUBB. A Group may speak to the whole organization without ceasing to be the Origin.
_Avoid_: Scope, visibility, org-wide flag

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
A BC-set rule that moves a Member to a higher Role. Automatic for Recrut to Voluntar (tenure) and for Voluntar to Voluntar Activ, which needs the required tenure counted from the join date plus either a top share of the Evaluation Period's Leaderboard when the Period closes or, during the following Period, passing the Promotion Threshold; human-confirmed for Voluntar Activ to Voluntar cu Drept de Vot; never automatic downward. A Member below the required tenure is neither promoted nor notified.
_Avoid_: Auto-promotion, level-up, threshold alone

**Promotion Threshold**:
The Task Points the last Member inside the top share held when an Evaluation Period closed. It stays constant through the following Period as the visible target a Voluntar with the required tenure must pass to become Voluntar Activ; BC seeds it by hand before the first Period closes.
_Avoid_: Cutoff, minimum points, prag alone

**Retention Signal**:
The automatic notice BC receives when an Evaluation Period closes with a Voluntar Activ or a Voluntar cu Drept de Vot below the share of the Leaderboard their Role requires. BC decides each withdrawal by hand; nobody loses a Role automatically.
_Avoid_: Demotion, auto-demotion, downgrade

**AG Eligibility**:
The qualification every Voluntar Activ holds by Role, because that Role already required both tenure and the Promotion Threshold. Promotion to Voluntar Activ offers the adherence form; only BC's confirmation of it grants Drept de Vot and, through Automatic Membership, a seat in the Adunarea Generală. There is no second threshold.
_Avoid_: Drept de Vot threshold, AG threshold

**Vote Retention Threshold**:
The top share of the Evaluation Period's Leaderboard a Voluntar cu Drept de Vot must reach to keep the Role. BC decides each withdrawal by hand after the Period closes; nobody is removed automatically.
_Avoid_: Quorum, Top 25%

## Access

**Invite-only Access**:
The rule that only a person provisioned by OSUBB leadership becomes a Member of the application.

**Magic Link**:
The passwordless email link used by a provisioned Member to sign in. The same email carries a six-digit Sign-in Code that completes the same sign-in where the link cannot reach the app, such as the installed app on iPhone or a second device.
_Avoid_: OTP in user-facing copy; password

**Provisioning**:
Creating the organization membership information associated with an invited person, including their initial Department by Appointment.

**Organization Claims**:
The signed membership facts attached to a session, including Role, Level, and the Groups the Member belongs to.

**Capability**:
A named product action available at or above an organizational Level, without replacing Group Role authority.

**Privacy Notice**:
The versioned statement of what OSUBB does with a Member's personal data, who processes it and what rights the Member has; the current version is shown in the application and approved by BC.
_Avoid_: GDPR page, terms, consent form, cookie policy

**Privacy Acknowledgement**:
A Member's one-time confirmation that they have read a given version of the Privacy Notice, recorded with the time; BC and Moderator can see who has acknowledged the current version. It is a record of information given, not a consent.
_Avoid_: GDPR approval, acceptance, agreement

**Release**:
The deliberate, human-approved act of carrying `main` into the production environment. Distinct from Promotion, which is a Member moving up a Role.
_Avoid_: Promote to production, deploy (in the sense of production), push to prod

## Term → identifier

Where a term above is not spelled the same way in the schema. Use the Term in prose and Romanian copy; use the identifier in code, migrations, issues, and tests. Read from `supabase/migrations/0001_core_schema.sql` unless noted otherwise.

**`activ` as a Role vs. `activ` as a Status**:
Two different columns share this identifier. `profiles.role = 'activ'` is the Role Voluntar Activ (`member_role` enum, level 2); `profiles.status = 'activ'` is the Membership Status active (`member_status` enum). A row can be `role = 'activ', status = 'inactiv'` — a Membru Activ who is not currently active — so never assume one from the other.

**`profiles` rows are Members**:
`public.profiles` is the Member table; there is no separate `members` table. Every `member_id` column elsewhere is a foreign key to `profiles (id)`, not to an identity table of its own — see `points_ledger.member_id`, `notifications.member_id`, `group_members.member_id`, and the rest.

**`noti_kind` ↔ Notification kind**:
The enum distinguishing what a Notification is about: `announce`, `deadline`, `event`, `task`, or `system`.

**`roles.id` → Role display name**:
`recrut` → Recrut · `voluntar` → Voluntar · `activ` → Voluntar Activ · `vot` → Voluntar cu Drept de Vot · `bce` → BCE · `bc` → BC · `moderator` → Moderator.

**Group → `groups`; Group Role → `group_members.group_role`**:
`group_members.group_role` spells the three Group Roles as `manager` → Group Manager, `responsible` → Group Responsible, and `member` → ordinary membership. `groups.category` is the Group Category (Department, Project, Team, or the one Organization root); `groups.path` is the root-first ancestor chain, ending in the row's own id. The Wave 1 backfill keys (`legacy_dept_id` / `legacy_team_id` / `legacy_project_id`) were dropped in Wave 3 (#591); a Group is identified by its id, and sibling names are unique across every Group. The `departments`/`teams`/`projects` tables themselves, and their roster tables, were dropped in #590 — there is no legacy row left for a Group to mirror.

**Organization Group → `groups.is_organization`**:
Exactly one active root Group carries this marker. Its Automatic Membership and Minimum Level zero make every active Member part of its audience. Calendar commands use the marker, never the Group's name or category: any holder of a Group Role may create its Events, while only the creator or BC/Moderator may edit or cancel them.

**Application → `group_applications`**:
A pending request to join a Group, resolved through `apply_to_group`, `withdraw_group_application`, and `decide_group_application`. Acceptance uses the shared Appointment core.

**Role and Membership Status History → `role_history`**:
An audit row for each organizational Role or Membership Status change, with the actor and optional reason. Historical rank names are retained even when a rank is retired; new Role commands accept only the seven live ranks.

**Group settings → `groups` columns**:
Minimum Level → `groups.min_level` · Application Level → `groups.application_level` · Shared Work Visibility → `groups.shared_work_visibility` · Automatic Membership → `groups.automatic_membership` · the Group Manager's display name → `groups.manager_title` · the two Department Cup settings → `groups.competes_in_cup` and `groups.counts_toward_parent_cup`. The Group structure and settings commands own these writes; the browser never updates the table directly.

**`group_ids` claim**:
The organization claim listing the Groups a Member explicitly belongs to, via `group_members` rows only, memberships of archived Groups included — Automatic Membership is derived from Role and Minimum Level and is never in the token. It is the only roster claim: the `dept_ids`/`team_ids` claims were removed in #591.

**Work ownership → `group_id`**:
`tasks.group_id`, `events.group_id`, `campaigns.group_id`, `completed_work_requests.group_id`, and `announcements.group_id` name one owning Group. Organization-wide Events use the Organization Group marker; an organization-wide Task or Announcement Audience opens visibility beyond its owning Group without changing its Origin.

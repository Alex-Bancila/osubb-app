# OSUBB App — Domain Context

The shared language for the OSUBB app. Use these terms consistently in product discussions, issue titles, tests, and user-facing Romanian copy. Architectural and implementation decisions belong in `docs/adr/`, not in this glossary.

## Organization

**OSUBB**:
Organizația Studenților din Universitatea Babeș-Bolyai, the student NGO whose internal work this application supports.

**BC**:
Biroul de Conducere, the organization’s highest operational leadership group. Every active BC member, like the Moderator, grants and removes the BC and Moderator Roles, changes the Membership Status of a Member holding either, and invites new Members at either rank. The organization always keeps at least one active BC member: whoever removes the last one names who replaces them in the same change. Every active BC member is a member of every Group by that Role (a Membru de drept), yet receives no Task, Event or Announcement Notification through that membership; only what asks them to decide, concerns them personally, or comes with a position they hold reaches them. A BC member may hold the Group Manager or the Group Responsible position of any Group or Child Group — each Department's Vicepreședinte is a Manager, and in Biroul de Conducere the Responsible title is the Board Title — and that position brings the Group's notices as it would for anyone: its Tasks, Events and Announcements, for that Group and every Group below it (ruling R42, 2026-10-07). A BC member who holds a Board Title is named by it wherever the app names their Role.

**BCE**:
Biroul de Conducere Extins, the extended leadership group immediately below BC. A Department's Group Responsibles are its BCE members, each under their own display name. A BCE member who holds a Board Title is named by it wherever the app names their Role.

**Board Title** (Funcția în OSUBB):
The display name of a BC or BCE member's function — Președinte, Vicepreședinte Executiv, Coordonator IT — held as their Group Responsible title in the Biroul de Conducere Group (decision D1, #824) and shown wherever the app names their Role.
_Avoid_: function, position

**Vicepreședinte**:
The display name of a Department's Group Manager: the BC member who runs that Department.
_Avoid_: BCE (as the Department's Manager), department head, coordinator

**Moderator**:
The highest Role, a transferable seat held by the IT Coordinator. BC members and the Moderator grant and remove it, never on themselves; the organization always keeps at least one active Moderator, so whoever removes the last one names the replacement in the same change, and may name themselves. BC members and the Moderator change the Membership Status of a BC member or a Moderator; taking the last active holder of either rank out of Activ names the replacement the same way. Like a BC member, the Moderator is a Membru de drept of every Group and receives no Notification through membership; unlike one, the Moderator holds no Group position.

**Atribuție** (BC Assignment):
A named responsibility the Moderator gives to exactly one BC member in Administrare › Administrare BC, independent of Roles and Group positions (ruling R44, 2026-10-07). The first is Responsabil OSUBB Deals: its holder picks a Coordonator (a BCE member) and a Responsabil (any active Member); the Coordonator can do everything the holder can except pick the Coordonator, the Responsabil publishes Deals and manages their own, and the Moderator holds every power of every Atribuție by default, without being its holder. Taking the Atribuție away dissolves the team and leaves the Deals in place.
_Avoid_: Feature, permission, role, Group position

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
A Group created inside a parent Group and overseen by the parent's Group Managers; a Child Group may have Child Groups of its own, to any depth. Its parent is chosen at creation and never changes; a wrongly placed Group is archived and created again, or deleted for good by whoever may archive it (ruling R38). A Department Team is a Child Group of its Department; a Child Group's Task Points count toward the Department Cup of its nearest competing ancestor when every Group on the path is set to count.
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
A Member appointed to run a Group: its roster, Group Responsibles, Child Groups, work, and Events. BC or Moderator appoints the Group Managers of a top-level Group; the parent's Group Managers appoint a Child Group's, and the position carries down to every Group below. The Group's settings give the position its display name, such as Vicepreședinte for a Department or Coordonator Principal for a Project; each holder may also carry a function name of their own, such as Coordonator Marketing, pre-filled from it at appointment, and shown before it (#967). A Group with no Group Manager is run by the Group Managers of its nearest ancestor that has one, or by BC and Moderator.
_Avoid_: Lead, leader, coordinator, owner; Manager alone where it could be read as Task Manager

**Group Responsible**:
A Member appointed by a Group Manager to manage the ordinary members, their work, and the Events of a Group and every Group below it, under a custom display name. The Group's settings give the position its display name, such as Coordonator for a Department's BCE members; each holder still carries a title of their own, pre-filled from it at appointment, and shown before it. A Group Responsible never manages or evaluates the Tasks of a Group Manager or of another Group Responsible.
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
A Group setting under which every active Member at or above the Group's Minimum Level belongs to it. The roster follows each Member's Role, is never edited by hand, and accepts no Applications; Group Roles are still appointed. Automatic members are members everywhere a membership shows (the roster and its count, Grupurile mele, the Group filters), marked Automat.
_Avoid_: Derived roster, virtual group, implicit membership

**Private Group**:
A Group setting under which the Group, every Group below it, and their Tasks and Events are visible only to their members, to the Group Managers and Group Responsibles on its path, and to BC and Moderator. A Private Group accepts no Applications and offers no organization-wide Opportunity; a Member enters it by Appointment and sees it from that moment.
_Avoid_: Hidden group, secret group, invite-only group

**Group Members**:
The members of a Group: its roster rows, its automatic members under Automatic Membership, and every active BC member and the Moderator as Membri de drept. One definition serves every roster, count and Group filter; the Clasament still ranks only the Roles below BCE.
_Avoid_: Roster when the automatic members or the Membri de drept are meant

**Membru de drept**:
A BC member or the Moderator in their standing as a member of every Group by their Role, listed apart at the end of each roster and never removed from it. It carries no Notification: a Membru de drept is not in the Group Audience that Notifications reach. A BC member who also holds a position (Group Manager or Group Responsible) on a Group or on one above it is reached through that position, never through this standing (ruling R42).
_Avoid_: Ex officio member, board member of the Group

**Group Audience**:
Every active Member of a Group or of any Group below it, whether through a roster row or through Automatic Membership; the Membri de drept are not part of it. A Group's Announcements, its new Events and the important changes to its Events reach its Group Audience, except BC members and the Moderator, who are never notified through it — save a BC member who holds a Group Manager or Group Responsible position on that Group or on a Group above it, who is notified as any position holder is (ruling R42) — and a Member's Relevant Events are those of the Groups whose Audience they are in. A BCE, BC or Moderator who unselected the Group in their Grupuri preferate is not notified through it either, unless the Announcement is critical or they hold a position on its path (ruling R43). Task notifications never use it; they target the Executor, the Task Manager, and the Candidates.
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
The Member who created a Task, recorded by the server. They receive the Task's manager notifications; when they are the actor or no longer active, the Managers of the nearest Group on the Origin's path that has a Manager receive them instead (else its peer Responsibles), a BC member's position counting like anyone's (ruling R42) and the Moderator's never, and nobody when no such manager is left.

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
A labelled external address shown as a button under its label and, in a details view, as "Deschide: <etichetă>". An Announcement or a Task carries up to five Attached Links; a Submission Note or a Group's application form carries one (ruling R46, 2026-10-07). Text fields stay plain text and never carry links themselves.
_Avoid_: Form link, URL field, inline link

**Task Activity**:
The immutable chronological history of Task lifecycle, assignment, queue, evaluation, and cancellation events.

**Evaluation**:
The final review that sets Difficulty and Rating together and determines Task Points for the active Executor. Difficulty is not proposed at creation.

**Difficulty**:
One of ten levels of how demanding a Task is ("Dificultate"): one to five stars (levels 1–5), the Bronz, Argint and Aur medals (6–8), and Responsabil (9) and Coordonator (10), shown by name. Each level carries base points — the stars 1–5, the medals 6, 7 and 8, Responsabil 15 and Coordonator 20 (#985).

**Rating**:
A 1–5 assessment of the quality of completed work. The app shows and chooses it as a plain number ("Nota 4"), never as stars.

**Task Points**:
Points produced by an evaluated Task: its Difficulty's base points × the Rating multiplier (Nota 1 → −1, 2 → 0, 3 → 1, 4 → 2, 5 → 3), so a Coordonator Task rated 5 earns 60 and rated 1 loses 20. They belong only to the evaluated Executor.

**Points Ledger**:
The append-only history of every change contributing to a Member’s Personal Score.

**Personal Score**:
The total visible to an individual Member from their own Points Ledger entries.

**Leadership Leaderboard**:
A BCE/BC/Moderator view of Members ordered by Task Points only.

**Department Cup**:
A BCE/BC/Moderator comparison of Task Points earned in the top-level Groups set to compete and in every Group below them set to count toward them. Project and Independent-Team work never contributes.

**Completed-work Request**:
A Member’s request to recognize work already completed for one Origin. Approval creates the completed Task, Assignment, Evaluation, and Task Points together; the decider may first change the Task's title, details, Group, Attached Link and Campaign. A Group's managers can also add such a completed Task for one of its members directly, without a Request.
In the app the Requests are **Cereri**: a view of Taskuri, not a page of its own, reached with the Taskuri · Cereri toggle by every Member: a volunteer files there, leadership and the Group Managers decide there. Administrare → Cereri is a different thing: Group Applications.
_Avoid_: Award request, new-task request, `task_requests`

**Sanction**:
A deferred BC/Moderator action that may reduce a Member’s Personal Score and must include a visible explanation.

## Calendar

**Event**:
A future or past OSUBB activity owned by one Group. Creating it notifies its Group Audience once, unless its Announcement is published with it and speaks for it (ruling R39).

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
An OSUBB message posted on behalf of one Group, its Origin, by one of that Group's Managers or Responsibles, with an Announcement Audience, a normal, important, or critical Priority, up to five Attached Links, an optional **Termen** (the date by which its readers should act, never in the past when posted), and a Minimum Level: only Members of its Audience at or above it read the Announcement or are notified of it (everyone by default). An Announcement of the Organization Group may be posted by anyone holding a Group Role. Creating an Event may publish its Announcement in the same step, with the Event's Group, Audience and Minimum Level and Termen = the Event's start.
_Avoid_: Post, news item, broadcast when the Audience is local

**Deal** (OSUBB Deal):
An Announcement of kind deal: an offer, discount or access that a company gives OSUBB members, posted by the OSUBB Deals team from the Organization Group to every active Member, Recruți included, with Titlu, Descriere, an optional Termen, up to five Attached Links and an optional Deal Code (ruling R45, 2026-10-07). It is never critical or pinned. It lives on the OSUBB Deals tab of Anunțuri, never among the Announcements, and after its Termen only its team still sees it.
_Avoid_: Offer, promo, partnership post

**Deal Code**:
The discount or access code a Deal may carry, hidden on the card until the Member taps it. Revealing it is remembered for that Member on every device, and the Deal's team sees how many Members have revealed it.
_Avoid_: Voucher, coupon

**Announcement Audience**:
Whether an Announcement reaches only the Group Audience of its Origin or every active Member of OSUBB. A Group may speak to the whole organization without ceasing to be the Origin.
_Avoid_: Scope, visibility, org-wide flag

**Notification**:
A personal in-app alert delivered to one intended Member. It is about one thing, its subject — a Task, an Event, an Announcement, a Completed-work Request, an Application, a Promotion Candidate or a Retention Signal's Member — or about nothing but itself (a Role or Group change). It becomes read when its Member opens it: in Notificări, from a push or an Email Digest link, or by opening or acting on its subject (opening the Task, deciding the Application, RSVPing to the Event…), which reads every unread Notification of theirs about that subject and never anyone else's. BCE, BC and the Moderator may also mark all of theirs read at once (ruling R37, 2026-10-05, amending R16), and choose their Grupuri preferate: a Group they unticked sends them none (ruling R43).

**Grupuri preferate** (Preferred Groups):
The Groups a BCE, BC member or the Moderator chose to follow, from a Group tree in Profil (ruling R43, 2026-10-07). Every Group is preferred until they untick it, and so is every Group created later; unticking a Group unticks its subgroups, and a subgroup can be unticked on its own. Organizația OSUBB, the Adunarea Generală and Biroul de Conducere (the Groups set in Setări) are always preferred. An unpreferred Group sends them no Notification and no push, the Anunțuri badge ignores it, its Applications and Completed-work Requests do not notify them, and Taskuri, Calendar, Anunțuri and Clasament open without it, behind a "Doar grupurile preferate · Arată tot" chip that shows everything for that visit. It never silences their own work (a Task they created or execute, an Event they answered Particip to, their role changes and requests), a Group where they hold a position or one above it, critical and organization-wide Announcements, or Promotion Candidates and Retention Signals. It is a notification and default-view preference only: what they may see and decide is unchanged. Below level 5 it does not exist.
_Avoid_: Favourite Groups, subscriptions, muted Groups when the preference is meant

**Email Digest**:
An optional daily email to one Member listing the Notifications they have not read, sent only on a day when there is something unread, each Notification at most once. The Member turns it on and off in Profil.
_Avoid_: Newsletter, email notification

**Suppression**:
A rule preventing selected broadcast notification kinds from reaching a Role while preserving direct notifications about a Member’s own work.

**Fan-out**:
Turning one organization event into targeted Notifications for its intended recipients.

## Governance

**Role Evaluation**:
A run BC performs from Administrare over an Evaluation Period chosen at that moment, of one kind: Voluntar Activ or Adunarea Generală. It ranks the Task Points of the Task Evaluations falling in that range, records the Promotion Threshold it used and the one it computed, and produces Promotion Candidates and Retention Signals. Nothing ranks live between Role Evaluations, though a Voluntar who reaches the threshold in force between runs is listed as a Promotion Candidate at once (#983).
_Avoid_: Evaluation alone (that is a Task's review), opening or closing a Period, live ranking

**Evaluation Period**:
The date range, from one day to another, that BC chooses for one Role Evaluation, typically from one AGO to the next. It is a parameter of that run: it is never opened, closed, or current.
_Avoid_: Season, scoring window, semester when the ranking window is meant, open Period

**Promotion Rule**:
A BC-set rule about moving a Member to a higher Role. Automatic only for Recrut to Voluntar (tenure). Voluntar to Voluntar Activ needs the required tenure counted from the join date plus Task Points at or above the Voluntar Activ Promotion Threshold, at a Role Evaluation or, counted since the last one, between runs, which makes the Member a Promotion Candidate; BC then promotes by hand. Voluntar Activ to Voluntar cu Drept de Vot is human-confirmed; nothing is automatic downward. A Member below the required tenure is neither a Promotion Candidate nor notified. BC edits each rule's required tenure (whole months) and turns it on or off at any time, every change audited; a rule turned off promotes nobody (Recrut to Voluntar) and lists no Promotion Candidate (Voluntar to Voluntar Activ).
_Avoid_: Auto-promotion, level-up, threshold alone

**Promotion Candidate**:
A Voluntar with the required tenure whose Task Points reach the Voluntar Activ Promotion Threshold: at a Role Evaluation, or between runs the moment their Task Points since the last Voluntar Activ Role Evaluation reach the threshold in force (2026-10-02, #983). They join the candidates list at once and BC and Moderator receive one Notification per Member per listing; they are never promoted automatically, only by BC in the Role panel. A Member listed between runs leaves the list again when they stop qualifying (a reversal, a raised threshold, the rule turned off), and a rejection made between runs holds until the next Voluntar Activ Role Evaluation. Distinct from a Candidate, who waits in a Task's Candidate Queue.
_Avoid_: Candidate alone, eligible, auto-promoted

**Promotion Threshold**:
A Task Points value kept per Role Evaluation kind: the Voluntar Activ threshold and the Adunarea Generală threshold. BC enters the first value by hand and may edit either at any time, every edit audited. Each Role Evaluation uses the threshold in force and computes a new one, the Task Points of the last Member inside its kind's top share (x % of the Voluntar Activ cohort, y % of the Voluntar cu Drept de Vot cohort; BC edits both shares, 1–100 %, every change audited, and a change applies from the next Role Evaluation), which is in force for that kind's next Role Evaluation unless BC edits it.
_Avoid_: Cutoff, minimum points, prag alone

**Retention Signal**:
The automatic notice BC receives when a Role Evaluation ranks a Voluntar Activ (Voluntar Activ kind) or a Voluntar cu Drept de Vot (Adunarea Generală kind) below the share of the ranking their Role requires. BC decides each withdrawal by hand; nobody loses a Role automatically.
_Avoid_: Demotion, auto-demotion, downgrade

**AG Eligibility**:
The qualification every Voluntar Activ holds by Role, because that Role already required both tenure and the Voluntar Activ Promotion Threshold. Promotion to Voluntar Activ offers the adherence form; only BC's confirmation of it grants Drept de Vot and, through Automatic Membership, a seat in the Adunarea Generală. No threshold leads to Drept de Vot; the Adunarea Generală Promotion Threshold only measures who keeps it.
_Avoid_: Drept de Vot threshold

**Vote Retention Threshold**:
The top share (y %, BC-editable from 1 to 100 %) of an Adunarea Generală Role Evaluation's ranking a Voluntar cu Drept de Vot must reach to keep the Role. BC decides each withdrawal by hand after that Role Evaluation; nobody is removed automatically.
_Avoid_: Quorum, Top 25%

## Access

**Invite-only Access**:
The rule that only a person provisioned by OSUBB leadership becomes a Member of the application.

**Magic Link**:
The passwordless email link used by a provisioned Member to sign in. The same email carries a six-digit Sign-in Code that completes the same sign-in where the link cannot reach the app, such as the installed app on iPhone or a second device.
_Avoid_: OTP in user-facing copy; password

**Invitation**:
The account BC creates for a Member by email, before their first sign-in; its email carries a Magic Link and a Sign-in Code. Until it is first used, its email can be re-sent — by BC from Administrare, or by the Member from the login page.
_Avoid_: sign-up, registration

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
Minimum Level → `groups.min_level` · Application Level → `groups.application_level` · Shared Work Visibility → `groups.shared_work_visibility` · Automatic Membership → `groups.automatic_membership` · the Group Manager's display name → `groups.manager_title` · the Group Responsible position's display name → `groups.responsible_title` · the two Department Cup settings → `groups.competes_in_cup` and `groups.counts_toward_parent_cup`. The Group structure and settings commands own these writes; the browser never updates the table directly.

**Grupuri preferate → `member_group_unselected`**:
The table stores the Groups a Member **unticked**, one row each, so no row means preferred. It is written only by `public.set_unselected_groups` and read through `private.group_muted_for(group, member)`, which ignores a row below live level 5, on a locked Group, or where the Member holds a position on the Group's path. `public.my_group_preferences()` is the app's read.

**`group_ids` claim**:
The organization claim listing the Groups a Member explicitly belongs to, via `group_members` rows only, memberships of archived Groups included — Automatic Membership is derived from Role and Minimum Level and is never in the token. It is the only roster claim: the `dept_ids`/`team_ids` claims were removed in #591.

**Work ownership → `group_id`**:
`tasks.group_id`, `events.group_id`, `campaigns.group_id`, `completed_work_requests.group_id`, and `announcements.group_id` name one owning Group. Organization-wide Events use the Organization Group marker; an organization-wide Task or Announcement Audience opens visibility beyond its owning Group without changing its Origin.

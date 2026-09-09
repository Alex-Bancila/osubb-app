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

**Department**:
One of the five OSUBB departments: Educațional, Imagine & PR, Tineret, Financiar, or Resurse Umane.

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
A Team belonging to exactly one Department and overseen by that Department’s leadership.

**Independent Team**:
A Team with no parent Department. Its active Members jointly manage its planned work, while BC or Moderator manages membership.

**Interne**:
The Vicepreședinte Interne and Echipa Interne, responsible for tracking AG eligibility and voting-right information.

## Task Tracker

**Task**:
A planned or recognized unit of OSUBB work with one Origin, one Audience, one Assignment Mode, and a defined lifecycle.

**Task Origin**:
The Department, Project, or Team that owns a Task. Every Task has exactly one Origin.
_Avoid_: Scope when ownership is meant

**Task Audience**:
Whether a public Task opportunity is local to its Origin or open across OSUBB.

**Assignment Mode**:
Whether a Task is assigned directly to one eligible Member or offered publicly through the Candidate Queue.

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
The current lifecycle stage: To do, In progress, In review, Completed, or Cancelled.
_Avoid_: Open and Overdue as statuses

**Overdue**:
An unfinished Task whose deadline has passed. Overdue is a condition derived from time, not a lifecycle stage.

**Task Activity**:
The immutable chronological history of Task lifecycle, assignment, queue, evaluation, and cancellation events.

**Evaluation**:
The final review that sets effective Difficulty and Rating and determines Task Points for the active Executor.

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
A BCE/BC/Moderator comparison of Task Points earned through Department Tasks and Department-Team Tasks.

**Completed-work Request**:
A Member’s request to recognize work already completed for one Origin. Approval creates the completed Task, Assignment, Evaluation, and Task Points together.
_Avoid_: Award request, new-task request

**Sanction**:
A deferred BC/Moderator action that may reduce a Member’s Personal Score and must include a visible explanation.

## Calendar

**Event**:
A future or past OSUBB activity owned by the organization, a Department, a Team, or a Project.

**Event Scope**:
The organization structure that owns an Event: organization, Department, Team, or Project.

**Minimum Level**:
The lowest organizational Level allowed to discover an Event, such as Everyone, AG+, Responsible+, BCE+, or BC+.

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

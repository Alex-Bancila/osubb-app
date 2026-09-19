# Live Task draft validation

Before releasing a draft, `ManagedTaskForm` refreshes server-authorized Group, active Campaign, and unfinished Umbrella options. The shared validator checks one Group and audience, ancestor Campaign ownership, parent Origin consistency, and the fields prohibited on Umbrellas. It never branches on Group category. The eventual command remains authoritative.

Read failures and rejected drafts retain the entered content. A pending refresh disables the form and blocks duplicate submissions. Server messages are never displayed verbatim: recognized codes and allowlisted reasons map to Romanian copy, and unknown failures use a generic message.

The desktop and mobile screenshots render the production wrapper and form. A fixture supplies initial options, Playwright intercepts read requests, and the draft callback rejects with a synthetic `42501` error containing private text. The capture verifies one fresh `managed_work_groups` request before the callback, preserved title content, and absence of the private error text. No Task command or database write is involved.

- [Desktop error](validation-error-desktop.png)
- [Mobile error](validation-error-mobile.png)

Coverage includes both audiences and modes across presentation categories, self/ancestor/sibling Campaigns, removed options, inherited Subtask Origin, prohibited Umbrella fields, safe error mapping, submission-time refresh, duplicate suppression, retained content, and axe accessibility checks.

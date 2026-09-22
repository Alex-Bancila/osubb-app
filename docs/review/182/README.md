# Live Task draft validation

Before releasing a draft, `ManagedTaskForm` refreshes server-authorized Group, active Campaign, and unfinished Umbrella options. The shared validator checks one Group and audience, ancestor Campaign ownership, parent Origin consistency, and the fields prohibited on Umbrellas. It never branches on Group category. The eventual command remains authoritative.

Read failures and rejected drafts retain the entered content. A pending refresh disables the form and blocks duplicate submissions. Server messages are never displayed verbatim: allowlisted stable command reasons map to Romanian copy, and unknown failures use a generic message.

Prevention comes first (review on #558): once a Group is chosen, the form offers only the Campaigns of that Group and its ancestors and only the open Umbrellas of that Group as Subtask parents, and changing the Group clears choices that no longer fit. A Campaign that a refreshed read stops offering is shown and sent as none rather than refused. The validator and the server-error mapping stay as the backstop.

The earlier screenshots showed the previous native-select form and were removed; component tests cover the same flows.

Coverage includes both audiences and modes across presentation categories, self/ancestor/sibling Campaigns, removed options, inherited Subtask Origin, prohibited Umbrella fields, safe error mapping, submission-time refresh, duplicate suppression, retained content, and axe accessibility checks.

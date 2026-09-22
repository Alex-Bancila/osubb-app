# Group Campaign management (#349)

Group Managers and Responsibles can now open a Campaign panel for the Groups they manage, including their descendants. They can create a Campaign, rename it, or turn it on and off using the existing server commands. Turning a Campaign off removes it from new Task choices while keeping it on existing Tasks, in their history and in the Tracker filters. The panel uses live server-derived Group permissions.

The page opens by saying what a Campaign is: a label for the Tasks of one Group and its subgroups, whose report shows the points earned and who worked on it. It is never an Origin and never decides who may work on a Task.

The Campaign navigation entry opens `/administrare/campanii`. The Group is picked from a searchable Group dropdown (each Child Group shown with its parent), which opens `/administrare/grupuri/:groupId/campanii`. The BC panel links to the same entry. Creating and renaming each open a small pop-up; a rejected save keeps the pop-up and the typed name for a retry, with the refusal shown inside it.

## Evidence

The earlier screenshots showed the previous chip list and inline rename fields and were removed. Component tests cover the pop-ups, command payloads, the Group dropdown, permission gating, inactive Campaigns and safe errors, including axe.

The shared `useCampaigns(groupId)` query keeps inactive rows and pages every 500 rows in stable ID order. The Task form reuses the same fetcher and filters active rows; existing Tracker filters derive their choices from Task Campaign references and therefore retain inactive historical Campaigns. Command settlement refreshes both Campaign queries and Task queries, including the Task form options.

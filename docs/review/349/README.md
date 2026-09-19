# Group Campaign management (#349)

Group Managers and Responsibles can now open a Campaign panel for the Groups they manage, including their descendants. They can create a Campaign, rename it, or turn it on and off using the existing server commands. Turning a Campaign off removes it from new Task choices while keeping it available in history and filters. The panel uses live server-derived Group permissions, and a rejected save keeps the text available for retry.

The Campaign navigation entry opens `/administrare/campanii`; each managed Group links to `/administrare/grupuri/:groupId/campanii`. The BC panel links to the same entry. This is a Campaign-only entry inside Administrare, without expanding the unsplit Groups Wave 3 work.

## Evidence

[Desktop](campaigns-desktop.png) · [Mobile](campaigns-mobile.png)

Screenshots render the production Campaign screen and theme in a review fixture with synthetic cached query data. They show an active and an inactive Campaign under a child Group; command payloads and permission gating are verified by component/query tests rather than represented as live backend writes in the screenshots.

The shared `useCampaigns(groupId)` query keeps inactive rows and pages every 500 rows in stable ID order. The Task form reuses the same fetcher and filters active rows; existing Tracker filters derive their choices from Task Campaign references and therefore retain inactive historical Campaigns. Command settlement refreshes both Campaign queries and Task queries, including form options and Executor Campaign filters.

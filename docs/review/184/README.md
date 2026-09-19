# Task content editing (#184)

Managers can now edit a Task's title, description, deadline and Campaign before it becomes terminal. The editor keeps its Origin, audience and assignment mode fixed, and Difficulty remains part of evaluation. Campaign choices come from the Origin Group and its ancestors; an existing inactive Campaign can be kept or removed without preventing other edits. Saves use the existing audited command and show a persistent confirmation, while rejected changes keep the typed content for retry.

## Evidence

[Desktop](edit-desktop.png) · [Mobile](edit-mobile.png) · [Confirmation](edit-success-mobile.png)

Screenshots use the production editor/theme with synthetic cached Task and Group data and intercepted read/write requests. The browser capture verifies one `update_task_content` call, the chosen ancestor Campaign, and preservation of the unchanged deadline's exact seconds. They demonstrate the UI flow rather than a live database write; command semantics are covered by the existing backend suite.

## Validation details

The editor rechecks live managed Groups and active Campaign choices immediately before saving. The command receives complete replacement values, with explicit `NULL` for cleared fields; generated RPC types omit PostgreSQL argument nullability, so that mismatch is documented at one call boundary rather than changing generated types. The editor preserves the original instant when the deadline field is unchanged, and converts edited wall-clock values using Europe/Bucharest rules.

Focused tests cover manager/terminal gating, ancestor choices, retaining an inactive association, revoked authority after refresh, full command payloads, NULL clears, safe conflicts, duplicate-submit protection, success after a terminal-state refetch, Umbrellas without deadlines, and accessibility.

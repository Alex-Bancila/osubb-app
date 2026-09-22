# Task editing (#184)

A Task Manager can edit every field of a Task while it is to do or in progress, Feedback pending included (ADR-0007, amended 2026-09-21): title, description, deadline, Assignment Mode, Audience and Campaign. A Task in review or finished is not editable, and Difficulty stays part of evaluation. An Umbrella edits its title, description and optional deadline only. The Origin Group is not editable yet: the backend for Group changes is #627.

Saving goes through `update_task`. Before it, the editor asks `preview_task_update` — the same server definition the command applies — what the edit would do to other people. When it would end an Assignment or Candidatures, or promote a Candidate, a confirmation pop-up names each affected member ("Bianca Pop iese din lista de candidați.") and the edit is saved with the consequences accepted only after the manager confirms. If the Task changes between the preview and the save, the server refuses the unconfirmed save and the pop-up shows the new list.

Campaign choices come from the Origin Group and its ancestors, described as a reporting label; the Task's current Campaign stays selectable even when it can no longer be chosen anew. An untouched deadline keeps its exact stored instant; an edited one is read as Europe/Bucharest wall time. The editor rechecks live managed Groups and Campaigns before saving, keeps typed content on any refusal and maps server refusals to Romanian copy.

## Evidence

The earlier screenshots showed the previous content-only editor and were removed. Focused tests cover the edit window (in review and terminal statuses hidden, Feedback pending editable), full command payloads with NULL clears, the preview-then-confirm flow with named members, cancel, a consequence that appears after the preview, revoked authority, duplicate-submit protection, Umbrellas and accessibility.

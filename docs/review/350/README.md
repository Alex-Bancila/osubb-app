# Direct assignment (#350)

When a direct Task has no Executor, its manager presses **Atribuie**, picks someone in a small pop-up and confirms. The pop-up's searchable member dropdown (#183) shows active Members who meet the Origin Group's Minimum Level, while the server checks that rule again before saving. A successful assignment keeps its confirmation visible when the Task refreshes, and a later give-up allows another assignment. Errors use safe Romanian messages and refresh the Task so stale information does not linger.

```mermaid
sequenceDiagram
  participant Manager
  participant Picker
  participant Command as assign_task_executor
  participant DB as Database
  Manager->>Picker: Choose eligible Member
  Picker->>Command: Task ID + Member ID
  Command->>DB: Lock Task and recheck manager authority
  Command->>DB: Lock target Profile FOR SHARE
  Command->>DB: Check active status and Group Minimum Level
  Command->>DB: Insert Assignment, activity and notification
  Command-->>Picker: Saved Task
  Picker-->>Manager: Persistent confirmation + refreshed Task
```

## Screenshot evidence

The earlier screenshots showed the previous inline form and were removed when assignment moved into a pop-up. The component tests cover the pop-up, its payload, cancel, retry and the retained confirmation.

## Regression coverage

The new minimum-level test fails six of seven assertions against the parent schema: a below-minimum Member is incorrectly assigned and produces activity and a notification. The fix preserves existing state-conflict precedence and accepts a Member exactly at the minimum even without membership in the Origin Group. The existing direct-assignment concurrency suite also verifies that target deactivation waits for the assignment's Profile lock.

The server change is scoped to `assign_task_executor`; creation and other assignment commands are not changed by this PR. Public signatures and grants remain unchanged.

Validation: all 104 database suites / 4,148 assertions, strict lint, historical migration harnesses, seed repeatability, generated types and public-command smoke passed. Removing the target `FOR SHARE` lock makes two concurrency assertions fail; restoring it passes all 68 focused database assertions.

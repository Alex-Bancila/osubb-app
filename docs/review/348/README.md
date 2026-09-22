# Umbrella progress and Subtask creation

The details sheet lists every visible Subtask with status, safe Executor identity and a Bucharest deadline. Child reads are paginated, so a later non-terminal child cannot disappear behind the API row limit. Progress counts completed, unfulfilled and cancelled children as terminal. Completion requires at least one child and every child terminal; the command rechecks the state atomically.

Managers can create a Subtask using the shared form with parent and Group Origin locked. Submission refreshes authorized options before calling `create_task`; only the returned child is opened. Members see the list without actions. Task cards already show the parent label. Completion errors use safe Romanian copy, and the success announcement survives a refetch that renders completion before the mutation promise resolves.

- [Desktop progress](progress-desktop.png)
- [Mobile progress and disabled completion](progress-mobile.png)
- [Live terminal state](ready-mobile.png)

The browser captures render the production sheet with a fixture session, seeded query data and intercepted reads. A fixture cache update changes the final child's status; the capture verifies the completion button changes from disabled to enabled. No write command is executed for screenshots. The earlier Subtask form screenshot showed the previous native-select form and was removed; the form itself is covered by the #180 tests. Tests separately exercise command payloads, pagination and safe Executor enrichment, progress eligibility, member/terminal visibility, completion races and conflicts, creation/navigation and axe accessibility.

The backend guard in `20260922110200_create_task_executor_minimum.sql` (dated after main's newest migration, its body main's latest `create_task_impl` plus the guard) keeps creation eligibility aligned with the Group Minimum Level. It checks a live active target Profile under `FOR SHARE`, uses the existing Group model, and preserves the atomic command and audit behavior. There is no new client authority rule.

```mermaid
flowchart LR
  Form[Locked Subtask form] --> Options[Refresh authorized options]
  Options --> Command[create_task]
  Command --> Parent[Lock parent and validate inherited Origin]
  Parent --> Profile[Lock target Profile FOR SHARE]
  Profile --> Eligible{Active and meets Group Minimum Level?}
  Eligible -->|yes| Atomic[Create Task and Assignment with audit]
  Eligible -->|no| Reject[Reject invalid_executor]
  Atomic --> Refresh[Invalidate Task queries and open child]
```

Backend validation on the exact migration/test changes: reset, all 105 pgTAP suites / 4,162 assertions, strict database lint, historical-migration harnesses, repeated seed, generated-type comparison and public command smoke passed. Removing the Minimum Level guard fails three expected assertions; removing the Profile share lock fails the race assertion. Restoring the guard and lock passes all 22 focused assertions. The full backend checks were run by the coordinated backend author before this commit was integrated; no additional database reset was needed for the unchanged backend files.

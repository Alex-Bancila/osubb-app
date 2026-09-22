# Completed-work Request decisions (#353)

Managers now see a queue of pending Requests they are allowed to decide. Approval reuses the Task evaluation form, so Difficulty, Rating and a note are required before the existing approval command records the work and points. Rejection requires a note and calls the existing rejection command. The server supplies the decision queue using live Group authority, and success feedback stays visible when the decided Request disappears from the refreshed list.

```mermaid
flowchart TD
  Queue[pending_request_decisions] --> RLS[Request, Group and directory RLS]
  RLS --> Authority[private.can_decide_request]
  Authority --> UI[Only eligible pending Requests]
  UI --> Approval[Shared evaluation fields]
  UI --> Rejection[Required rejection note]
  Approval --> Approve[approve_completed_work_request]
  Rejection --> Reject[reject_completed_work_request]
  Approve --> Refresh[Refresh Requests, Tasks and points]
  Reject --> Refresh
  Refresh --> Receipt[Persistent decision confirmation]
```

## UI evidence

[Rejection mobile](rejection-mobile.png). The approval captures were removed when the on-page scoring guide they showed was replaced by the rating-guide pop-up (#188); they no longer match the form.

The screenshot uses the production queue and shared evaluation fields, with the application theme and synthetic cached Request data. It demonstrates the input flows, not a live approval transaction. Query/component tests cover command payloads, mandatory inputs, safe errors, duplicate-submit protection and confirmation surviving an empty queue refetch; database tests cover live queue authority.

The read endpoint is necessary because Request visibility is broader than decision permission: seeing a Request must not imply permission to approve it. It is security-invoker, retains RLS, excludes self-decisions through the established authority helper, and adds no write path. The client pages all queue rows in creation-time/ID order and refuses partial results on a failed page.

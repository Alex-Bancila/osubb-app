# Direct Executor selector (#183)

A manager can search for one active member and choose them as Executor. The Origin Group's Minimum Level decides who is eligible. Group (including descendants) and Campaign filters make the list easier to browse; removing them brings everyone eligible back. A chosen member stays selected when a filter hides them, but is cleared if their eligibility changes.

The screenshots use a synthetic two-member browser fixture, not production member data. The reusable component is wired into the assignment flow by #350.

- [Desktop](executor-desktop.png)
- [Mobile](executor-mobile.png)
- [Selection retained after searching for another member](executor-preserved-desktop.png)

Validation: focused query/component tests cover paging beyond 500 rows, failed reads, descendant and Automatic Membership filters, Campaign Assignment history, Origin Minimum Level, refreshed eligibility, search, selection preservation, loading/retry, and axe accessibility. Typecheck, lint, formatting, and production build are run against the issue branch.

# Direct Executor selector (#183)

A manager picks one Executor from a searchable dropdown: typing a name narrows the list (diacritics optional), and each row shows the member's small initials avatar on their colour. Only active Members at or above the Origin Group's Minimum Level are offered.

A second, optional dropdown narrows the list to one Group and everything below it. Groups are searchable too, and a Child Group is shown with its parent (`Echipa · Educațional`) so two teams with the same name stay distinguishable. There is no Campaign filter: a Campaign is a reporting label and has no members. A chosen member stays selected when the Group filter hides them, but is cleared if they stop being eligible.

The component is compact so it fits in the assignment pop-up (#350) and the Task form (#180).

The earlier screenshots showed the previous full-page layout and were removed; the component is covered by the focused tests below.

Validation: focused tests cover paging beyond 500 rows, failed reads, reading no Campaign data, in-dropdown name search without diacritics, the initials avatar without images, Group search by parent, descendant and Automatic Membership filtering, Origin Minimum Level, refreshed eligibility, selection preservation, loading/retry, and axe accessibility.

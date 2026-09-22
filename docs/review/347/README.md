# Task duplication

The manager's Task details include **Duplică** for ordinary Tasks, including Subtasks, but never Umbrellas. It opens a small pop-up that asks only for the new deadline. The deadline is interpreted in `Europe/Bucharest`; invalid and nonexistent daylight-saving times are rejected before submission. The browser sends only the source identifier and new deadline to `duplicate_task`, refreshes Task queries after success or failure, and opens the returned Task. Its existing source link returns to the original Task.

The form blocks repeated submission while pending, retains the entered deadline on failure, and maps stable command reasons to safe Romanian messages. Navigation focuses the details heading. The Task card has an intrinsic-height wrapper in the sheet so it does not expand into a blank viewport above the action.

The earlier screenshots showed the previous inline form and were removed when duplication moved into a pop-up. Component tests cover authority visibility, Umbrellas, navigation, invalid dates, pending duplicate prevention, retry, safe errors and axe accessibility.

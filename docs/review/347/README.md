# Task duplication

The manager's Task details include **Duplică** for ordinary Tasks, including Subtasks, but never Umbrellas. A new deadline is interpreted in `Europe/Bucharest`; invalid and nonexistent daylight-saving times are rejected before submission. The browser sends only the source identifier and new deadline to `duplicate_task`, refreshes Task queries after success or failure, and opens the returned Task. Its existing source link returns to the original Task.

The form blocks repeated submission while pending, retains the entered deadline on failure, and maps stable command reasons to safe Romanian messages. Navigation focuses the details heading. The Task card has an intrinsic-height wrapper in the sheet so it does not expand into a blank viewport above the action.

- [Desktop deadline selection](duplicate-desktop.png)
- [Mobile deadline selection](duplicate-mobile.png)
- [Mobile clone and source link](clone-mobile.png)

Screenshots use the production Task details sheet and duplication control with a fixture session and seeded query data. Playwright intercepts reads and `duplicate_task`, verifies the exact source/deadline payload, returns a synthetic clone, and checks that the source link appears. No real Task command is executed. Component tests separately cover authority visibility, Umbrellas, navigation, invalid dates, pending duplicate prevention, retry, safe errors and axe accessibility.

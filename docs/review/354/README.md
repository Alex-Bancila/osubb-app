# Leadership page (#354)

Leadership can now compare Task Points across members and open each member’s assignment history. Choosing a Group includes its subgroups, and choosing a Campaign narrows both the member leaderboard and the Cup. The Cup displays the server’s competing Groups and totals, without rules based on Group Category. Historical assignments and reversed evaluations remain visible, while ordinary members receive an access explanation.

The page uses the existing leadership RPCs and the live leadership capability. Reads are paged in batches of 500 with stable ordering; a failed page rejects the whole result. Member names come from the basic directory projection, without contact fields. Keyboard users open history through member links; clicking anywhere else in a member row opens the same route.

Screenshots use synthetic local browser responses and a public fixture key, without real member data. Mobile evidence includes the lower Cup section separately because the application scrolls inside its shell.

| Desktop                                       | Mobile                                                       |
| --------------------------------------------- | ------------------------------------------------------------ |
| [Leaderboard and Cup](leadership-desktop.png) | [Leaderboard](leadership-mobile.png) · [Cup](cup-mobile.png) |
| [Member history](member-history-desktop.png)  | [Member history](member-history-mobile.png)                  |

Tests cover Group and Campaign parameters, changing returned totals, filter chips, stable pagination and partial failures, row/link navigation, live and route access gates, empty/loading/error/retry states, ended assignments and reversed evaluations. Both new screens are checked with axe. The final Chromium checks inside the real application shell report zero violations, including color contrast; jsdom checks exclude color contrast.

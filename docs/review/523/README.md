# Group leadership metrics (#523)

Leadership can filter the Leaderboard by one Group and all of its subgroups. Department Cup points follow the Group tree and count only when every link to the competing Group permits them. The Cup keeps its existing Dashboard columns and adds the Group identifier, while member history adds the Group name too. Leadership access stays restricted to active BCE, BC and Moderator members.

```mermaid
flowchart TD
    L[Task points and reversals] --> T[Task owning Group]
    T --> B[Leaderboard: selected Group and descendants]
    T --> N[Find nearest competing ancestor or self]
    N --> C{Every lower link counts toward its parent?}
    C -->|Yes| A[Credit that Group in the Cup]
    C -->|No| X[No Cup contribution]
    B --> G[Active leadership gate]
    A --> G
    G --> R[Return standings with Group identity]
```

Campaign filters apply to the Task that earned the points. Sanctions stay out of both metrics, reversals subtract from the original award, and inactive earners keep their historical Leaderboard rows. Cup membership counts only active explicit members of the competing Group itself.

Tests place two native intermediate Groups above a mapped Task Group. This proves that both links independently control attribution while preserving Wave 2's requirement that Task Origins still map to legacy structures. Group Category is only presentation: the tests also enable competition for a Project Group and verify that its points appear.

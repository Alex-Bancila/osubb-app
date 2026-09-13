# OSUBB brand reference

**Version:** 1.0 (2026-08-27) · **Source:** _BRAND BOOK OSUBB 2025_ · **Scope:** practical app guidance

## Authority

The official _BRAND BOOK OSUBB 2025_ and the repository's domain/capability model (`CONTEXT.md`, `departments`, and `role_capabilities`) are authoritative. Use this reference to apply them consistently in the app.

`mockup/` is historical visual inspiration only. It is not a source of brand authority, domain semantics, or capabilities; where it differs from the Brand Book or the domain/capability model, follow those authorities.

## Colour and department meaning

Primary OSUBB colours are red `#ED2025`, black `#000000`, and white `#FFFFFF`. Use them for defining brand elements; the Brand Book uses primary colours preferentially for representative elements such as logos, banners, and staging.

Department colour conveys department context, not role or permission:

| Department    | Colour    |
| ------------- | --------- |
| Educațional   | `#284C93` |
| Resurse Umane | `#F2A700` |
| Financiar     | `#007F33` |
| Imagine & PR  | `#7500A0` |
| Tineret       | `#FF3B3B` |

- Structuri de coordonare (Diverse, Secretariat): neutru `#5C5C61`; numele structurii apare întotdeauna lângă culoare.

Render role badges neutrally; roles and capabilities come from the domain/capability model, never from a department colour. Department UI must also name the department (and may use its short label or icon): colour is never the only carrier of meaning.

## Typography and logo

Montserrat is the primary typeface. Bundle the required Montserrat font files locally in the app rather than relying on a remote font provider. The Brand Book lists Light, Regular, Medium, Semibold, Bold, ExtraBold, and Black weights.

The approved logo forms are:

- **Logo principal:** icon + acronym
- **Logo principal cu extensie:** icon + acronym + full name
- **Logo simplificat:** icon

Use the approved full-colour, black, or white variants on a contrasting background, preserving the Brand Book clear space. Do not recolour, distort, alter elements, add shadows or other effects, or place a logo on a low-contrast background. Candidate logo assets in `mockup/assets` are non-authoritative and must be verified against these approved Brand Book forms before use; introducing or copying assets is outside this reference issue.

## Voice and accessible interaction

Write Romanian that is friendly, informal, and accessible. Address a member in second-person singular: use direct, ordinary wording that says what happens.

For the app, preserve keyboard-visible focus, respect reduced-motion preferences, maintain sufficient text and control contrast, and make touch targets at least 44 × 44 px. Pair every colour, motion, or visual state with a text, icon, label, or other non-colour cue where it carries meaning.

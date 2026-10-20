# Formatted Text — issue drafts (ruling R60)

Created on 2026-10-20 after Alex's go-ahead: Issue 1 is #1090, Issue 2 is #1091, Issue 3 is #1092. The bodies below are the drafts as reviewed; the published issues have the blocker numbers filled in.

---

## Issue 1

**Title:** Formatted Text on the server: plain words for Notifications, visible-length limits (R60, part 1)

**Labels:** `backend`, `database`, `frontend`, `shared`, `page-notificari`

### Goal

The server understands Formatted Text (ruling R60, 2026-10-20; spec `docs/superpowers/specs/2026-10-20-formatted-text-design.md` §D; plan `docs/superpowers/plans/2026-10-20-formatted-text.md` PR 1):

- An Announcement's or Deal's body, a Task's description and an Event's description may hold Markdown and are limited by what the reader sees.
- Every Notification built from them carries plain words.

### What to build

- **`private.formatted_text_plain(text)`**, an immutable stripper. Its fixtures live in `supabase/tests/formatted_text_plain.test.sql`.
- **`toPlainText` / `visibleLength`** in `app/src/lib/formatted-text/plain.ts`, with a parity test that replays the SQL fixtures.
- **The limits:**
  - `private.require_formatted_text_length(field, value)`: at most 2000 visible characters and 4000 stored, raising the existing `body_too_long` / `description_too_long`.
  - It applies in `guard_announcement_text`, in every Task and Event command that checks a description, and in the three `*_length_ck` constraints (names kept).
  - The client side: `requiredFormattedText` / `optionalFormattedText` in `lib/schemas/text.ts` for the announcement, deal, task and event schemas.
- **`private.notify_announcement`** passes `formatted_text_plain(body)` to `private.notify`.
- **`private.event_announcement_body`** clips the copied description at whole lines (visible ≤ 2000) and appends "…".

### Why

Alex chose formatting for these four kinds of text (R60). Notificări, the phone push and the Email Digest must keep showing words, not `**` and `##`. The 2000-character rule must keep counting what a Member reads, or a formatted Anunț with a link would hit the limit long before its text does.

### Implementation boundary

- No new columns and no migration of existing rows.
- Cerere descriptions, the Submission Note and every note and reason stay plain, with their limits unchanged.
- No reader or editor here: the app still shows these fields as plain text after this PR.

### Acceptance criteria

- `formatted_text_plain` and `toPlainText` agree on every fixture, diacritics, `\r\n` and `5*3*2` included.
- An Announcement with 3600 stored and 1199 visible characters is accepted. One with 2001 visible characters is refused with `body_too_long`, and one with 4005 stored is refused too. The same holds for a Task and an Event description, through their commands.
- Publishing `Ne vedem **joi**.` notifies with the body `Ne vedem joi.`.
- An Event copy over the limit ends in "…" on its own line and never inside a marker.
- `tracker_grants.test.sql` pins both new private functions.

### Required tests

- `supabase/tests/formatted_text_plain.test.sql`
- `supabase/tests/formatted_text_limits.test.sql`
- `supabase/tests/formatted_text_notifications.test.sql`
- `app/src/lib/formatted-text/plain.test.ts` (parity)
- the schema tests of announcement, deal, task and event

### Blocked by

None — can start immediately.

---

## Issue 2

**Title:** Formatted Text is read everywhere: details, cards, Calendar, history (R60, part 2)

**Labels:** `frontend`, `shared`, `page-anunturi`, `page-taskuri`, `page-calendar`

### Goal

Every place that shows an Announcement or Deal body, a Task description or an Event description reads it as Formatted Text: fully formatted when opened, lightly formatted on the three-line cards, and plain on one- and two-line previews (R60; spec §B and §F; plan PR 2 and the scan gate).

### What to build

- **Lexing:** `marked` (^17, the major `@tiptap/markdown` uses) with a `==highlight==` extension and the intraword-star rule, in `app/src/lib/formatted-text/lex.ts`.
- **`FormattedText`** with the views `full` and `preview`, mapping tokens to React elements, never `dangerouslySetInnerHTML`. Text Links use `textLinkTarget` (`lib/links.ts`): an app path navigates inside the app, and any other http(s) address opens in a new tab with `rel="noopener noreferrer"`. Anything else is raw text.
- **`app/src/theme/formatted-text.css`**: Titlu 19 px, Subtitlu 16 px, the quote, the warning-tint highlight.
- **The read sites:**

  | View          | Sites                                                                                                                                   |
  | ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
  | `full`        | `AnnouncementDetailsSheet`, `DealDetailsSheet`, `TaskDetailsSheet`, `EventCard`, `TaskHistory` (Înainte and După of a description edit) |
  | `preview`     | `AnnouncementCard`, `DealCard`                                                                                                          |
  | `toPlainText` | `TaskRow`, `CriticalAnnouncementBanner`                                                                                                 |

- **`scripts/formatted-text-scan.sql`**, run on staging and production before merging. It lists the old rows whose look changes, and the results are posted here.

### Why

Existing text is read as Markdown with no migration (R60, decision 12). Showing it formatted before the editor ships lets us check, with the scan's list in hand, that legacy text, the 5,411 imported Tasks included, still reads right.

### Implementation boundary

- No editor: the forms still use `Textarea` (part 3).
- Odd old rows are fixed by editing the item in the app, never by SQL.
- Notes, reasons, the Submission Note and Cerere descriptions are untouched.

### Acceptance criteria

- `**joi**` shows bold in a details sheet and in the three-line card.
- The Task row shows `a b` for `**a** _b_`.
- `5*3*2`, `nume_prenume`, `<script>` and `---` show as typed.
- `[x](javascript:…)` is not a link.
- A legacy description's single line breaks are kept, including on the Event card, where they are lost today.
- A Task history entry for an edit from `a` to `**a**` shows the bold under După.
- The scan ran on staging and production, and its counts are in this issue.
- The entry chunk grows by about 15 KB gzip, recorded in the PR.

### Required tests

- `lex.test.ts`
- `FormattedText.test.tsx`
- `links.test.ts` (`textLinkTarget`)
- the read-site tests and snapshots changed by design

### Blocked by

- #1090

---

## Issue 3

**Title:** Formatting toolbar: keyboard bar with Aa on touch, top toolbar with a mouse (R60, part 3)

**Labels:** `frontend`, `shared`, `page-anunturi`, `page-taskuri`, `page-calendar`

### Goal

Members format the four kinds of Formatted Text where they write them (R60; spec §C; plan PR 3):

- **On a phone or tablet,** option 3's keyboard bar: Aa · B · I · Listă · Link · Ascunde tastatura. Aa swaps the keyboard for a panel of styles.
- **With a mouse,** option 1's toolbar above the field: Stil (Titlu, Subtitlu, Text, Citat) | B I S | Listă, Listă numerotată | Link, Evidențiază, Fără formatare.

### What to build

- **Tiptap 3.32.0**, all packages pinned to the same version, configured for the dialect:
  - headings at levels 1–2
  - no code, rule or underline
  - Link with autolink and paste limited to `safeHttpUrl`
  - Highlight writing `==`
  - `@tiptap/markdown`
  - `injectCSS: false`
  - input rules only for headings, lists and quotes
- **Pasting:** Google Docs HTML is filtered by the schema. Plain text goes through `whatsappToMarkdown` (`*x*` → bold, `_x_` → italic, `~x~` → strikethrough, at word boundaries; every other symbol escaped).
- **The toolbars:** `useCoarsePointer`, `FormattedTextToolbar`, `FormattedTextKeyboardBar` (modes hidden, keyboard and panel; fixed above the keyboard; sheets keep clear of it through `--format-bar-h`) and `TextLinkDialog` (Adresa, plus Text without a selection; http(s) only; Elimină linkul; Ctrl/Cmd+K).
- **`FormattedTextField`**, lazy-loaded, with the counter "N / 2000 caractere", bound by `form.field(...)`. It replaces `Textarea` at:
  - `AnnouncementFields`
  - `DealFormSheet`
  - `TaskForm`
  - `TaskEditControl`
  - `CompletedTaskForm`
  - `EventForm`
- **The PWA:** the editor chunk is in `globIgnores`, so installs don't download it ahead of time.
- **DESIGN.md:** the two component rows, and a `CLAUDE.md` status line.

### Why

Alex asked for bold, italic and lists, two text sizes and links. He chose the keyboard bar for phones, where volunteers write, and the familiar toolbar for laptops, where coordinators write (R60, decisions 1–5).

### Implementation boundary

- No checklists, @mentions, `mailto:`, images or second font (R60 §Later).
- Short notes, reasons, the Submission Note and Cerere descriptions keep `Textarea`.

### Acceptance criteria

- Every control writes the dialect: B `**x**`, Titlu `# x`, Listă numerotată `1. x`, Evidențiază `==x==`, Fără formatare removes them all.
- Typing `**a**` stays literal; `- ` at the start of a line makes a list.
- A Google Docs paste with an `h3`, a table, an image, a coloured span, a `javascript:` link and a nested list gives Subtitlu, the cell text, nothing, plain text, plain text and a nested list.
- A WhatsApp paste of `*Ședința* e _joi_` gives bold and italic.
- **Opening and saving an old item without touching the text submits the original string unchanged**, so there's no "Modificat: Descriere" and no history entry.
- The toolbar follows a live `pointer: coarse`.
- On Alex's iPhone (preview deploy): B and I keep the keyboard open, Aa swaps it for the panel and keeps the selection, and tapping the text brings the keyboard back.
- No CSP violation in the console.
- The editor chunk (about 145 KB gzip) is absent from the precache list.

### Required tests

- `extensions.test.ts`
- `whatsapp.test.ts`
- `toolbars.test.tsx`
- `use-coarse-pointer.test.ts`
- `FormattedTextField.test.tsx`
- each form's test finding the field by its label and showing the server reason under it
- `pwa-config` test for `globIgnores`

### Blocked by

- #1090
- #1091

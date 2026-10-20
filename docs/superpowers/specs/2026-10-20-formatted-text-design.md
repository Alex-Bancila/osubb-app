# Formatted Text — design

- **Date:** 2026-10-20
- **Decided by:** Alex Băncilă, in the grill session of 2026-10-20 (ruling R60), after comparing five clickable options on the comparison page (Artifact `https://claude.ai/artifact/Ush78bHjV1UEBEkR7K2Mg9`, private to Alex).
- **Status:** approved, not yet built.
- **Supersedes:**
  - Ruling R7's "Text stays plain (no Markdown, no inline URL detection)" (`docs/superpowers/plans/2026-09-23-prod-readiness-grill.md`), for the four kinds of Formatted Text only. The Submission Note stays plain, as R7 said.
  - The sentence "Text fields stay plain text and never carry links themselves" that the Attached Link glossary entry carried since ruling R46.
- **Amends:** `CONTEXT.md` (Formatted Text and Text Link are new; Attached Link is reworded). `DESIGN.md` gains the editor and reader rows when they are built (§E).

## The request

> "Right now the text everywhere is unformattable, i want to be able to add bold, italic, bullet lists, i want you to come with 5 ideas of design and let me choose, also please come with other helpful text formatting options, maybe a different font size, maybe different fonts [...]"

The five options were: 1, a fixed toolbar; 2, a selection bubble; 3, a keyboard bar with an Aa panel; 4, a slash menu; 5, symbols with a live preview. Alex chose **option 3 on phones and option 1 on laptops**, with **links inside the text**, "even though we already have a separate field for link".

## Decisions (ruling R60)

Each numbered point is one answer Alex gave, in the order asked. Where he answered with my recommendation, the recommendation is written out.

1. **Phones use option 3, the keyboard bar.** The bar is **Aa · B · I · bulleted list · link · hide keyboard**. It sits above the on-screen keyboard while the field has focus. **Aa** swaps the keyboard for a panel with three rows:
   - **Titlu · Subtitlu · Text · Citat**
   - **B · I · tăiat · evidențiere · link**
   - **bulleted list · numbered list · fără formatare**
2. **Aa stays.** Titlu and Subtitlu are the "different font size": two named sizes from the app's scale, never a size picker.
3. **The styles are those of the option 3 mockup, minus the checklist:** Titlu, Subtitlu, Citat, bold, italic, strikethrough, highlight, bulleted and numbered lists, Text Links, and clearing formatting. Alex dropped checklists on reflection ("just remove the checklist").
4. **Laptops use option 1's toolbar above the field:** **Text ▾** (Titlu, Subtitlu, Text, Citat) | **B I S** | **• 1.** | **link · evidențiere · fără formatare**. It is the same set as the phone, laid out for a mouse.
5. **Input decides which toolbar a Member gets, not width.** A touch device (phone, tablet) gets the keyboard bar; a device driven by a mouse or trackpad gets the top toolbar, at any width.
6. **Text Links get in two ways:** a pasted or typed address becomes a link by itself, and the link button turns selected words into a link. On an existing link, the same button changes or removes it.
7. **Text Links are http(s) only**, under the same rule as Attached Links: `safeHttpUrl` in the page and `private.is_http_url` on the server. An email address, a phone number or a bare `osubb.ro` stays text.
8. **Formatted Text is the text of four things:**
   - the Mesaj of an Announcement and the Descriere of a Deal (`announcements.body`)
   - the Descriere of a Task, with Detalii of a completed Task or an approved Cerere (`tasks.description`)
   - the Descriere of an Event (`events.description`)

   **Every other text field stays plain:** a Cerere's description, the Submission Note, Observații, the Notă pentru Executor, every reason and decision note, the message when applying to a Group, and the Role-change reason.

9. **Storage is Markdown in the same columns**, kept to exactly the styles of decision 3. Highlight is written `==text==`. Raw HTML in a field shows as text.
10. **The limits count what the reader sees.** The visible text is at most 2000 characters, and the stored text at most 4000 as a cap. The field shows a counter of visible characters.
11. **Short previews.**
    - The three-line Announcement and Deal cards keep bold, italic, strikethrough and highlight. Headings and list items run on one line joined by " · ", and links show as their words.
    - The one-line Task row and the two-line critical banner are plain.
    - Everything opened in full (the details sheets, and the Event card, which already shows the whole description) is fully formatted.
12. **Existing text is read as Markdown, with no migration.** A single line break stays a line break. Before release, one read-only scan counts the old rows whose look would change, and we look at them.
13. **Task history shows Înainte and După formatted**, as each version looked.
14. **Pasting.**
    - From Google Docs or a web page, a paste keeps what the app supports (bold, italic, strikethrough, headings as Titlu or Subtitlu, lists, quotes, links) and drops the rest. Fonts, colours, sizes and images go; a table's cells become text.
    - From WhatsApp, a paste turns `*bold*`, `_italic_` and `~tăiat~` into real formatting.
15. **Typing shortcuts.**
    - At the start of a line: `- ` makes a bulleted list, `1. ` a numbered list, `# ` a Titlu, `## ` a Subtitlu, `> ` a Citat.
    - On a laptop: Ctrl/Cmd+B, Ctrl/Cmd+I and Ctrl/Cmd+K (link).
    - Symbols inside a line (`**word**`, `*word*`) are **not** converted while typing; only a paste converts them (decision 14).
16. **Clearing and literal symbols.** "Fără formatare" removes every mark from the selection; once the text is saved, its symbols stay literal. The reader treats `*` and `_` **inside a word** as text: `5*3*2` and `nume_prenume` show as typed. Formatting starts only at word boundaries.

## What exists (main at 7d8cba16)

| Piece           | Today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fields          | `Textarea` (`app/src/components/ui/input.tsx`) at `AnnouncementFields.tsx:71`, `DealFormSheet.tsx:186`, `TaskForm.tsx:334`, `TaskEditControl.tsx:503`, `CompletedTaskForm.tsx:293` and `EventForm.tsx:374`. Client limits in `lib/schemas/{announcement,deal,task,event}.ts` use the reason codes `body_too_long` and `description_too_long`.                                                                                                                                                                                                     |
| Server limits   | `announcements_body_length_ck`, `tasks_description_length_ck` and `events_description_length_ck` (`char_length ≤ 2000`, `20260923231125_constraints_kit.sql`). Also `guard_announcement_text` (`20261007190000_attached_links_five.sql:110`), the checks in `create_task_impl` / `update_task_impl` (`20261014225803_task_min_level.sql`), `create_completed_task_impl` / `approve_completed_work_request_impl` (`20261007190000_attached_links_five.sql`), and `create_event_impl` / `update_event_impl` (`20261014204000_event_min_roles.sql`). |
| Read sites      | Full text:<br>• `AnnouncementDetailsSheet.tsx:192` and `DealDetailsSheet.tsx:124` (`whitespace-pre-line`)<br>• `TaskDetailsSheet.tsx:335` (`pre-wrap`)<br>• `EventCard.tsx:155` (no white-space rule, so line breaks are lost today)<br>• `TaskHistory.tsx:258` (Înainte / După)<br>Previews:<br>• `AnnouncementCard.tsx:74` and `DealCard.tsx:92` (`line-clamp-3`)<br>• `CriticalAnnouncementBanner.tsx:36` (`line-clamp-2`)<br>• `TaskRow.tsx:259` (`line-clamp-1`)                                                                             |
| Plain consumers | `private.notify_announcement` (`20261014153142_edit_notices.sql:110`) copies the whole body into the Notification body. `private.notify` clips at 2000 characters. Push (`send-push`) and the Email Digest (`send-digest`) read Notification rows only. `private.event_announcement_body` (`20260929170000_announcement_deadline.sql:282`) copies an Event's description into its Announcement, clipped at 1999 characters plus "…". Task and Event descriptions reach no Notification. Nothing searches prose: the Work Filter matches titles.   |
| Links           | `safeHttpUrl` and `inAppPath` (`app/src/lib/links.ts`). Attached Links render through `AttachedLinksList.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Platform        | The CSP is enforced (`app/src/pwa/_headers.template`: `style-src 'self'`, no inline styles). The service worker precaches every `assets/*.js` (`pwa-config.ts`). The phone keyboard is tracked by `lib/keyboard-inset.ts` (#1013).                                                                                                                                                                                                                                                                                                                |

## Design

### A. The dialect

One Markdown dialect, written by the editor and read by the reader:

| Block                       | Written as     | Notes                                                                                      |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------ |
| Paragraph                   | text           | A single line break is a hard break. A blank line starts a new paragraph.                  |
| Titlu                       | `# `           | Rendered one level below the sheet's title (h3).                                           |
| Subtitlu                    | `## `          | h4. Deeper levels (`###` and beyond) read as Subtitlu.                                     |
| Citat                       | `> `           |                                                                                            |
| Bulleted and numbered lists | `- ` and `1. ` | Nesting is allowed (Tab and Shift+Tab on a laptop); pasted nested lists keep their levels. |

| Inline        | Written as           | Notes                                   |
| ------------- | -------------------- | --------------------------------------- |
| Bold          | `**bold**`           |                                         |
| Italic        | `*italic*`           | On reading, `_italic_` is accepted too. |
| Strikethrough | `~~tăiat~~`          |                                         |
| Highlight     | `==evidențiat==`     |                                         |
| Text Link     | `[words](https://…)` |                                         |
| Bare address  | `https://…`          | An autolink.                            |
| Escapes       | `\*` and the like    | Backslash escapes are honoured.         |

Emphasis markers inside a word are literal (decision 16). Everything outside the dialect shows as typed:

- raw HTML
- images
- tables
- code fences and inline code
- reference links
- any link whose address fails `safeHttpUrl`

### B. Reading: one component, three views

`FormattedText` (in `app/src/components`) lexes with `marked`, the parser `@tiptap/markdown` already uses, and maps tokens to React elements. It never sets `dangerouslySetInnerHTML`. HTML tokens become text.

The three views:

- **`full`.** Every style. Line breaks are kept. A Text Link opens in a new tab with `rel="noopener noreferrer"`, or, when `inAppPath` resolves it to the app, navigates inside the app.
- **`preview`.** For the three-line cards. Bold, italic, strikethrough and highlight are kept. Headings, quotes and list items are joined into one run with " · ". Links render as their words, because the card is the tap target. It is used with `line-clamp-3`.
- **`plain`.** Words only, in TypeScript. List items are prefixed "• " (numbered items keep their number), and a Text Link becomes its words. Used for the Task row, the banner and anything the page shortens.

Read sites:

| Site                                                               | View                                                |
| ------------------------------------------------------------------ | --------------------------------------------------- |
| `AnnouncementDetailsSheet`, `DealDetailsSheet`, `TaskDetailsSheet` | `full`                                              |
| `EventCard`                                                        | `full`, which also fixes the lost line breaks there |
| `TaskHistory` (Înainte and După of a description edit)             | `full`                                              |
| `AnnouncementCard`, `DealCard`                                     | `preview`                                           |
| `TaskRow`, `CriticalAnnouncementBanner`                            | `plain`                                             |

Styles live in our stylesheet, never inline. Headings and quotes use the app's type scale (19 and 16 px, the quote border in `--border`). Highlight uses the warning tint, never brand red.

### C. Writing: one editor, two toolbars

- **The component.** `FormattedTextField` replaces `Textarea` at the six sites listed under Fields. It is built on Tiptap 3 (`@tiptap/react`, `@tiptap/pm`, `@tiptap/markdown`) with only the extensions for the dialect:
  - Document, Paragraph, Text, HardBreak
  - Heading (levels 1–2)
  - Bold, Italic, Strike, Highlight (single colour, renders `<mark>`)
  - BulletList, OrderedList, ListItem
  - Blockquote, Link, UndoRedo

  Tiptap's input rules for inline marks are **off** (decision 15); the line-start rules and the keyboard shortcuts are on.

- **Choosing the toolbar.** `matchMedia('(pointer: coarse)')`, observed live:
  - **Coarse (touch):** the keyboard bar of decision 1. It shows only while the field has focus. It docks above the keyboard through `keyboard-inset`, and sits at the bottom of the visible area when no keyboard is up. Aa replaces the keyboard with its panel; tapping Aa again, or into the text, brings the keyboard back.
  - **Fine (mouse or trackpad):** the top toolbar of decision 4. It stays at the top of the field while a long text scrolls. Every control has a 44 px hit area, `aria-pressed`, a Romanian `aria-label`, and a tooltip naming its shortcut.
- **The link dialog.** It is a `Dialog` with at most two fields: **Adresa** (`https://…`), plus **Text** when nothing is selected. A link already there offers **Elimină linkul**. An address that fails `safeHttpUrl` is refused under the field: "Adresa trebuie să înceapă cu http:// sau https://."
- **Pasting** (decision 14).
  - Tiptap's HTML paste goes through the dialect's schema, so anything outside it falls away.
  - A plain-text paste is first run through a WhatsApp converter. `*x*` becomes bold, `_x_` italic and `~x~` strikethrough, only where the markers sit at word boundaries.
  - A pasted lone address becomes a Text Link.
- **Counter and limits.** Under the field is "N / 2000 caractere", counting the `plain` view's characters. The zod schemas check the visible length (≤ 2000) and the Markdown length (≤ 4000) and keep the reason codes `body_too_long` and `description_too_long`.
- **Loading.**
  - The editor is lazy-loaded with the form sheets, so no reading screen imports it.
  - Its chunk is left out of the service worker's precache (`globIgnores`) and cached at runtime on first use, because publishing needs the network anyway.
  - Tiptap runs with `injectCSS: false`, and its few rules move into our stylesheet, because the CSP forbids inline `<style>`.
  - No extension that writes `style=""` (text style, colour, font, alignment) is installed.

### D. The server

- **One stripper.** `private.formatted_text_plain(text) returns text`, `immutable`, `set search_path = ''`. It is a regexp chain that gives the same words as the TypeScript `plain` view, and both are tested against the same fixture list.
- **Limits.**
  - Each of the three `*_length_ck` constraints becomes `char_length(x) <= 4000`.
  - A second check per column, `char_length(private.formatted_text_plain(x)) <= 2000`, enforces the visible limit. The commands and `guard_announcement_text` raise the same reason codes as today before the constraint would fire.
  - Per the conventions, this is one check per rule, with one mutation test each.
- **Notifications.** `private.notify_announcement` passes `private.formatted_text_plain(new.body)` as the Notification body. Notificări, push and the Email Digest then receive plain words and need no change.
- **The Event to Announcement copy.** `private.event_announcement_body` keeps the description as Markdown after its date line. It clips at the last whole block (paragraph or list item) that keeps the visible text within 2000 characters, then appends "…" as its own paragraph, so a cut never lands inside a marker.
- **Reasons and notes.** They stay plain columns, so the notification bodies built from them (cancel, reopen, return, give up, rejections, applications) and the `left()` cuts of a Cerere's description are untouched.

### E. Copy (Romanian) and DESIGN.md

- **Controls:** Stil (Text ▾), Titlu, Subtitlu, Text, Citat, Aldin, Cursiv, Tăiat, Evidențiază, Listă, Listă numerotată, Link, Fără formatare, Ascunde tastatura, Stiluri (Aa).
- **The link dialog:**
  - add: title "Adaugă link", buttons Renunță / Adaugă
  - edit: title "Modifică linkul", plus Elimină linkul
- **DESIGN.md** gains two rows in its component table when this is built:
  - **Formatted text field** → `FormattedTextField`: "Toolbar by input: the keyboard bar with Aa on touch, the top toolbar with a mouse."
  - **Formatted text** → `FormattedText`: "`full`, `preview` or `plain`; never innerHTML."

### F. Existing rows: the scan

One read-only query, run on staging and then by Alex on production before the reader ships. It looks at `announcements.body`, `tasks.description`, `events.description` and the `description` before and after values in `task_activity.details`. It counts the rows, and lists up to 50 per pattern, where any of these appears:

- a line starting with `- `, `* `, `+ `, `1. `, `# ` or `> `
- `**`, `__`, `~~` or `==`
- `*x*` or `_x_` at word boundaries
- `[x](`
- a backslash
- `<` followed by a letter

The patterns that stay literal under decision 16 are excluded. Odd hits get fixed by editing the item in the app, never by SQL.

### G. Tests (same PRs)

- **vitest**
  - **Reader:** one fixture per dialect rule; `5*3*2`, `nume_prenume`, `<script>`, `[x](javascript:…)`, `<img onerror>`; old plain text with line breaks and leading dashes; each of the three views.
  - **Stripper parity:** a shared fixture list of input and plain output.
  - **Editor:** each toolbar control emits the expected Markdown; the toolbar choice follows a mocked `pointer: coarse`; paste of Google Docs HTML and of WhatsApp text; Ctrl/Cmd+B, I and K; the visible counter and both limits.
- **pgTAP**
  - The stripper on the same fixture list.
  - Per column: visible 2000 passes with stored 3000; visible 2001 is refused; stored 4001 is refused, each with its reason code.
  - `notify_announcement` writes plain words.
  - The Event copy clips on a block boundary.
- **Acceptance by mutation:** reverting each rule makes its named assertion fail.

## PR split

1. **The scan** (§F). It must run on staging and production before PR 2 ships.
2. **The reader** (§B) and every read site, with no editor yet. Existing rows start rendering as Formatted Text.
3. **The server** (§D): the stripper, the limits, the plain Notification body, the Event copy clip. It is independent of PR 2.
4. **The editor** (§C) at the six sites, the PWA `globIgnores` entry and the DESIGN.md rows. It follows PRs 2 and 3.

## Measurements behind the choices (2026-10-20)

All sizes are minified and gzipped, with React excluded:

| Package                          | Gzip KB | Raw KB | Notes                                  |
| -------------------------------- | ------: | -----: | -------------------------------------- |
| Tiptap 3.32 + `@tiptap/markdown` |   145.3 |    461 | The full kit with menus is 166 KB gzip |
| Lexical 0.52 with Markdown       |   138.5 |        | Its transformers can't be trimmed      |
| `marked` alone                   |    13.5 |        | Mapped by our own component            |
| react-markdown + remark-gfm      |    46.6 |        |                                        |
| micromark + GFM                  |    20.9 |        |                                        |

- **`marked` without HTML output.** `marked` emits `<script>` and `javascript:` links when used to produce HTML, which is why the reader maps tokens and never outputs HTML.
- **Today's bundle.** The entry chunk is 842 KB raw (252 KB gzip). All JavaScript is 1.90 MB raw (584 KB gzip). The precache is 61 entries, 2,283 KiB. The 2 MB `chunkSizeWarningLimit` is per chunk; the editor chunk is about 0.5 MB raw.

## Calls made in writing this up (for Alex to check)

- Titlu renders as h3 and Subtitlu as h4. Deeper headings from a paste read as Subtitlu.
- Lists may nest.
- The phone bar shows only while the field has focus.
- The laptop toolbar stays at the top of the field while a long text scrolls.
- The link editor is a `Dialog`, on both phones and laptops.
- Links to the app open inside the app.
- In plain words, a Text Link shows its words and not its address.
- The Event copy clips at a whole block.
- Highlight uses the warning tint.
- The scan lists at most 50 rows per pattern.

## Later (not in this design)

- Checklists, and an Executor ticking a Task's steps.
- @mentions of Members.
- `mailto:` and `tel:` links.
- Formatting for a Cerere's description or the Submission Note.
- Images in text.
- A second typeface.

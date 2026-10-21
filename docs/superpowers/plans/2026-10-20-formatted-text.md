# Formatted Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Announcement or Deal body, a Task description and an Event description become Formatted Text. They hold Markdown in the same columns. Touch devices write it with option 3's keyboard bar; a mouse writes it with option 1's toolbar. It is read fully formatted, lightly formatted on cards, and as plain words in Notifications.

**Architecture:** Three PRs and a gate, in order.

1. **PR 1, the server.** It adds `private.formatted_text_plain`, its TypeScript twin and the visible-length limits on both sides. It sends plain words to Notifications and makes the Event-to-Announcement copy clip on line boundaries.
2. **The scan.** A read-only query, built on that stripper, lists old rows whose look will change. It runs on staging and production before the reader ships.
3. **PR 2, the reader.** It maps `marked` tokens to React elements at every read site.
4. **PR 3, the editor.** A lazy-loaded Tiptap field with both toolbars, swapped in at the six form sites.

**Tech Stack:**

- Supabase Postgres (plpgsql, pgTAP)
- React 19 + TypeScript (vitest, Testing Library, zod)
- `marked` ^17.0.1, the major `@tiptap/markdown` already depends on
- Tiptap 3.32.0: `@tiptap/react`, `@tiptap/pm`, `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/markdown`, `@tiptap/extension-highlight`, all pinned to the exact same version

**Spec:** `docs/superpowers/specs/2026-10-20-formatted-text-design.md` (ruling R60). Glossary: `CONTEXT.md`, Formatted Text and Text Link.

> This plan reorders the spec's PR split. The server comes first so that the scan uses the real stripper; the spec's §PR split is updated to match.

## Global Constraints

- **Formatted Text columns:** `announcements.body` (Announcement and Deal), `tasks.description`, `events.description`. Nothing else changes: Cerere descriptions, the Submission Note, every note and every reason stay plain.
- **Dialect:**

  | Block     | Written as                                                            |
  | --------- | --------------------------------------------------------------------- |
  | Paragraph | Text. A single `\n` is a hard break; a blank line ends the paragraph. |
  | Titlu     | `# ` (Tiptap heading level 1). Rendered by the reader as `h3`.        |
  | Subtitlu  | `## ` (level 2). Rendered as `h4`; `###` and deeper read as Subtitlu. |
  | Citat     | `> `                                                                  |
  | Lists     | `- ` and `1. `, nesting allowed                                       |

  | Inline        | Written as                 |
  | ------------- | -------------------------- |
  | Bold          | `**x**`                    |
  | Italic        | `*x*`; `_x_` is read too   |
  | Strikethrough | `~~x~~`; `~x~` is read too |
  | Highlight     | `==x==`                    |
  | Text Link     | `[words](https://…)`       |
  | Bare address  | `https://…`                |
  - A single `*` between two letters or digits is literal (`5*3*2`); `_` inside a word is literal (`nume_prenume`).
  - Everything else renders as its raw text: HTML, images, tables, code, `---`, setext headings and reference definitions.

- **Limits:** at most **2000** visible characters (`char_length(private.formatted_text_plain(x))` and `visibleLength(x)`) and at most **4000** stored characters. Breaking either raises the existing reason, `body_too_long` (announcements) or `description_too_long` (tasks, events), with the existing copy.
- **Links:** http(s) only, through `safeHttpUrl` (`app/src/lib/links.ts`). A link that `inAppPath` resolves to the app navigates inside the app. Any other link opens with `target="_blank" rel="noopener noreferrer"`.
- **CSP:**
  - Nothing writes `style=""` or a `<style>` element.
  - Tiptap runs with `injectCSS: false`, and its rules live in `app/src/theme/formatted-text.css`.
  - The reader never uses `dangerouslySetInnerHTML`.
- **Copy (Romanian), exactly:**
  - Controls: Stil, Titlu, Subtitlu, Text, Citat, Aldin, Cursiv, Tăiat, Evidențiază, Listă, Listă numerotată, Link, Fără formatare, Ascunde tastatura, Stiluri (Aa).
  - Link dialog: "Adaugă link" / "Modifică linkul", fields "Text" and "Adresa", buttons Renunță / Adaugă / Elimină linkul.
  - Address error: "Adresa trebuie să înceapă cu http:// sau https://."
  - Counter: "{n} / 2000 caractere".
- **Toolbar choice:** `matchMedia('(pointer: coarse)')`, observed live. Coarse gets the keyboard bar; fine gets the top toolbar.
- **Migrations:**
  - Create each with `npx supabase migration new <name>`, dated after the newest on `main` (today `20261020172908_retention_signal_floor.sql`).
  - Restate every `create or replace` body from `main`'s latest definition with the restate tooling of `docs/superpowers/plans/2026-10-18-portofoliu-interne.md` §"Tooling used by every restate step".
  - Every new function ends with `revoke execute … from public, anon, authenticated, service_role;`.
- **Rosters:** each new private function gets a row in `supabase/tests/tracker_grants.test.sql`'s `pinned_private_functions`, and the count pin (`258` at :1003) goes up to match.
- **Gates:** the database gates (`npx supabase db reset`, `npx supabase test db`, `scripts/check-local-ci.sh db`, `npm run check:root`) never run at the same time as the full vitest.
- **Shipping:**
  - One branch and one PR per part. The body links the spec and its issue and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
  - CodeRabbit review (or a fresh-context reviewer when its quota means a long wait), then merge on green CI with `gh pr merge --merge --delete-branch`, then `gh run list --commit <merge sha>`.
  - Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Nothing is pushed or merged without Alex's go-ahead on the PR.

## Review Focus

1. **Opening and saving an old item without touching the text must not rewrite it.** Tiptap's Markdown output may differ from a legacy row: `*` lists, escaped stars, spacing. A no-op save would then add a "Modificat: Descriere" Notification and a history entry. Pinned in Task 9: an untouched field submits the original string byte for byte.
2. **Diacritics next to markers behave the same in SQL and TypeScript.** Cases: `*și*`, `**Ședința**`, `ăla*b*`, `_țară_`. Pinned in Task 1's fixture list, which the parity test of Task 2 replays.
3. **Text from Windows or WhatsApp with `\r\n` line breaks and leading spaces before a dash.** The plain words and the visible count must not change because of `\r`. Pinned in Task 1's fixtures and Task 5's reader fixtures.
4. **On an iPhone, B and I must keep the keyboard open, and Aa must close it while keeping the selection.** Tapping the text brings the keyboard back. Pinned by the mode test of Task 11; checked by Alex on the PR 3 preview deploy (Task 12).
5. **A Google Docs paste** with `h3`, nested lists, a table, an image, a coloured span and a `javascript:` link. It must become Subtitlu, nested lists, the table's cell text, nothing, plain text and plain text. Pinned in Task 10.

---

# PR 1 — The server (#1090, branch `feat/formatted-text-server`)

**Precondition:** `git checkout main && git pull --ff-only && npx supabase db reset && git checkout -b feat/formatted-text-server`, then `npx supabase migration new formatted_text`. Tasks 1, 3 and 4 append to that one migration, in task order.

### Task 1: `private.formatted_text_plain`

**Files:**

- Create: `supabase/migrations/<ts>_formatted_text.sql` (section 1)
- Create: `supabase/tests/formatted_text_plain.test.sql`
- Modify: `supabase/tests/tracker_grants.test.sql` (roster row and count)

**Interfaces:**

- Produces: `private.formatted_text_plain(p_text text) returns text`, `language plpgsql immutable parallel safe set search_path = ''`. Null in, null out.

- [ ] **Step 1: Write the failing suite.** It is the single source of the stripper's fixtures: Task 2's parity test parses it. Each fixture is one line, exactly `select is(private.formatted_text_plain(E'<in>'), E'<out>', '<name>');`, and nothing else in the file uses that shape. The fixtures (`\n` written as `\n` inside `E''`):

  | Input                                                   | Output                           | Name                     |
  | ------------------------------------------------------- | -------------------------------- | ------------------------ |
  | `Ne vedem **joi**.`                                     | `Ne vedem joi.`                  | `bold`                   |
  | `*cursiv* și _cursiv_`                                  | `cursiv și cursiv`               | `italic both`            |
  | `5*3*2 și nume_prenume`                                 | `5*3*2 și nume_prenume`          | `intraword literal`      |
  | `**Ședința** *și* _țară_ ăla*b*`                        | `Ședința și țară ăla*b*`         | `diacritics`             |
  | `~~vechi~~ ~tăiat~ ==nou==`                             | `vechi tăiat nou`                | `strike and highlight`   |
  | `# Titlu\n## Sub\n### Mic`                              | `Titlu\nSub\nMic`                | `headings`               |
  | `> citat`                                               | `citat`                          | `quote`                  |
  | `- unu\n  - doi\n1. trei`                               | `• unu\n  • doi\n1. trei`        | `lists`                  |
  | `[formularul](https://forms.gle/x) și https://osubb.ro` | `formularul și https://osubb.ro` | `links`                  |
  | `[rău](javascript:alert(1))`                            | `[rău](javascript:alert(1))`     | `unsafe link stays text` |
  | `\\*nu\\* \\# titlu`                                    | `*nu* # titlu`                   | `escapes`                |
  | `rând\r\n- punct`                                       | `rând\n• punct`                  | `crlf`                   |
  | `  - spațiu în față`                                    | `  • spațiu în față`             | `leading spaces`         |
  | `<b>html</b>`                                           | `<b>html</b>`                    | `html stays text`        |

  The suite also asserts:
  - `formatted_text_plain(null)` is null
  - the function is `immutable` (`provolatile = 'i'`)
  - `authenticated` cannot execute it (`has_function_privilege` false)

- [ ] **Step 2: Run it and see it fail.** `npx supabase test db supabase/tests/formatted_text_plain.test.sql` fails with "function private.formatted_text_plain(text) does not exist".

- [ ] **Step 3: Implement it.** The order of the chain matters. Every pattern is newline-sensitive (`'gn'` where `^` must mean line start):

```sql
v := replace(p_text, E'\r\n', E'\n');
v := regexp_replace(v, '^[ \t]*#{1,6}[ \t]+', '', 'gn');
v := regexp_replace(v, '^[ \t]*>[ \t]?', '', 'gn');
v := regexp_replace(v, '^([ \t]*)[-*+][ \t]+', '\1• ', 'gn');
v := regexp_replace(v, '\[([^]\n]*)\]\((https?://[^)[:space:]]+)\)', '\1', 'g');
v := regexp_replace(v, '\*\*([^*\n]+)\*\*', '\1', 'g');
v := regexp_replace(v, '~~([^~\n]+)~~', '\1', 'g');
v := regexp_replace(v, '==([^=\n]+)==', '\1', 'g');
v := regexp_replace(v, '(^|[^[:alnum:]*\\])\*([^*[:space:]]([^*\n]*[^*[:space:]])?)\*(?![[:alnum:]*])', '\1\2', 'gn');
v := regexp_replace(v, '(^|[^[:alnum:]_\\])_([^_[:space:]]([^_\n]*[^_[:space:]])?)_(?![[:alnum:]_])', '\1\2', 'gn');
v := regexp_replace(v, '(^|[^[:alnum:]~\\])~([^~[:space:]]([^~\n]*[^~[:space:]])?)~(?![[:alnum:]~])', '\1\2', 'gn');
v := regexp_replace(v, '\\([\\`*_{}\[\]()#+.!~=>|-])', '\1', 'g');
return btrim(v);
```

Add the comment, the revoke, and the roster row `('formatted_text_plain', 'p_text text', 'none')`; the count goes from 258 to 259.

- [ ] **Step 4: Run it and see it pass.** The same command returns every assertion `ok`.

- [ ] **Step 5: Commit.** `feat(db): private.formatted_text_plain strips Formatted Text to words (R60)`.

### Task 2: The TypeScript twin and the parity test

**Files:**

- Create: `app/src/lib/formatted-text/plain.ts`
- Create: `app/src/lib/formatted-text/plain.test.ts`

**Interfaces:**

- Consumes: Task 1's suite file, as fixtures.
- Produces:
  - `toPlainText(markdown: string): string`, the same chain as Task 1. Use the `gmu` flags; `[[:alnum:]]` becomes `[\p{L}\p{N}]` and `[[:space:]]` becomes `\s`.
  - `visibleLength(markdown: string): number`, which is `charLength(toPlainText(markdown))` with `charLength` from `lib/normalize.ts`.

- [ ] **Step 1: Write the parity test.** It reads `../../../../supabase/tests/formatted_text_plain.test.sql` with `node:fs` and extracts every line matching `/^select is\(private\.formatted_text_plain\(E'(.*)'\), E'(.*)', '(.+)'\);$/`. It unescapes `\\n`, `\\r`, `\\\\` and `''`, then asserts `toPlainText(input) === output` per fixture. Two more assertions:
  - at least 14 fixtures were found
  - `visibleLength('**ab**')` is `2`
- [ ] **Step 2: Run it and see it fail.** `npm --prefix app run test:run -- src/lib/formatted-text/plain.test.ts` fails with "Failed to resolve import ./plain".
- [ ] **Step 3: Implement `toPlainText` and `visibleLength`** in `plain.ts`.
- [ ] **Step 4: Run it and see it pass.** Every fixture passes.
- [ ] **Step 5: Commit.** `feat(app): toPlainText mirrors private.formatted_text_plain (R60)`.

### Task 3: Visible-length limits on both sides

**Files:**

- Modify: `supabase/migrations/<ts>_formatted_text.sql` (section 2)
- Create: `supabase/tests/formatted_text_limits.test.sql`
- Modify: `supabase/tests/tracker_grants.test.sql`, `supabase/tests/constraints_kit.test.sql` (only if a constraint message it pins changes)
- Modify: `app/src/lib/schemas/text.ts`, `app/src/lib/schemas/announcement.ts:21-25`, `deal.ts`, `task.ts:27-30`, `event.ts:50`, and their `*.test.ts`

**Interfaces:**

- Consumes: `private.formatted_text_plain`; `toPlainText` and `visibleLength`.
- Produces:
  - `private.require_formatted_text_length(p_field text, p_value text) returns void`, `immutable`. Null or blank passes. `char_length(p_value) > 4000` or `char_length(private.formatted_text_plain(p_value)) > 2000` raises `PT400 <p_field>_too_long`.
  - Constraints `announcements_body_length_ck`, `tasks_description_length_ck` and `events_description_length_ck` keep their names and hold only the stored cap. Their expression becomes `char_length(<col>) <= 4000` (`<col> is null or …` where the column is nullable): drop, add `not valid`, then `validate constraint`.
  - The visible limit lives only in `private.require_formatted_text_length`, called from the `SECURITY DEFINER` row guard `private.guard_announcement_text` and the `SECURITY DEFINER` Task and Event commands. No constraint calls it: a `CHECK` runs as the writing role, and a client write cannot call a private function revoked from `authenticated`.
  - `requiredFormattedText(rule: { required: string; tooLong: string })` and `optionalFormattedText(rule: { tooLong: string })` in `lib/schemas/text.ts`. They trim like `requiredText` / `optionalText`, and the issue is `tooLong` when `visibleLength(v) > 2000` or `charLength(v) > 4000`.

- [ ] **Step 1: Write the failing suite** `formatted_text_limits.test.sql`. For each column (an `announcements` insert, `create_task` signed in as a Group Manager, `create_event` signed in as one) assert:

  | Value                                               | Expected                                              |
  | --------------------------------------------------- | ----------------------------------------------------- |
  | `repeat('**a** ', 600)` (3600 stored, 1199 visible) | accepted                                              |
  | `repeat('a', 2001)`                                 | refused with `body_too_long` / `description_too_long` |
  | `repeat('**a**', 801)` (4005 stored)                | refused                                               |

  Also assert that `private.require_formatted_text_length('description', null)` and `('description', '  ')` pass, and that `update_task` with 2001 visible characters is refused.

- [ ] **Step 2: Run it and see it fail.** The 3600-stored value is refused today by the 2000-character checks.

- [ ] **Step 3: Implement the server side.**
  - Add the helper, with its revoke and roster row (count goes to 260).
  - Swap the three constraints.
  - In `private.guard_announcement_text` (latest: `20261007190000_attached_links_five.sql`), swap the branch `elsif char_length(new.body) > 2000 then` for a call to `private.require_formatted_text_length('body', new.body)`, its `PT400` named `23514 body_too_long` as the guard names its other reasons.
  - Restate every function whose latest body calls `private.require_text_length('description', …, 2000)` on a Task or Event description, swapping that call for `private.require_formatted_text_length('description', …)` with the same value argument. List them on the reset stack with: `select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and prosrc like '%require_text_length(''description''%'`.
  - Leave out any function whose description is a Cerere's (`create_completed_work_request_impl`).

- [ ] **Step 4: Change the client schemas** to use the two new helpers: announcement and deal `body` with `requiredFormattedText({ required: 'body_required', tooLong: 'body_too_long' })`; task and event `description` with `optionalFormattedText({ tooLong: 'description_too_long' })`. Add to each schema's test a 2001-character case (refused) and a `repeat('**a** ', 600)` case (accepted).

- [ ] **Step 5: Run both suites and see them pass.** `npx supabase test db supabase/tests/formatted_text_limits.test.sql`, then `npm --prefix app run test:run -- src/lib/schemas`.

- [ ] **Step 6: Commit.** `feat: Formatted Text limits count visible characters (R60)`.

### Task 4: Plain Notifications and the Event copy clip

**Files:**

- Modify: `supabase/migrations/<ts>_formatted_text.sql` (section 3)
- Create: `supabase/tests/formatted_text_notifications.test.sql`

**Interfaces:**

- Consumes: `private.formatted_text_plain`.
- Produces: `private.notify_announcement(...)` and `private.event_announcement_body(timestamptz, timestamptz, text, text)`, with the same signatures.

- [ ] **Step 1: Write the failing suite.**
  1. Publishing an Announcement with body `Ne vedem **joi**.\n- sala 2/I` writes a Notification whose body is `Ne vedem joi.\n• sala 2/I`.
  2. `private.event_announcement_body(now() + interval '1 day', null, null, <description>)`, where `<description>` is 30 lines of `'**' || repeat('x', 70) || '**'` (each 70 visible characters), returns at most 2000 visible characters and ends with `E'\n…'`. Every line except the last is one of the input lines unchanged, and no line ends inside a `**`.
  3. A short description is returned whole, after its date line, unchanged.
- [ ] **Step 2: Run it and see it fail** on assertions 1 and 2.
- [ ] **Step 3: Implement both changes.**
  - Restate `private.notify_announcement` (latest: `20261014153142_edit_notices.sql`), swapping the `p_row.body,` argument of `private.notify(...)` for `private.formatted_text_plain(p_row.body),`.
  - Restate `private.event_announcement_body` (latest: `20260929170000_announcement_deadline.sql`). Replace its clip (`if char_length(v_body) > 2000 then v_body := left(v_body, 1999) || '…'; end if;`) with a line-unit clip. While `char_length(private.formatted_text_plain(v_body)) > 2000 or char_length(v_body) > 4000`, drop the last line of the description part. Once anything was dropped, append `E'\n…'`. The date line is never dropped.
  - Update the function's comment to match.
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Commit.** `feat(db): plain Notification words and a line-safe Event copy (R60)`.

### Task 5: Docs, gates, PR 1

- [ ] Update `docs/backend/conventions.md` with one paragraph under limits: "Formatted Text (R60)", covering the two helpers, the 2000 visible / 4000 stored rule, and that Notification bodies carry `formatted_text_plain`.
- [ ] Run `npx supabase db reset && npx supabase test db` (all green), then `npm run check:root`, then `npm --prefix app run typecheck && npm --prefix app run lint && npm --prefix app run test:run`.
- [ ] Open the PR (`Closes #1090`), get the review, merge on green, and check the staging run.

# Gate — The scan (after PR 1 is on staging, before PR 2 merges)

### Task 6: Run the scan

**Files:**

- Create: `scripts/formatted-text-scan.sql` (committed with PR 2)

- [ ] **Step 1: Write the query.** It is read-only. Over `announcements.body`, `tasks.description`, `events.description`, and `task_activity.details->'before'->>'description'` / `->'after'->>'description'`, it counts the rows where `private.formatted_text_plain(x) is distinct from btrim(replace(x, E'\r\n', E'\n'))`. It lists up to 50 per source as `(source, id, left(x, 120))`.
- [ ] **Step 2: Run it on staging.** Use `npx supabase db query --linked` (or the Supabase MCP `execute_sql` on the staging project, read-only) and post the counts and samples on #1091.
- [ ] **Step 3: Ask Alex to run it on production** (SQL editor, read-only) and to post the result. For each odd row, write down which item to edit in the app. Rows are never fixed by SQL (house rule 1).

# PR 2 — The reader (#1091, branch `feat/formatted-text-reader`)

### Task 7: Lexing and the `FormattedText` component

**Files:**

- Modify: `app/package.json` (add `"marked": "^17.0.1"`)
- Create: `app/src/lib/formatted-text/lex.ts`, `app/src/lib/formatted-text/lex.test.ts`
- Create: `app/src/components/formatted-text/FormattedText.tsx`, `FormattedText.test.tsx`
- Create: `app/src/theme/formatted-text.css`, imported in `app/src/main.tsx` after `screens.css`
- Modify: `app/src/lib/links.ts` (add `textLinkTarget`), `app/src/lib/links.test.ts`

**Interfaces:**

- Produces:
  - `lexFormattedText(markdown: string): Token[]` (`Token` from `marked`).
    - It uses `new Marked({ gfm: true, breaks: true, extensions: [highlight] })`, where `highlight` is an inline extension matching `/^==(?=\S)([\s\S]*?\S)==/` into a `{ type: 'highlight', text, tokens }` token.
    - Before lexing it replaces `\r\n` with `\n` and escapes every single `*` between two letters or digits: `/(?<=[\p{L}\p{N}])\*(?=[\p{L}\p{N}])/gu` becomes `\\*`.
  - `textLinkTarget(href: string, origin?: string): { kind: 'app'; path: string } | { kind: 'external'; href: string } | null`, using `inAppPath`, then `safeHttpUrl`.
  - `FormattedText(props: { text: string; view: 'full' | 'preview'; className?: string })`. It renders `<div class="formatted-text">` (`full`) or `<span class="formatted-text-preview">` (`preview`).
    - `full`: paragraph → `p`; `#` heading → `h3`, `##` and deeper → `h4`; blockquote → `blockquote`; list → `ul` / `ol` / `li`; strong → `strong`; em → `em`; del → `s`; highlight → `mark`.
    - Links: an `app` target is a router `Link`, an `external` target is an `<a target="_blank" rel="noopener noreferrer">`, and `null` is the raw text.
    - Every other token type, and a heading whose `raw` doesn't start with `#`, renders its `raw` as text in a `p`, with line breaks.
    - `preview` keeps `strong`, `em`, `s` and `mark`, renders links as their text, and joins the blocks and list items with `" · "`.
  - The CSS:
    - `.formatted-text` gets `h3` (19 px, 700), `h4` (16 px, 600), a quote border in `--border`, `mark` in `--warning-050` and inherited text colour, and list indents.
    - `.formatted-text-preview strong` uses `font-weight: 600` and `color: var(--foreground)`.
    - The same heading rules also cover the editor's `h1` and `h2` (`.formatted-text :is(h1,h3)`, `:is(h2,h4)`).

- [ ] **Step 1: Write the failing tests.**
  - `lex.test.ts`:
    - `5*3*2` lexes to one text token reading `5*3*2`
    - `==x==` gives a `highlight` token
    - `a\r\nb` gives a `br`
  - `links.test.ts`:
    - `textLinkTarget('javascript:alert(1)')` is null
    - `textLinkTarget(location.origin + '/calendar?event=1')` gives `{ kind: 'app', path: '/calendar?event=1' }`
  - `FormattedText.test.tsx`, one test each:
    - the sample `Ne vedem **joi**.\n\n## Ordinea de zi\n- unu\n- doi` renders `strong`, `h4` and two `li`
    - `<script>x</script>` renders as text, with no script element
    - `[rău](javascript:alert(1))` shows its raw text and has no `a` element
    - `https://osubb.ro` is an `a` with `rel="noopener noreferrer"`
    - legacy text `rând unu\nrând doi\n- punct` keeps the break and gives one `li`
    - `preview` of the sample has the text content `Ne vedem joi. · Ordinea de zi · unu · doi`
    - `---` renders as the text `---`
- [ ] **Step 2: Run them and see them fail.** `npm --prefix app run test:run -- src/lib/formatted-text src/components/formatted-text src/lib/links.test.ts`.
- [ ] **Step 3: Implement** `lex.ts`, `textLinkTarget`, `FormattedText.tsx` and the CSS. Run `npm --prefix app install` (it pulls `marked`).
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `feat(app): FormattedText reads the R60 dialect into React elements`.

### Task 8: Every read site

**Files:** Modify:

- `app/src/screens/announcements/AnnouncementDetailsSheet.tsx:192-194`
- `app/src/screens/deals/DealDetailsSheet.tsx:124-126`
- `app/src/screens/tracker/TaskDetailsSheet.tsx:335-342`
- `app/src/screens/calendar/EventCard.tsx:155-157`
- `app/src/screens/tracker/TaskHistory.tsx:258-263` (description lines only)
- `app/src/screens/announcements/AnnouncementCard.tsx:74-76`
- `app/src/screens/deals/DealCard.tsx:92-94`
- `app/src/screens/tracker/TaskRow.tsx:259-266`
- `app/src/screens/announcements/CriticalAnnouncementBanner.tsx:36-38`

And their tests and snapshots.

**Interfaces:**

- Consumes: `FormattedText` and `toPlainText`.

| Site                                    | Becomes                                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Details sheets, `EventCard`             | `<FormattedText view="full" text={…} />`; the `whitespace-pre-*` classes go                                       |
| `TaskHistory`                           | `changes()` marks the description lines so that Înainte and După render `view="full"`; other fields are unchanged |
| `AnnouncementCard`, `DealCard`          | `<p className="… line-clamp-3 …"><FormattedText view="preview" text={…} /></p>`                                   |
| `TaskRow`, `CriticalAnnouncementBanner` | `{toPlainText(…)}`                                                                                                |

- [ ] **Step 1: Write the failing assertions.**
  - The details sheet of an Announcement with `**joi**` contains a `strong`.
  - `TaskRow` with description `**a** _b_` shows the text `a b`.
  - `EventCard` with `rând\nrând` contains a `br`.
  - `TaskHistory`, for an edit from `a` to `**a**`, shows a `strong` under "După".
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Make the swaps.** Update the snapshots only where the markup changed by design.
- [ ] **Step 4: Run** `npm --prefix app run test:run` **and see it pass.**
- [ ] **Step 5: Commit.** `feat(app): read sites show Formatted Text (R60)`.

### Task 9: Docs, gates, PR 2

- [ ] Commit `scripts/formatted-text-scan.sql` (Task 6) with this PR.
- [ ] Run `npm run check:root` and the app gates (typecheck, lint, format, full vitest, build). Record the entry chunk's raw and gzip size in the PR body: it should grow by about 15 KB gzip.
- [ ] Open the PR (`Closes #1091`; it notes the scan results). Review, merge on green, check staging.

# PR 3 — The editor (#1092, branch `feat/formatted-text-editor`)

### Task 10: Editor configuration, Markdown round trip and pasting

**Files:**

- Modify: `app/package.json` (the six Tiptap packages at `3.32.0`)
- Create: `app/src/components/formatted-text/editor/extensions.ts`, `extensions.test.ts`
- Create: `app/src/components/formatted-text/editor/whatsapp.ts`, `whatsapp.test.ts`

**Interfaces:**

- Produces:
  - `formattedTextExtensions(): Extensions`. It configures StarterKit with:
    - `heading: { levels: [1, 2] }`
    - `code: false`, `codeBlock: false`, `horizontalRule: false`, `underline: false`
    - `link: { autolink: true, linkOnPaste: true, openOnClick: false }`, with the URI checks calling `safeHttpUrl` so that a bare `osubb.ro` never becomes a link

    plus `Highlight.configure({ multicolor: false })` (with `==` Markdown parse and render if the package lacks them) and `Markdown`.

  - `EDITOR_OPTIONS`:
    - `{ injectCSS: false, enableInputRules: ['heading', 'bulletList', 'orderedList', 'blockquote'], enablePasteRules: ['link'] }`
    - plus `editorProps.handlePaste`, which takes `text/plain`-only clipboard data through `whatsappToMarkdown` and inserts the parsed Markdown.
  - `whatsappToMarkdown(text: string): string`.
    - At word boundaries (the character before is a start or a non-letter, non-digit; no space just inside the markers), `*x*` becomes `**x**`, `_x_` becomes `*x*` and `~x~` becomes `~~x~~`.
    - Every other `*`, `_`, `~`, `=`, `[`, `]`, `` ` ``, `<` and `\` is escaped with `\`.
    - Line-start `- ` / `1. ` stay.

- Constraints (from the final review of PR 2):
  - **No mark across a hard break.** The editor never writes a mark (`**`, `*`, `~~`, `==`) that spans a hard break. The reader (CommonMark) joins a mark across a single line break, and the stripper (`toPlainText`, `private.formatted_text_plain`) does not, so the two would read the same text differently. The serializer closes the mark before the break and reopens it after: `**a**\n**b**`, never `**a\nb**`.
  - **Headings outside a sheet.** The reader renders a Titlu as `h3` and a Subtitlu as `h4`. Outside a sheet that is wrong for two sites: the `EventCard`, whose title is already an `h3`, and the `TaskHistory` timeline. When this PR adds the editor's `h1`/`h2` rules, give `FormattedText` a heading-level offset or a "no headings" option for those two sites.

- [ ] **Step 1: Write the failing tests.**
  - `extensions.test.ts`: create an `Editor` in jsdom with the extensions and `contentType: 'markdown'`.
    - Bold, italic, strikethrough and highlight across a hard break (`Shift+Enter`) serialize as two marked runs (`**a**\n**b**`), never as one mark spanning the break.
    - Round trip of the spec's sample (`Ne vedem **joi**.\n\n## Ordinea de zi\n\n- unu\n- doi\n\n> citat\n\n==nou== ~~vechi~~ [formular](https://forms.gle/x)`): `getMarkdown()` reparsed gives the same JSON.
    - Typing `**a**` through `insertContent` as text stays literal stars.
    - `- ` at line start makes a bullet list.
    - Pasting the HTML `<h3>x</h3><table><tr><td>c</td></tr></table><img src=y><span style="color:red">s</span><a href="javascript:x">j</a><ul><li>a<ul><li>b</li></ul></li></ul>` gives the Markdown `## x`, `c`, no image, `s`, `j` without a link, and a nested list.
  - `whatsapp.test.ts`:
    - `*Ședința* e _joi_ ~nu~` gives `**Ședința** e *joi* ~~nu~~`
    - `5*3*2` gives `5\*3\*2`
    - `a * b * c` gives `a \* b \* c`
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement both files.** Run `npm --prefix app install`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `feat(app): Tiptap configured for the R60 dialect`.

### Task 11: The two toolbars and the link dialog

**Files:**

- Create: `app/src/lib/use-coarse-pointer.ts`, `use-coarse-pointer.test.ts`
- Create: `app/src/components/formatted-text/editor/FormattedTextToolbar.tsx`
- Create: `app/src/components/formatted-text/editor/FormattedTextKeyboardBar.tsx`
- Create: `app/src/components/formatted-text/editor/TextLinkDialog.tsx`
- Create: `app/src/components/formatted-text/editor/toolbars.test.tsx`
- Modify: `app/src/components/ui/sheet.tsx` (the bottom offset reads `--format-bar-h`), `app/src/theme/tailwind.css` (`--format-bar-h: 0px` on `:root`)

**Interfaces:**

- Consumes: an `Editor` from Task 10; `Dialog` from `components/ui/dialog.tsx`; `useKeyboardState` from `lib/keyboard-inset.ts`.
- Produces:
  - `useCoarsePointer(): boolean`, a live `matchMedia('(pointer: coarse)')` subscription that is `false` without `matchMedia`.
  - `FormattedTextToolbar({ editor })`. Its order: Stil menu (Titlu, Subtitlu, Text, Citat) | Aldin, Cursiv, Tăiat | Listă, Listă numerotată | Link, Evidențiază, Fără formatare.
    - It is `role="toolbar"` with arrow-key focus.
    - Toggles use `aria-pressed`.
    - Hit areas are 44 px.
    - It sticks to the top of the field (`sticky top-0`).
  - `FormattedTextKeyboardBar({ editor, mode, onModeChange })`, where `mode` is `'hidden' | 'keyboard' | 'panel'`.
    - It is fixed at `bottom: var(--keyboard-inset)` and full width at `z-80`.
    - While shown it sets `--format-bar-h` on `<html>`: the bar's height, or bar plus panel.
    - Bar: Stiluri (Aa), Aldin, Cursiv, Listă, Link, Ascunde tastatura.
    - The Aa panel has three rows: Titlu / Subtitlu / Text / Citat; Aldin / Cursiv / Tăiat / Evidențiază / Link; Listă / Listă numerotată / Fără formatare.
    - Bar buttons call `preventDefault` on `mousedown` and `pointerdown`, so focus and the keyboard stay.
    - Aa blurs the editor (`editor.commands.blur()`) and sets `mode: 'panel'`. Panel commands run without `.focus()`. Focusing the editor sets `mode: 'keyboard'`. Ascunde tastatura blurs and sets `mode: 'hidden'`.
  - `TextLinkDialog({ editor, open, onOpenChange })`. Its fields are Adresa, plus Text when the selection is empty.
    - Adresa is checked with `safeHttpUrl`, with the exact copy in Global Constraints.
    - On an existing link it shows Elimină linkul.
    - Ctrl/Cmd+K opens it.

- [ ] **Step 1: Write the failing tests** (`toolbars.test.tsx` with an editor from Task 10):
  - each toolbar button produces its Markdown (Aldin gives `**x**`, Listă numerotată gives `1. x`, Titlu gives `# x`, Evidențiază gives `==x==`)
  - Fără formatare on `**x** ==y==` gives `x y`
  - the dialog refuses `osubb.ro` with the exact copy and accepts `https://osubb.ro`
  - the keyboard bar's mode machine: Aa gives `panel` and the editor is not focused; then a text focus gives `keyboard`
  - Aldin's `mousedown` is `defaultPrevented`
  - `useCoarsePointer` follows a mocked `matchMedia` change
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement the four components and the hook.** Use Lucide icons only, Romanian `aria-label`s, and our `cn`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `feat(app): R60 toolbars, keyboard bar with Aa, link dialog`.

### Task 12: `FormattedTextField` at the six form sites

**Files:**

- Create: `app/src/components/formatted-text/FormattedTextField.tsx` (the lazy shell), `app/src/components/formatted-text/editor/FormattedTextEditor.tsx` (default export, the Tiptap part), `FormattedTextField.test.tsx`
- Modify:
  - `app/src/screens/announcements/AnnouncementFields.tsx:71`
  - `app/src/screens/deals/DealFormSheet.tsx:186`
  - `app/src/screens/tracker/TaskForm.tsx:334`
  - `app/src/screens/tracker/TaskEditControl.tsx:503`
  - `app/src/components/tasks/CompletedTaskForm.tsx:293`
  - `app/src/screens/calendar/EventForm.tsx:374`
- Modify: `app/src/pwa/pwa-config.ts` (`globIgnores: ['assets/FormattedTextEditor-*.js']`, plus its test), `DESIGN.md` (the two component rows)

**Interfaces:**

- Consumes: Tasks 10 and 11; `form.field(name)` props (`ref`, `onBlur`, `aria-invalid`, `aria-describedby`); `visibleLength`.
- Produces: `FormattedTextField(props: { id: string; name: string; value: string; onChange: (markdown: string) => void; required?: boolean; ref?: Ref<HTMLElement>; onBlur?: () => void; 'aria-invalid'?: boolean; 'aria-describedby'?: string })`.
  - It lazy-loads `FormattedTextEditor` with `React.lazy`. The Suspense fallback is a read-only `Textarea` showing `value`.
  - The editable element is `role="textbox" aria-multiline="true"`, labelled by the `<label htmlFor={id}>` (it carries `id`).
  - Under the field: `{visibleLength(value)} / 2000 caractere`.
  - It calls `onChange(editor.getMarkdown())` only after a transaction with `docChanged`, so **an untouched field keeps the original string**.
  - It shows `FormattedTextKeyboardBar` when `useCoarsePointer()`, else `FormattedTextToolbar`.

- [ ] **Step 1: Write the failing tests.**
  - With a legacy value `* unu\n* doi\n5*3*2`, mounting and blurring without typing never calls `onChange`. The form's submitted value equals the original (Review Focus 1).
  - Typing one character calls `onChange` with Markdown.
  - The counter shows `2 / 2000 caractere` for `**ab**`.
  - With coarse pointer mocked, the keyboard bar renders and the top toolbar doesn't, and the other way round.
  - In each form's existing test, the field is found by its label and a `body_too_long` / `description_too_long` server reason lands under it.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement the field and swap the six `Textarea`s.**
  - Keep each site's `id`, `name` and `form.field(...)` spread.
  - Add the `globIgnores` entry, checked against the real chunk name after `npm --prefix app run build`.
  - Add the DESIGN.md rows from the spec's §E.
- [ ] **Step 4: Run the full vitest and see it pass.**
- [ ] **Step 5: Check it in the browser.**
  - Use the DB-less harness (memory `project-dbless-browser-harness`) to see the field in a FormSheet at 375 px (mobile preset) and 1280 px, in light and dark.
  - `read_console_messages` shows no CSP or React errors.
  - Take one screenshot of each toolbar.
  - Delete the harness files.
- [ ] **Step 6: Commit.** `feat(app): FormattedTextField at the six Formatted Text fields (R60)`.

### Task 13: Docs, gates, PR 3

- [ ] Add a status line to `CLAUDE.md` (R60 built).
- [ ] Run `npm run check:root` and the app gates. Record in the PR body the editor chunk's raw and gzip size (expect about 0.5 MB raw, about 145 KB gzip) and the precache total (expect it **unchanged** apart from the reader, because of `globIgnores`).
- [ ] Open the PR (`Closes #1092`) and post the preview-deploy URL. **Alex checks Review Focus 4 on his iPhone** (B and I keep the keyboard, Aa swaps it, tapping the text brings it back), and on a laptop.
- [ ] Review, merge on green after his check, check staging.

## Not in this plan (R60 §Later)

- Checklists, and an Executor ticking a Task's steps.
- @mentions.
- `mailto:` and `tel:` links.
- Formatting for a Cerere's description or the Submission Note.
- Images in text.
- A second typeface.

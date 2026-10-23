# Formatted Text — stripper follow-up (issue draft, ruling R60)

Created on 2026-10-24 after Alex's go-ahead as #1109; the body below is the draft as reviewed. Found in the final review of the editor (PR #1105, issue #1092) and parked there as a follow-up. Each "today" output below was measured on 2026-10-23 with `toPlainText`, whose output is identical to `private.formatted_text_plain` by the parity test, and with the reader's `lexFormattedText` and the editor's `serializeFormattedText`.

---

**Title:** Formatted Text: plain words match the reader for escapes, nested quotes and items that open on a new line (R60 follow-up)

**Labels:** `backend`, `database`, `frontend`, `shared`

### Goal

The plain words of a Formatted Text, from `private.formatted_text_plain` and its twin `toPlainText`, show the same words the reader shows, in four cases where they still don't. These words are what a Notification, a push and the Email Digest carry, and what the "N / 2000 caractere" counter and the 2000-character limit count.

### Why

The stripper was written with the reader (PR #1094). Since then the editor (PR #1105) writes four shapes that the reader reads correctly and the stripper does not. Each shape also appears in legacy text and in pastes.

1. **A backslash escape outside the stripper's short list.**
   - The editor writes `\<` before a line that would otherwise open an HTML block. When a marker sits inside an `ftp://` address, it writes `ftp\:`.
   - The reader, like CommonMark, unescapes every ASCII punctuation character. The stripper unescapes only ``\ ` * _ { } [ ] ( ) # + . ! ~ = > | -``.
   - So the Notification shows the backslash, and the counter counts it.
2. **A quote inside a quote.** Typing `> ` inside a Citat nests one. The editor writes `> > q`, the reader shows `q`, and the stripper keeps one `>`.
3. **A quote that opens a list item.** The reader shows `• q`; the stripper keeps the `>`.
4. **A list item whose first line is empty.**
   - The editor writes a list item that opens with a quote or a nested list as a bare marker, with its content on the next, indented line: `-\n  - a`, `-\n  > q`, `1.\n   > q`.
   - The reader shows the content on the bullet's line. The stripper leaves the bare `-` (or `1.`) as typed.
   - Legacy `- - a` and `* * a` (a nested list on the same line) read as `• • a`, but the stripper bullets only the first marker.

These cases are rare and change only words and counts, never stored text. That is why they were parked rather than blocking PR #1105.

### Measured

Measured on 2026-10-23. A `\n` inside a code span is a line break, as in the fixture file's `E''` strings.

| Case                                  | Formatted Text                                                       | The reader shows                                        | The stripper gives today        | Expected                |
| ------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------- | ----------------------- |
| escaped `<` (editor)                  | `\<div>Sala</div> la 18`                                             | `<div>Sala</div> la 18`                                 | `\<div>Sala</div> la 18`        | `<div>Sala</div> la 18` |
| escaped `<` before a comment (editor) | `\<!-- notă --> joi`                                                 | `<!-- notă --> joi`                                     | `\<!-- notă --> joi`            | `<!-- notă --> joi`     |
| escaped `:` (editor)                  | `vezi ftp\://x.ro/*a*/b`                                             | `vezi ftp://x.ro/a/b`                                   | `vezi ftp\://x.ro/a/b`          | `vezi ftp://x.ro/a/b`   |
| other ASCII escapes                   | `a \$ x \: x \< x \" x \@ x \? x \& x \% x \, x \; x \/ x \^ x \' x` | `a $ x : x < x " x @ x ? x & x % x , x ; x / x ^ x ' x` | unchanged, every backslash kept | as the reader shows     |
| quote in a quote (editor)             | `> > citat în citat`                                                 | `citat în citat`                                        | `> citat în citat`              | `citat în citat`        |
| three deep                            | `> > > trei`                                                         | `trei`                                                  | `> > trei`                      | `trei`                  |
| no space between                      | `>> q`                                                               | `q`                                                     | `> q`                           | `q`                     |
| quote opens an item                   | `- > q`                                                              | `• q`                                                   | `• > q`                         | `• q`                   |
| quote opens a numbered item           | `1. > q`                                                             | `1. q`                                                  | `1. > q`                        | `1. q`                  |
| item opens on the next line (editor)  | `-\n  - a`                                                           | `• • a`                                                 | `-\n  • a`                      | `• • a`                 |
| quote on the next line (editor)       | `-\n  > q`                                                           | `• q`                                                   | `-\nq`                          | `• q`                   |
| numbered, next line (editor)          | `1.\n   > q`                                                         | `1. q`                                                  | `1.\nq`                         | `1. q`                  |
| words on the next line                | `-\n  a`                                                             | `• a`                                                   | `-\n  a`                        | `• a`                   |
| nested list on the same line          | `- - a`                                                              | `• • a`                                                 | `• - a`                         | `• • a`                 |
| the same with stars                   | `* * a`                                                              | `• • a`                                                 | `• * a`                         | `• • a`                 |

### What to build

- **One new migration**, dated after `main`'s newest. On 2026-10-23 that is `20261023160000_bce_read_attendance.sql`.
  - It does a `create or replace` of `private.formatted_text_plain`, rebuilt from its latest body in `20261020213926_formatted_text.sql`.
  - It keeps `immutable`, `parallel safe` and `set search_path = ''`, and it ends with the same `revoke`.
  - The roster row in `supabase/tests/tracker_grants.test.sql` is unchanged, since there is no new function.
- **`toPlainText`** (`app/src/lib/formatted-text/plain.ts`) changes step for step with it, in the same commit, as its header requires.
- **The chain gains or changes these steps.** The order matters: the bare-marker join comes first, so a quote it brings onto the marker's line is stripped by the next step.
  1. **Join a bare item marker** (a line holding only `-`, `*`, `+`, or `1.`–`999999999.` / `)`, with optional spaces) with the next line when that line is indented. The join keeps the marker for the list step. This is CommonMark's "item that begins with a blank line". A bare `-` under a line of text is a setext underline, which the dialect shows as typed, and it is not joined: it has no indented next line.
  2. **Strip every quote marker at a line start, and after a list marker:** `> > q`, `>> q`, `- > q`, `1. > q`. A `>` after a heading marker (`# > x`) stays, as the fixture `heading holding a quote mark` pins.
  3. **Bullet every marker in a run at a line start:** `- - a` gives `• • a`. A numbered item still keeps its number.
  4. **Unescape every ASCII punctuation character**, ``!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~``, still last, so an escape still keeps a line-start marker or a single-marker opener literal where an earlier step refuses it.
- Each step must stay linear on a 4000-character text: no backtracking that a run of `>` or `-` can blow up. A loop in PL/pgSQL is fine if the twin does the same.

### Implementation boundary

- No stored text changes, and there is no data migration.
- `private.require_formatted_text_length`, `private.notify_announcement` and `private.event_announcement_body` keep calling the stripper unchanged.
- A visible length can only shrink (more characters unescaped, more markers stripped), so no stored row starts breaking the 2000 limit.
- Not in scope:
  - An escaped Text Link bracket, `\[x](https://a.b)`. The stripper gives `\x` while the reader shows the text as typed. This is documented in the function's comment as accepted.
  - A quote inside a list inside a quote, three levels on one line (`> - > q`).

### Acceptance criteria

- Every row of the Measured table is a fixture line in `supabase/tests/formatted_text_plain.test.sql`, and `formatted_text_plain` gives the Expected column.
- `app/src/lib/formatted-text/plain.test.ts` replays the file and `toPlainText` agrees on every line.
- Every existing fixture keeps its expected value. That includes `escapes`, `html stays text` (`<b>html</b>`), `quoted heading` and `heading holding a quote mark`.
- Publishing an Anunț whose body is `> > Ședința` notifies with the body `Ședința`.
- The editor's property test (`app/src/components/formatted-text/editor/markdown.property.test.ts`) still passes. Its "no backslash of its own" check now also holds for `\<` and `\:`. Tighten it if it allowed them.
- A 4000-character run of `>`, of `- `, and of `\\` each strips within the existing performance fixture's bound, or within 50 ms if there is none.

### Required tests

- `supabase/tests/formatted_text_plain.test.sql`, with the new fixture lines and the plan count raised.
- `supabase/tests/formatted_text_notifications.test.sql`, for the nested-quote Notification.
- `app/src/lib/formatted-text/plain.test.ts`, the parity replay; it needs no change beyond the fixtures.
- `npx supabase db reset && npx supabase test db`, and the app's vitest for `src/lib/formatted-text` and `src/components/formatted-text`.

### Blocked by

None — can start immediately. It touches no file that PR #1105 changes. The editor-written cases appear once #1105 merges, but legacy text and pastes reach every row today.

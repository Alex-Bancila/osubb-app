---
name: OSUBB App
description: The internal app of OSUBB — tasks, calendar, announcements and member management, on a phone first.
colors:
  brand-red: "#ED2025"
  red-600: "#D11620"
  red-700: "#A8101A"
  ink-900: "#0B0B0C"
  ink-500: "#5C5C61"
  ink-400: "#8A8A90"
  ink-200: "#E4E4E7"
  ink-100: "#F4F4F6"
  ink-050: "#FAFAFB"
  white: "#FFFFFF"
  dark-surface: "#17171b"
  dark-background: "#0e0e11"
  dark-surface-3: "#1f1f24"
  dark-border: "#2f2f36"
  dark-text: "#ECECEF"
  dark-text-muted: "#A7A7AF"
  success: "#007F33"
  warning: "#F2A700"
  info: "#284C93"
  dept-edu: "#284C93"
  dept-hr: "#F2A700"
  dept-fin: "#007F33"
  dept-pr: "#7500A0"
  dept-youth: "#FF3B3B"
typography:
  page-title:
    fontFamily: "Montserrat Variable, Montserrat, Segoe UI, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  page-title-wide:
    fontFamily: "Montserrat Variable, Montserrat, Segoe UI, system-ui, sans-serif"
    fontSize: "31px"
    fontWeight: 800
    letterSpacing: "-0.02em"
  sheet-title:
    fontFamily: "Montserrat Variable, Montserrat, Segoe UI, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 700
  body:
    fontFamily: "Montserrat Variable, Montserrat, Segoe UI, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
  control:
    fontFamily: "Montserrat Variable, Montserrat, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
  caption:
    fontFamily: "Montserrat Variable, Montserrat, Segoe UI, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 500
rounded:
  xs: "6px"
  sm: "9px"
  md: "13px"
  lg: "18px"
  xl: "24px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "7": "32px"
components:
  button-primary:
    backgroundColor: "{colors.brand-red}"
    textColor: "{colors.white}"
    rounded: "{rounded.lg}"
    height: "44px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.red-600}"
  button-outline:
    backgroundColor: "{colors.ink-050}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.lg}"
    height: "44px"
  field:
    backgroundColor: "{colors.ink-050}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.lg}"
    height: "44px"
    padding: "0 16px"
  card:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "16px"
  fab:
    backgroundColor: "{colors.brand-red}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    size: "56px"
---

# OSUBB App — design language

The tokens above are extracted from `app/src/theme/tokens.css` and
`app/src/theme/tailwind.css`, which stay the source of truth for values. This
file is the source of truth for **how they are used**. Written 2026-10-10 from
the app as built on `feat/create-fab`; it is binding on new frontend work.

## Overview

A tool people open on a phone between classes to see what is theirs to do, and
that leadership uses to run the organisation. The interface gets out of the
way: one red, a neutral ramp, one typeface, and the same few parts everywhere.
A member should never have to learn a screen twice.

Eight rules carry the whole language:

1. **Four surfaces, each with one job.** A _page_ is a list or a place. A
   _sheet_ reads or edits one thing: a panel from the right on a desktop,
   rising from the bottom on a phone. A _dialog_ confirms or asks for a reason
   — three fields at most, or one like field per copy (the Executors of n
   Tasks). A _pop-over_ is a menu or a hint.
2. **One filled button per surface.** Red is the primary action, the plus
   button, and "needs you" signals (unread, overdue). Everything else is
   outline or ghost. Destructive actions come last and are never filled.
3. **The row is the action.** Tapping a row or card opens it. Creating is the
   page's plus button. Anything else is behind "⋯".
4. **Headers hold a title and icons.** No eyebrows, no taglines, no intro
   paragraphs. Filter and view switches are icons on the title's row; a count
   sits beside the title as a badge.
5. **One field, one form.** Inputs, selects and pickers share one surface,
   height and radius. Only optional fields are marked. Two or three choices
   are a segmented control. The primary button is always in view.
6. **Explain once, quietly.** A sentence a field needs once sits behind an "i"
   pop-over. What a member must read before acting stays on the page.
7. **Dates are short and Romanian.** "mie., 14 oct. · 23:59"; the year only
   when it is not this one; "ora României" only where a time is typed.
8. **One icon set, calm motion.** Lucide only; no emoji as icons. Motion shows
   a change of state and nothing else.

## Colors

- **Brand red `#ED2025`** is spent on three things only: the one primary
  action of a surface (and the plus button), the active item in navigation,
  and signals that something needs the viewer (unread dot, overdue deadline,
  pending count). It is not decoration, not a heading colour, not a border.
- **Neutrals** do the rest: page `--surface-2`, cards and sheets `--surface`,
  tracks and chips `--surface-3`, text `--text` / `--text-muted`. The dark
  theme inverts the ramp and keeps the red; build and check both.
- **Group colours** (the Brand Book's department accents) appear as an 8–12 px
  dot beside a Group's name and as a card's thin leading edge — never as a
  fill, a text colour, or a button.
- **Feedback** colours (success, warning, info) are for receipts and states,
  as text or a soft tint, never as a second accent.

## Typography

Montserrat throughout, bundled locally. Weight carries hierarchy more than
size: 800 for the page title, 700 for a card or sheet title, 600 for names in
rows, 500 for controls, 400 for prose. Page title 24 px (31 px from 768 px);
body 14.5 px; captions 11.5 px. Numbers that are compared (points, ranks,
dates in a column) use tabular figures. Uppercase micro-labels are not used.

## Layout

- **Phone first.** The first screen of a page is content: the header is one
  row (title, then icon controls), then at most one row of tabs or a toolbar.
- **Page frame** (`Page`): 16 px gutters under 768 px, 24 px from there;
  content width 1240 px, or 768 px for a reading page. Blocks stack 24 px
  apart; a page never sets its own padding or max width.
- **Navigation.** On a phone: a capsule floating over the foot of the page
  with four places — Acasă, Taskuri, Calendar, Anunțuri — and Mai mult, all
  icons. A tinted thumb slides to the current one. Mai mult opens a drawer
  from the foot of the screen with every other page (Grupuri, and what the
  member's capabilities add), and carries their counts; on one of those
  pages the thumb stands on Mai mult. A member with only one other page
  (Grupuri, for a volunteer) has that page as the fifth place, and no Mai
  mult. Notificări and Profil are in the top bar. There is no hamburger, and
  no second list of pages on Acasă. From 1024 px: the sidebar lists every
  page.
- **A page's own sections** (Taskuri's lists and Cereri) are one segmented
  nav of the same kind: the selected one spells its name, the rest are icons
  on a phone. A page never stacks two navigations.
- **Toolbars.** Search fills the row; the Grupuri preferate star and Filtrează
  are icon buttons at its end. Without a search they sit on the header's
  row. A toolbar keeps its place across a page's tabs and while a list loads.
- **Touch targets** are 44 px. A control may look smaller; its hit area may not.
- **The plus button** is the page's create action. On a phone it stands
  beside the tab bar, a rounded square as tall as the bar, and is there only
  on a page where the member can create something. The bar is centred
  with the button's room kept on both sides, so it never moves. From 1024 px it is round,
  in the content area's bottom-right corner. One create action: the plus is
  that action. Several: it opens them, the first nearest the thumb. A page
  ends with room to scroll clear of it.

## Elevation & Depth

Flat by default: surfaces are told apart by tone and a 1 px border, not by
shadow. Shadow is reserved for things that float over the page — the plus
button, menus, pop-overs, sheets — and always has an offset and a soft blur.
A sheet or dialog dims the page behind it; a pop-over does not.

## Shapes

- Controls (buttons, fields, the segmented control's track): 18 px radius, 44 px tall.
- Cards, panels and list boxes: 13 px radius, 16 px padding, 1 px border.
- Chips, badges, avatars, the plus button: fully round.
- A sheet rising from the bottom has rounded top corners (`rounded-t-2xl`).
- Cards are not nested. A sheet shows an item's content directly, never a card
  inside the sheet.

## Components

Each lives once in `app/src/components` and is used everywhere; a screen does
not restyle one.

| Need                          | Component                                                                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page header                   | `PageHeader`                                                                    | Title, optional badge, actions on the title's row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| View switch on a page         | `SegmentedToggle`                                                               | `compact` shows icons alone under 640 px.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Routed or in-page tabs        | `PageTabs`, or `tabListClass` + `tabClass` + `tabThumbClass` on Base UI `Tabs`  | The one tab look: a pill track with a sliding thumb. Tabs never shrink or truncate: when they do not fit, the track scrolls sideways with no scrollbar and the current tab is brought into view. The phone bar is five icons and always fits; `tabLabelsFrom` still collapses the other tabs to icons on narrow screens before the track scrolls. On a touch screen a sideways swipe over a tab's panel opens the neighbouring tab, exactly as a tap would (`useSwipeTabs` on the element holding the panels); a swipe that starts in a field or on something that scrolls sideways belongs to that thing. |
| Create                        | `FabActions` + `FabAction`                                                      | Outside a `FabActions`, a `FabAction` is a labelled button.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Secondary actions             | `ActionMenu`                                                                    | "⋯"; destructive items last.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Filter                        | `WorkFilter` / `FilterToolbar`                                                  | Opens a bottom sheet on a phone; active filters are chips.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Create or edit form           | `FormSheet` + `FormSheetFooter`                                                 | Title only; pinned footer, secondary then primary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Read one item                 | `Sheet` (`side="right"`, or `"bottom"` for a short one such as the Member Card) | Titled by the item; facts as icon + label/value rows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Confirm / give a reason       | `Dialog`                                                                        | Three fields at most.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Text field                    | `Input`, `Textarea`                                                             | One field surface (`fieldControlClass`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Short fixed list              | `Select`                                                                        | Four options or more. The app's own pop-over list, never the browser's or the phone's picker.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Searchable list               | `Combobox`                                                                      | Members, Groups.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Two or three options          | `SegmentedRadio`                                                                | Radio semantics, segmented look.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Date, date and time           | `DatePicker`, `DateTimePicker`                                                  | Never a native date input.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A colour                      | `ColorPicker`                                                                   | OSUBB swatches or any colour (pad, hue, hex code).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A field's one-off explanation | `InfoHint`                                                                      | Pop-over; the text still describes the field.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Show / hide more              | `Disclosure`                                                                    | Chevron that turns.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A list that changes           | `AnimatedList`                                                                  | One column; rows fade in and close their gap on leaving.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Loading                       | `Loading`                                                                       | Skeleton rows; the label is for screen readers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Nothing here                  | `EmptyState`                                                                    | Only for a page's main list; a secondary section with nothing to show is not drawn.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Rows.** A Task is one row everywhere it is listed (`TaskRow`), in one
column: its title across the row, then one meta line in a fixed order — Group
chip, status, deadline, Executor, points at the line's end. Where the member
acts on it, one line of description follows and the action sits at the row's
end (under it on a phone). The whole row is the tap target; nested controls
sit above that target. A list of rows that can change under the member is an
`AnimatedList`.

**Motion.** Motion shows a change of state and nothing else; every move is
150–250 ms and off under `prefers-reduced-motion`.

- _A selection slides._ Every pill track — tabs, view switches, a form's
  two-or-three choice — inks its selection with one thumb that slides to it
  (`SlidingThumb`); none jumps.
- _Content arrives._ A tab's panel, a page behind the shell and a list after
  its skeleton fade up 6 px (`motion-enter`, or `useEnterMotion` where the
  element is not remounted).
- _A row leaves._ In an `AnimatedList` a row that has gone fades and closes
  its gap instead of snapping.
- _One hover._ A card, row or tile that is itself the action is `pressable`:
  one tint under the pointer, and a small give when pressed.
- _A changed number pops._ A badge or count that changes — never one that has
  just loaded — gives one small pop (`usePopMotion`).

**Forms.** Labels sit above fields. Required is the default and unmarked;
optional fields say "(opțional)". Errors appear under the field, in Romanian,
and name the fix. Sections are separated by space, not boxes.

**Receipts.** After a command succeeds, one sentence says what happened. A
receipt that only confirms ("Anunțul a fost publicat.") is a `Toast`: it
floats above the tab bar for four seconds and takes no place on the page. A
receipt the member must still be able to read, or that names what to do
next, stays on the page in the success colour and takes focus.

## Do's and Don'ts

**Do**

- Put the thing people came for in the first screen.
- Use the component from the table; extend it there if it falls short.
- Keep every accessible name when a label becomes an icon (`aria-label`, or
  visually hidden text).
- Check a change at 390 px and at desktop width, in both themes.
- Write copy in Romanian with diacritics, in the organisation's own words
  (`CONTEXT.md`).

**Don't**

- Add an eyebrow, a tagline, or an intro paragraph above content.
- Put more than one filled button on a surface, or fill a destructive one.
- Line up several text buttons on a row or a card — the row is the action,
  the rest is a menu.
- Use a dialog for a form, or a full-screen surface for three filter fields.
- Use a native date input, a native drop-down, a radio card, or a two-option select.
- Use red, a Group colour, or an emoji as decoration.
- Repeat a page's title as a section heading under it.
- Print "miercuri, 14 octombrie 2026, 23:59 (ora României)" on a card.

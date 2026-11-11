# The Voluntar Activ message — design

- **Date:** 2026-11-10
- **Decided in:** the design session of 2026-11-10 (ruling R66), at the request of Ioana (BC)
- **Status:** approved 2026-11-10 ("you can start the implementation"); built 2026-11-11.
- **Amends:** ADR-0004 where it says promotion to Voluntar Activ offers the adherence form; rulings R20 and R28 where they put the adherence form's address in `org_settings` and in the promotion Notification; `CONTEXT.md` §Governance (**AG Eligibility**, **Portofoliu Interne**, and the new **Adherence Message**), §Task Tracker (**Formatted Text**) and §Term → identifier.

## The request

> "ioana wants to be able to send a message to everybody that becomes "voluntar activ" and is a BBU student. The page should appear here [Administrare → Portofoliu Interne]. There ioana or any BC member should be able to enter a custom message that will appear as a pop-up on every page until it is read, the message should also include a link, that's the link for "aderarea la adunarea generala"."

Why: AG Eligibility belongs to a Voluntar Activ who studies at UBB, and only they can be granted Drept de Vot (R58). Today the adherence form's address goes, in a fixed sentence, to **every** Member promoted to Voluntar Activ, UBB student or not, inside a Notification that is easy to miss. BC wants to say it in its own words, to the right people only, in a way they cannot miss.

## Decisions (ruling R66)

Each point is an answer given in the session, in the order given.

1. **Who sees it: every eligible Member now, and every Member who becomes eligible later.** Eligible means an active Member whose Role is Voluntar Activ (`activ`) and whose Universitate is Universitatea Babeș-Bolyai. On day one that is every such Member who has not read it (30 of the 36 Voluntari Activi in production on 2026-11-10; no Voluntar Activ has an unknown Universitate). A Member becomes eligible by promotion to Voluntar Activ or by BC recording their Universitate as UBB, and then sees it.
2. **The link leaves Administrare → Setări.** The "Formular de adeziune" row goes; the link is entered only with the message, on Portofoliu Interne.
3. **The promotion Notification stays, without the link and without the sentence about the Adunarea Generală.** A Member promoted to Voluntar Activ still gets "Rol actualizat", now reading only `Rolul tău în OSUBB este acum Voluntar Activ.` (plus the existing groups-left sentence when it applies), whatever their Universitate. The link reaches nobody but through the message.
4. **It is answered, not merely seen.** The message blocks the app until the Member taps **Am citit**: no close button, no "Mai târziu", Escape and a tap outside do nothing, and nothing behind it can be reached (2026-11-10, replacing the session's earlier "not must-read" answer).
5. **Its look: a window over the app** (design 5 of the prototypes): the message in the app's dialog, centred, the app dimmed and unreachable behind it — not a full screen like the Privacy Notice.
6. **After "Am citit", Profil keeps it:** the message and its link appear on Profil, under the Member's Role.
7. **The assumptions stand:** a fourth view on Portofoliu Interne; any BC member or the Moderator writes it (`manageRoles`, as the rest of the page); an empty message means no pop-up for anyone.
8. **An edit after Members have read it: BC chooses each time.** Saving offers two actions: **Salvează** (a correction: readers are not asked again and see the new text on Profil) and **Salvează și arată din nou** (everyone eligible gets the pop-up again).
9. **BC writes the heading and the link's label** as well as the message.
10. **The message is Formatted Text**, like an Announcement body (R60): Titlu, Subtitlu, Citat, bold, italic, strikethrough, highlight, lists and http(s) Text Links, at most 2000 visible characters. The heading and the link's label stay plain text. This extends R60's list of Formatted Text fields by one.

## Names

- Glossary term: **Adherence Message** (Mesajul pentru Voluntarii Activi). The view's label is **Mesaj**. Copy never calls it an Announcement or a Notification: it is neither (it has no Group, no Audience, no Fan-out, and lives in no list).
- **Am citit** answers it. "Citit" in BC's counts means answered.

## What exists (main at 636d2bf2)

| Piece                    | Today                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The link                 | `org_settings` key `adherence_form_url` (http(s), ≤2048, `org_settings_adherence_form_url_ck`, seeded in `20260924053559_org_settings.sql`); written by `public.set_org_setting`, whose body `private.set_org_setting_impl` (latest in `20261018170000_portofoliu_interne.sql`, with the latest table and function comments) carries an `adherence_form_url` branch; read by `private.apply_member_role`. |
| The Notification         | `private.apply_member_role`, created once in `20260929110000_bc_rank_authority.sql` (`20260929190000_bc_provision_status.sql` only re-comments it): for `p_role = 'activ'` it appends the AG Eligibility sentence and either `Completează formularul de adeziune: <url>` or `Formularul de adeziune îl primești de la BC.`                                                                                |
| Other readers of the key | `scripts/check-seed-rerunnable.sh`; pgTAP `org_settings`, `member_commands`, `promotion_candidates`, `role_evaluation_command`, `evaluation_percent_command`, `role_history_audit`; vitest `lib/schemas/org-settings.test.ts`, `queries/groups-admin.test.ts`, `screens/administrare/AdminSettingsTab.test.tsx`.                                                                                          |
| Portofoliu commands      | `set_eligibility_floor` and its siblings (`20261018150000_evaluation_settings.sql`): `private.require_active_member()` then `private.actor_level(actor) >= 6`, every refusal `42501 evaluation_settings_manage_forbidden`, the one row `for no key update`. No Profile lock.                                                                                                                              |
| Member Deletion (R59)    | `private.member_deletion_goes` / `private.member_deletion_holds` (`20261020205141_member_deletion.sql`): every foreign key into `profiles` holds an account unless its column is on the account's own list; the browser names each kind in `screens/administrare/member-delete-text.ts`.                                                                                                                  |
| Setări                   | `AdminSettingsTab.tsx`, panel **Promovări și evaluări**: the `ADHERENCE_FORM` row (`AdherenceFormValue`, `AdherenceFormEditor`, `adherenceFormSchema`), then the Adunarea Generală Group row.                                                                                                                                                                                                             |
| Portofoliu Interne       | `PortofoliuInterneScreen.tsx`: a `SegmentedRadio` of three views kept in `?vedere=` (`portofoliu-view.ts`).                                                                                                                                                                                                                                                                                               |
| A must-answer step       | `PrivacyGate` (full screen, after sign-in, once per Notice version).                                                                                                                                                                                                                                                                                                                                      |
| Formatted Text           | `private.require_formatted_text_length(field, value)` (PT400 `<field>_too_long`), `private.formatted_text_plain`; the reader `components/formatted-text/FormattedText.tsx`, the editor field `FormattedTextField.tsx`, the browser schemas in `lib/schemas/text.ts`.                                                                                                                                      |
| UBB                      | `private.ubb_university()` returns the canonical `Universitatea Babeș-Bolyai`.                                                                                                                                                                                                                                                                                                                            |

## Design

### A. The server

**One row for the message**, `public.adherence_message` (`id smallint primary key check (id = 1)`), seeded by the migration:

| Column                                      | Meaning                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `title text`                                | The heading, plain, trimmed, 1–120 characters; null while there is no message.                                               |
| `body text`                                 | Formatted Text, ≤4000 stored and ≤2000 visible (`require_formatted_text_length('body', …)`); null while there is no message. |
| `link_url text`                             | http(s) only, ≤2048; null for no link.                                                                                       |
| `link_label text`                           | Plain, trimmed, 1–60 characters; required when `link_url` is set, null otherwise.                                            |
| `version integer not null default 0`        | Moves only when BC asks everyone again (and on the first save).                                                              |
| `updated_by uuid`, `updated_at timestamptz` | Who saved it last, when.                                                                                                     |

- **A message exists** when `body` is set. Title and body go together: a body without a title is `PT400 title_required`, a title without a body `PT400 body_required`, and both blank **turns the message off** (title and body null): nobody sees a pop-up and Profil shows nothing. The link and its label are stored as sent either way, so turning the message off never loses the form's address. `version` is kept, so a message written later counts from it.
- **Read by** BC and the Moderator in full (policy `adherence_message_read`: claims and live level ≥ 6). A Member reads it only through the one read below, never the table.
- **The day-one row** carries no title or body (no pop-up until Ioana writes one) and, as `link_url`, today's `org_settings.adherence_form_url` with the label `Deschide formularul de adeziune` when that value is set. The `org_settings` row, its check constraint and `set_org_setting_impl`'s `adherence_form_url` branch are then dropped (the body restated from `20261018170000_portofoliu_interne.sql`, the branch removed; the table and function comments restated without the key). `set_org_setting('adherence_form_url', …)` then answers `PT404 org_setting_not_found`, as any unknown key.

**The answers**, `public.adherence_message_reads` (`member_id uuid primary key references profiles on delete cascade`, `version integer not null`, `read_at timestamptz not null`): the latest version each Member answered. One row per Member, overwritten by each answer. RLS: a Member reads their own row (claims and a live `activ` Profile), BC and the Moderator read every row; nobody writes it directly.

**Who is eligible**, one helper used by every read and command: `private.adherence_message_eligible(p_member uuid)` — the Profile is `status = 'activ'`, `role = 'activ'` and `university = private.ubb_university()`.

**The Member's read**, `public.my_adherence_message()` (invoker wrapper over a definer body): for an eligible caller with a message, one row `title, body, link_url, link_label, version, answered boolean` where `answered` is `coalesce(read.version, 0) >= message.version`; otherwise no row (a claimless or deactivated session included). The pop-up shows while `answered` is false; Profil shows the message once it is true. So a Member who becomes eligible later meets the current version unanswered, and a quiet save (decision 8) leaves `answered` true.

**The answer**, `public.answer_adherence_message(p_version integer)`: upserts the caller's row with `p_version` and now. `42501 adherence_message_answer_forbidden` without claims or a live `activ` Profile; then, the message row held `for share` (so it serialises behind a save), `PT404 adherence_message_not_found` for a caller not eligible or when no message exists (one reason for both, conventions §3: a caller never learns which), and `PT409 adherence_message_changed` when `p_version` is not the current version, a null one included (BC asked again while the pop-up was open: the client re-reads and shows the new text). Answering the same version twice is accepted and only moves `read_at`.

**BC's command**, `public.set_adherence_message(p_title text, p_body text, p_link_url text, p_link_label text, p_ask_again boolean)`, shaped like `set_eligibility_floor`:

1. Trims each text (blank → null) and judges what is malformed for every caller, reusing the existing reasons: `title_required` / `body_required` (above), `title_too_long` (120, `private.require_text_length`), `body_too_long` (`private.require_formatted_text_length`: 4000 stored, 2000 visible), and the Attached Link rule `private.require_attached_link(label, url)`: `link_incomplete`, `link_label_too_long` (60), `link_url_too_long` (2048), `link_url_invalid`.
2. `private.require_active_member()` and `private.actor_level(actor) >= 6`, every refusal `42501 adherence_message_manage_forbidden`.
3. The row `for no key update`.
4. `PT409 nothing_to_update` when all four values are unchanged and no new version is due.
5. Writes them with `updated_by`. `version` becomes `version + 1` when the result has a message and either `p_ask_again` is true or the row had none before (the first message, or one written after turning it off), so a new message always reaches everyone eligible; otherwise it stays. Returns the row.

**BC's counts**, `public.adherence_message_status()` (invoker wrapper over a definer body; a row only for live level ≥ 6): `eligible_count` and `answered_count` (eligible Members whose read version ≥ the current version; 0 while there is no message). The view shows them; no list of names.

**The Notification** (decision 3): `private.apply_member_role` restated from `20260929110000_bc_rank_authority.sql` without the `activ` branch and without the `org_settings` read (the latest comment, from `20260929190000_bc_provision_status.sql`, restated): `activ` falls through to `Rolul tău în OSUBB este acum <Role name>.` The `vot` text is unchanged.

**Member Deletion (R59):** an answer is the account's own, like `announcement_reads`: `adherence_message_reads` joins `private.member_deletion_goes` and the exclusion list of `private.member_deletion_holds`, and the Ștergere panel names it (`confirmarea mesajului pentru Voluntarii Activi`). `adherence_message.updated_by` holds the account, as every actor column does, under the Portofoliu Interne kind of `member-delete-text.ts`.

**Live changes** (ADR-0011): both tables carry the `broadcast_change` trigger, as `announcement_reads` does. A save re-reads `my_adherence_message()` in every open app; an answer closes the pop-up on the Member's other devices and moves BC's counts. The signal names the table only.

### B. The pop-up

- `AdherenceMessageGate`, mounted in `AppShell` (so it is inside `PrivacyGate`: the Privacy Notice is always answered first) and rendered over every page. It reads `my_adherence_message()`; while the row exists and `answered` is false it shows the app's `Dialog`, modal, with `showCloseButton={false}`, ignoring every request to close (Escape, a tap outside), with: the heading (`DialogTitle`), the body through `FormattedText`, the link as a primary button that opens `link_url` in a new tab (`target="_blank" rel="noopener noreferrer"`) with `link_label` and the external-link icon, and **Am citit** (outline). Opening the link does not answer it.
- **Am citit** calls `answer_adherence_message(version)`; while it runs the button shows it is busy; on success the dialog closes and Profil's panel appears; on `adherence_message_changed` the gate re-reads and shows the new text; any other failure shows its reason in the dialog (`role="alert"`) and the dialog stays.
- If the read fails, nothing is shown (the gate never blocks a Member on an error of its own); it retries with the query's normal retry.
- The prototype's two chips (`Voluntar Activ`, `Student UBB`) above the body are kept: they tell the Member why they received it.

### C. Profil

- Once answered, a panel titled with the message's heading sits under the identity block (name, Role chip, since when), above the tabs, holding the body (`FormattedText`) and the link button (outline once answered). It shows only while the Member is still eligible and a message exists; it disappears when either stops (becoming Voluntar cu Drept de Vot, a Universitate away from UBB, BC turning the message off).

### D. Administrare → Portofoliu Interne → Mesaj

- A fourth view, **Mesaj**, in the section switch between Adunarea Generală and Setări, kept in the URL as `?vedere=mesaj`.
- The form: **Titlu** (prefilled `Mesaj de la Biroul de Conducere` when empty), **Mesaj** (`FormattedTextField`), **Link** (http(s)), **Textul butonului** (prefilled `Deschide formularul de adeziune` when a link is typed and the label is empty). A line under the switch states who receives it: `Îl văd, ca fereastră care trebuie confirmată, Voluntarii Activi studenți UBB.`
- The counts: `Confirmat de {answered} din {eligible} Voluntari Activi studenți UBB.` (none while there is no message).
- **Previzualizează** opens the same dialog as the gate, closable, for BC to check it.
- Saving: with no message yet, one button **Publică**, which first asks for confirmation naming who will see it (`Toți cei {eligible} Voluntari Activi studenți UBB vor vedea mesajul și vor trebui să-l confirme.`): Enter in a field submits the form, and publishing puts a window that must be answered on everyone's screen (a builder's choice, 2026-11-11). With a message, **Salvează** and **Salvează și arată din nou**; the second asks for confirmation naming the consequence: `Toți cei {eligible} Voluntari Activi studenți UBB vor vedea din nou mesajul și vor trebui să-l confirme.` The form requires both Titlu and Mesaj (the browser schema says `title_required` / `body_required` in the server's words).
- Turning it off: a separate **Oprește mesajul** (shown while a message exists), behind a confirmation `Nimeni nu va mai vedea mesajul, nici în Profil. Linkul rămâne salvat.`; it saves title and body as null and keeps the link and label.
- Mounted behind `manageRoles`, as the page; every command decides again on the server.

### E. Administrare → Setări

- The **Formular de adeziune** row, its value and editor components and `adherenceFormSchema` go. **Promovări și evaluări** keeps the Adunarea Generală Group row and its link to Portofoliu Interne's Setări. `org-settings.ts` loses the key from its union.

### F. Copy (Romanian)

- View: `Mesaj`. Fields: `Titlu`, `Mesaj`, `Link`, `Textul butonului`. Buttons: `Publică`, `Salvează`, `Salvează și arată din nou`, `Oprește mesajul`, `Previzualizează`, `Am citit`.
- Reused reasons keep their copy (`title_required`, `title_too_long`, `body_required`, `body_too_long`, `link_incomplete`, `link_label_too_long`, `link_url_too_long`, `link_url_invalid`, `nothing_to_update`).
- New reasons: `adherence_message_manage_forbidden` → `Doar BC și Moderatorul pot schimba mesajul pentru Voluntarii Activi.`; `adherence_message_answer_forbidden` → `Sesiunea ta nu mai este activă. Conectează-te din nou.`; `adherence_message_not_found` → `Mesajul nu mai este pentru tine.`; `adherence_message_changed` → `Mesajul tocmai a fost actualizat. Citește noua versiune.`
- `invalid_org_setting_value` loses its sentence about addresses (no remaining key is an address).

### G. Tests (same PR)

- pgTAP (`supabase/tests/adherence_message.test.sql`): RLS deny-by-default on both tables and a fixture row for each in the claimless sweep (`rls_deny_by_default.test.sql`); only BC/Moderator write and read the row; every validation reason; a first save and `p_ask_again` move `version`, a quiet save does not; turning off keeps the link and the version, and on again moves it; `my_adherence_message()` returns a row only to an active Voluntar Activ at UBB (not a Voluntar, a voter, a BCE/BC, a non-UBB or unknown Universitate, an inactive Member), with `answered` false until they answer the current version and true after a quiet save; `answer_adherence_message` refuses a stale version and an ineligible caller; the counts; `apply_member_role` to `activ` sends `Rolul tău în OSUBB este acum Voluntar Activ.` with no URL even when a link exists; the `org_settings` row and constraint are gone and `set_org_setting` answers `org_setting_not_found`; the day-one move copies a set `adherence_form_url` (an upgrade harness, as the other key moves had). R59: an answer goes with the account, a save holds it. The grants roster (`tracker_grants.test.sql`) names the new functions; `conventions.test.sql` and `live_changes.test.sql` stay green; the existing suites that set or read the key are rewritten.
- Vitest: the gate (shows, cannot be closed, Am citit answers and closes, stale version re-reads, an error keeps it open, nothing on a failed read, nothing for an ineligible Member); Profil's panel after answering and not before; the Mesaj view (prefills, validation, Publică vs the two saves, the confirmation, the counts, the preview); the Setări row gone; `?vedere=mesaj`.

## Non-goals

- No Notification, push or e-mail about the message itself; the pop-up is the channel.
- No list of who has or has not answered (counts only).
- No history of past messages and no scheduling.
- No message for other Roles or audiences; the eligibility rule is fixed.
- Nothing changes who can be granted Drept de Vot.

## Left to the builder

- Migration and test names, query keys, component file layout, the exact `inert` / focus handling the app's `Dialog` already gives.
- Whether the Mesaj view's form uses the page's existing `SettingRow` pattern or a plain form panel.
- Copy beyond §F, in the app's existing voice.

## Privacy Notice

Recording who answered the message is stored activity, like "Anunțurile pe care le-ai citit". This change does **not** bump the Notice. The line `Confirmarea mesajului pentru Voluntarii Activi;` was offered to 1.4 (#1183), but 1.4 was approved and merged on 2026-11-11 without it (PR #1212). The line waits for the next version, so Members are not asked to acknowledge again for one line. If Alex wants it acknowledged sooner, the bump is one `privacy_notice_version` change plus the text.

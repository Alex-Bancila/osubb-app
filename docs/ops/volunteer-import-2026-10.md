# Volunteer-base import (October 2026)

Imports OSUBB's existing volunteers (about 600 people) from the "Baza de date oameni vechi" sheet in **two steps**, as Alex decided on 2026-10-02 (#991): first **create** every account with its data and **send nothing**; then, once the email settings are ready, **send the invitations in batches** from Administrare › Membri (#992). Each step below says why it is there.

## Where the sheet lives

- The CSV export of the sheet holds real people's names, addresses, phones and birth dates. **It never goes into git**, an issue, a pull request or a chat. Keep it on the IT Coordinator's machine (and in the organization's Google Drive, where the sheet itself lives). _Why:_ the repository is shared with every contributor, and its history keeps whatever was ever committed.
- Delete local copies when the import is done.

## What the import reads, and what it ignores

| Column                                           | Becomes                                                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `Nume & Prenume`                                 | the full name, trimmed, in the sheet's "Nume Prenume" order                                                          |
| `Email`                                          | the sign-in address, lower-cased                                                                                     |
| `Număr de telefon`                               | the phone in `+40…` form (the sheet writes nine digits without the leading 0); unreadable → imported without a phone |
| `Funcția`                                        | the rank and positions (below)                                                                                       |
| `Departament PRINCIPAL`, `Departament secundar`… | memberships of the Department Groups with that name (`Imagine&PR` is "Imagine & PR"); the principal one is the chip  |
| everything else                                  | ignored: birth date, university, faculty, specialisation, level, year                                                |

Everyone joins on **22.02.2026**. `Funcția` maps as follows (the issue's binding table):

- `Membru voluntar` → Voluntar; `Membru cu drept de vot` → Voluntar cu Drept de Vot; the highest rank a cell names wins.
- `BC, <titlu>` → BC and Group Responsible of Biroul de Conducere with that title (Președinte, Secretar General, …); `Cenzor` → BC with the title "Cenzor".
- `BCE, Coordonator <x>` → BCE and, where the area has a Department, its Group Manager under the title "Coordonator <x>": Edu/Activități Edu → Educațional, FR → Financiar, Imagine/PR → Imagine & PR, Gestionare Voluntari → Resurse Umane, Activități de Tineret/Dezvoltare Politici de Tineret → Tineret. IT, Activități Interne and Scriere Proiecte are BCE only ("fără poziție").
- `Coordonator Principal <P>` → Group Manager of the Project Group named `<P>`; `Responsabil <x> <P>` → Group Responsible of `<P>` titled "Responsabil <x>".

Nothing is ever created from the sheet: an unknown Department keeps the row out; a missing Project imports the row without that appointment and notes "proiect lipsă: <P>".

## 1. Before the import

1. **Create the five Projects by hand** in Grupuri, named exactly as the sheet writes them after "Coordonator Principal". _Why:_ the import appoints people to Projects by name and never creates a Group; a Project created later is picked up by running the import again (step 3).
2. **Check Setări → Biroul de Conducere** names the board Group. _Why:_ the BC titles land on that Group; without the setting every BC row is noted "Grupul Biroul de Conducere nu este setat".
3. **Fix the four address rows** in the sheet (1 missing, 3 malformed), then export it as CSV. _Why:_ a row without a valid address cannot have an account; the dry-run lists them as blocking.

## 2. Dry-run

Administrare › Membri › Import, drop the CSV. The app calls `csv-import` with `mode: "dry_run"`: nothing is written. Read the preview: rank, Groups, positions, titles and problems per row. Blocking problems (address missing, invalid or repeated, unknown Department, address already a Member) keep a row out; the rest are notes the row is imported with.

## 3. Import (creates accounts, sends nothing)

"Importă N membri" applies the rows in chunks of at most 100. For each row, Auth's admin API creates the account with the address **unconfirmed — no email is sent** — and `public.import_member` writes the Profile, phone, join date and every Appointment in one transaction, without Notifications. _Why it is safe to repeat:_ a row imported before is completed (missing Appointments added), never created twice; an account left by an interrupted run is reused. Run it again after creating a missing Project.

The login page's "Trimite linkul" does not reach these accounts either: it only re-sends an invitation that was already sent (#968).

## 4. Review

The **De invitat** grid lists every never-invited Member with the import's notes. Correct names, addresses, phones, ranks and Departments there before anyone is emailed. _Why the address matters here:_ an address fixed in the grid is where the invitation goes — `send-invitations` moves the still-unused account to it before sending (#997). An address another account already uses is refused in the cell, or at the send as `email_taken`.

## 5. Before sending — dashboard settings (production project)

1. **Resend → Domains**: `app.osubb.ro` verified; **Billing**: Pro for the month. _Why:_ the free plan stops at 100 emails a day.
2. **Authentication → Rate Limits → Emails sent per hour**: raise to the batch rate you plan (for example `250`), and **put it back to `100` afterwards** (`docs/backend/auth-config.md`). _Why:_ every invitation counts against it; when it is reached Auth answers `over_email_send_rate_limit` and the sender stops.
3. **Authentication → Sign In / Providers → Email → Email OTP Expiration**: leave it at `3600` s, or raise it for the sending week only and put it back (launch runbook §12). _Why:_ an invitation link lives that long; a lapsed one is re-sent by the Member from the login page.
4. **Authentication → Email Templates → Invite user** holds `supabase/templates/invite.html` (launch runbook §5 step 4), and a test invitation to your own address arrives from `noreply@app.osubb.ro`. _Why:_ 600 people get this one email; check it once before they do.

## 6. Send in batches

Select Members in De invitat and press **Trimite invitațiile**. The app calls `send-invitations` with at most 50 ids per call. Each sent invitation stamps `profiles.invited_at` and the Member leaves the grid. When Auth answers the rate limit the batch **stops cleanly** and says where (`stopped.member_id`); the rest are `not_attempted`. Wait for the hour to pass and continue. Watch **Resend → Emails** for bounces. A sent Member has left the grid, so correct a bounced address on the Member's page with **Retrimite invitația** (`docs/backend/inviting.md`).

## Related

- Issue #991 (backend), #992 (Membri import dialog, grid and sender).
- `docs/backend/inviting.md` — the request and response shapes.
- `docs/ops/launch-runbook-2026-10.md` — the launch, Resend and Auth settings.

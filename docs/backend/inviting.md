# Inviting members

How an OSUBB account comes into existence. There is no other way — public sign-up is disabled and RLS denies anyone without a profile (ADR-0003).

## What happens when you invite someone

1. BC calls the `invite-member` Edge Function with an email, a name, and optionally a role and a list of **Group ids** — the Groups the new member starts in.
2. The function checks **you** are BC (level ≥ 6), reading your level from the database rather than your token — a token issued before a demotion still carries the old level for up to an hour.
3. It checks the Groups exist, and that the address doesn't already have an account. Both checks happen **before** anything is sent, so a typo never emails a real person.
4. Supabase sends a **magic link** and, in the same email, the **six-digit code** that is the same one-time password. No password is created, distributed, or stored.
5. `provision_profile()` creates the profile and then **appoints** the member into each Group, in one atomic call — the member is complete or doesn't exist. Appointment goes through the same shared roster path (`private.appoint_group_member`) that `add_group_member` uses, so every rule applies here too: an archived Group, an Automatic-Membership Group, or a Group whose Minimum Level is above the new member's role refuses the whole invitation, and nothing is created. The new member is notified of each Group, with **you** recorded as the person who appointed them.
6. The member clicks the link — or types the code, when the link would land in the wrong browser — and is signed in. Their token is stamped with role, level, departments, teams and groups, which is what every permission rule reads.

The member appears in the app immediately; the invitation stays valid until they click it.

## Inviting one member

The BC panel UI is issue #107. Until it exists, invite from a terminal — you need your own access token (sign in to the app, or use the snippet below locally).

```bash
curl -X POST "$SUPABASE_URL/functions/v1/invite-member" \
  -H "Authorization: Bearer $YOUR_ACCESS_TOKEN" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "email": "ioana.popescu@gmail.com",
        "full_name": "Ioana Popescu",
        "role": "recrut",
        "group_ids": [3]
      }'
```

`role` defaults to `recrut` and `group_ids` may be omitted — a recruit with no Group yet is normal, not an error. Valid roles come from the `roles` table; Group ids come from `groups` (`select id, name, short from groups where status = 'active'`).

**`dept_ids` and `team_ids` are gone.** Sending either is a `400` rather than a silently ignored field, because a dropped placement would create a member who belongs nowhere.

Success is `201` with the new member's id:

```json
{ "user_id": "caa02729-…", "email": "ioana.popescu@gmail.com" }
```

## Inviting many at once

Use [`recruits-import-template.csv`](recruits-import-template.csv) as the starting point. The import walks the same real invitation and provisioning path described above, one row at a time. It does not create mocked accounts or temporary passwords.

### CSV format

The file must be UTF-8 and its first row must be exactly:

```csv
name,email,dept,team
```

| Column  | Required | Meaning                                                                 |
| ------- | -------- | ----------------------------------------------------------------------- |
| `name`  | yes      | The member's full name                                                  |
| `email` | yes      | The invitation address; it is trimmed and converted to lowercase        |
| `dept`  | no       | One Department **Group**, by its short name or its display name         |
| `team`  | no       | One Team **Group** below that Department, by short name or display name |

Blank `dept` and `team` cells are valid. A row can currently name at most one Department and one Team; further Groups can be added later through member management. Quoted values follow normal CSV rules, so a name containing a comma can be written as `"Popescu, Ana"`.

### How `dept` and `team` are matched

Since #602 the two columns name **Groups**, not the old `departments`/`teams` ids, and the match is forgiving on purpose — BC's spreadsheets are typed by hand, months apart:

- a value matches a Group's **short name** (`EDU`) or its **display name** (`Educational`);
- **case is ignored** and **diacritics are stripped**, so `Educational`, `educațional`, `Educaţional` and `EDU` all name the same Group;
- runs of spaces are collapsed, and leading/trailing spaces are trimmed;
- only **active** Groups are matched — an archived Group is not a valid destination.

The `team` value is matched **inside the row's Department**: it must name a Group that lies below the `dept` Group. Two Departments may therefore have a Team of the same name without ambiguity. A Team that is not below that row's Department is reported as `unknown_team` on that row — from the spreadsheet's point of view there is no such Team in that Department.

A value that matches **two** Groups is reported rather than guessed (`Departament ambiguu:` / `Echipă ambiguă:`), because picking one would put a recruit in the wrong place silently.

Run `select id, short, name from groups where status = 'active' order by path;` to see the current spellings before preparing a large import. The old `edu` / `t-app`-style ids are no longer accepted unless they happen to be a Group's short name.

One request accepts at most 100 data rows and 256 KB. Every valid row is invited as `recrut`; the CSV cannot grant a higher role.

### Run a local import from PowerShell

Start from the repository root. Keep the function server open in its own terminal and wait until it prints `Serving functions` before sending a request:

```powershell
npx supabase start
npx supabase db reset
npx supabase functions serve
```

In another terminal, copy the local `ANON_KEY` shown by `npx supabase status`, then sign in as the seeded BC account. This password is for the local demo database only:

```powershell
$supabaseUrl = "http://127.0.0.1:54321"
$anonKey = "<ANON_KEY from npx supabase status>"

$session = Invoke-RestMethod `
  -Method Post `
  -Uri "$supabaseUrl/auth/v1/token?grant_type=password" `
  -Headers @{ apikey = $anonKey; "Content-Type" = "application/json" } `
  -Body (@{
    email = "bc@demo.osubb"
    password = "parola123"
  } | ConvertTo-Json)
```

Send the template (or your completed copy) as JSON. Use the anonymous key only in the `apikey` header and the BC access token for authorization. **Never use or paste a secret key (`sb_secret_…`) or the legacy service-role key here** — the function holds its own (see "Which key the functions use" below).

```powershell
$csv = Get-Content -Raw .\docs\backend\recruits-import-template.csv

$result = Invoke-RestMethod `
  -Method Post `
  -Uri "$supabaseUrl/functions/v1/csv-import" `
  -Headers @{
    apikey = $anonKey
    Authorization = "Bearer $($session.access_token)"
    "Content-Type" = "application/json"
  } `
  -Body (@{ csv = $csv } | ConvertTo-Json)

$result | ConvertTo-Json -Depth 8
```

### Read the result

The function deliberately allows partial success. `summary` gives the totals and the three arrays explain every row:

- `created`: the invitation was sent and the complete recruit profile was created;
- `skipped`: the address already has a profile, or the same address appeared earlier in this file;
- `errors`: the row was invalid or its invitation/provisioning step failed.

Example:

```json
{
  "summary": { "created": 2, "skipped": 1, "errors": 1 },
  "created": [
    { "row": 2, "email": "ana.pop@example.com", "user_id": "…" },
    { "row": 3, "email": "mihai.ionescu@example.com", "user_id": "…" }
  ],
  "skipped": [
    { "row": 4, "email": "existent@example.com", "code": "already_exists" }
  ],
  "errors": [
    {
      "row": 5,
      "field": "dept",
      "code": "unknown_department",
      "message": "Departament inexistent: necunoscut."
    }
  ]
}
```

Rows are numbered like a spreadsheet: the header is row 1 and the first member is row 2. Fix only the rows listed in `errors`, then import those corrected rows in a new file. Re-importing successful rows is safe: existing addresses are skipped and are never overwritten or deleted.

Locally, open Mailpit at http://127.0.0.1:54324 and confirm one **"Ai fost invitat în aplicația OSUBB"** message for every `created` row, each showing both the link and the six-digit code. Hosted imports require the SMTP provider from issue #146; without working hosted email delivery, the function cannot send real invitations.

## What the member sees

An email titled **"Ai fost invitat în aplicația OSUBB"** with a link and a six-digit code. Clicking the link signs them in — no password, nothing to remember. Future sign-ins use the same pair, sent to the same address; Google sign-in is not part of the accepted authentication design.

The link and the code are **one** one-time password: same secret, same expiry, single use. The code exists because a link signs you in where you open it, and that is not always where the app is. A member who installs the app on an iPhone gets storage separate from Safari, so tapping the link in Mail signs them into Safari while the installed app keeps showing the login screen; opening the link on a laptop after typing the address on a phone fails the same way. In both cases they type the code into the login screen's second step — _"Apasă linkul din email sau introdu codul de 6 cifre"_ — and land exactly where the link would have taken them. Nothing about invite-only changes: an address with no profile still gets no claims either way.

Tell them to check spam on first contact, that the link signs them in on the device they open it on, and that the code is there for when that device is the wrong one.

## When something goes wrong

| Response                                        | What it means                                                                                                        | What to do                                                                                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401`                                           | Your session expired                                                                                                 | Sign in again and retry                                                                                                                                                                  |
| `403 Doar BC poate invita membri`               | You are below level 6, or your profile is not `activ`                                                                | Ask BC to invite, or check your own status                                                                                                                                               |
| `409 … are deja cont`                           | That address already has an account                                                                                  | Nothing to do here. **Re-inviting is refused on purpose** — it must never overwrite or delete an existing member. A never-used invitation is re-sent from "The invitation never arrived" |
| `400 Grup inexistent: 12`                       | A `group_ids` entry doesn't name a Group                                                                             | Fix the id. Nothing was sent — no email went out                                                                                                                                         |
| `400 Câmpurile dept_ids și team_ids …`          | The old field names were sent                                                                                        | Send `group_ids` instead                                                                                                                                                                 |
| `400 Datele membrului nu sunt valide …`         | A Group refused the Appointment: archived, Automatic-Membership, or its Minimum Level is above the new member's role | Pick a different Group, or invite at a higher role. The invitation was rolled back and the account deleted                                                                               |
| `400 Email invalid` / `Numele este obligatoriu` | Missing or malformed input                                                                                           | Fix and retry                                                                                                                                                                            |
| `502`                                           | Supabase couldn't send the email                                                                                     | Check the email provider is enabled (below), then retry                                                                                                                                  |

**No email arrived?** Locally, mail never leaves your machine — open **Mailpit** at http://127.0.0.1:54324. On a hosted project, follow "The invitation never arrived" below.

## The invitation never arrived

`invite-member` refuses an address that already has a profile, and that stays true — it is what keeps a real Member from being overwritten or deleted. The recovery path for a bounced or mistyped invitation is a separate function, `reinvite-member` (#773, ruling L19): it corrects the address of a Member who has **never signed in** and sends the invitation again to the same account. Nothing is deleted or re-provisioned; the profile id, its Groups and its history stay as they are.

1. **Find out what happened to the email.** Resend dashboard → **Emails**, search by the address on file. _Why first:_ it separates "never sent" from "bounced" from "delivered but unseen", which have different fixes. Delivered → ask the Member to check spam and to confirm the address is really theirs. Bounced → the address is wrong or the mailbox refuses mail; get the right address from the Member. No entry within Resend's retention window → the send never happened: check Authentication → Logs and that the email provider is on (below). The full triage lives in `docs/ops/release.md`.
2. **Correct and re-send.** Administrare → the Member's page → **Retrimite invitația**. The panel shows only while the Member has never signed in and their address is not yet confirmed. Change the address if it was wrong (or leave it as it is to re-send to the same one) and press **Retrimite invitația**. You receive a `system` Notification recording the re-send and, when the address changed, the old one — that is the audit line, since profiles have no history table.
3. **Confirm it left.** Resend (or Mailpit locally) shows a new **"Ai fost invitat în aplicația OSUBB"** to the corrected address. The old invitation link is dead: the new email carries a new token.

From a terminal, the same call is:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/reinvite-member" \
  -H "Authorization: Bearer $YOUR_ACCESS_TOKEN" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "member_id": "caa02729-…", "email": "ioana.popescu@gmail.com" }'
```

Omit `email` to re-send to the address on file. `{ "member_id": "…", "action": "status" }` answers `last_sign_in_at` and `email_confirmed` without changing anything — the page uses it to decide whether to show the panel.

| Response                      | What it means                                                                                                | What to do                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `200`                         | The invitation left; `email_changed` says whether the address was corrected                                  | Check Resend for the new email                              |
| `403 member_manage_forbidden` | You are below level 6                                                                                        | Ask BC or the Moderator                                     |
| `409 already_active`          | The Member has signed in: the invitation did its job                                                         | Nothing to re-send                                          |
| `409 already_confirmed`       | The address is confirmed but was never used (seed data, a hand-made account); Auth sends no invitation to it | The Member asks for a link on the login screen              |
| `409 member_inactive`         | The profile is not `activ`; an invitation would open nothing                                                 | Reactivate the Member first, if that is what you mean to do |
| `409 email_taken`             | Another account already uses the new address                                                                 | Check the address; one person has one account               |
| `500 email_sync_failed`       | Auth or the profile refused the new address; Auth was put back, nothing changed                              | Retry; if it repeats, read the function's logs              |
| `500 email_out_of_sync`       | The profile refused **and** putting Auth back failed: the two addresses now differ                           | Fix it by hand as described below, then retry               |
| `502 invite_failed`           | The address was corrected (when you changed it) but the email did not leave                                  | Retry — a re-send to the same address changes nothing else  |

**Why the address changes in two places, in this order.** The sign-in address lives in `auth.users.email`, the one the app shows in `profiles.email`, and no transaction spans Auth and Postgres. The function moves Auth first, then the profile, and moves Auth back if the profile refuses — so each side ends where it started or both hold the new address, and the invitation only ever goes to an address both hold. If the rollback itself fails, the function answers `500 email_out_of_sync` and its log says `ROLLBACK FAILED: auth.users.email and profiles.email differ` with both addresses; put the Auth address back in the dashboard (Authentication → Users → the user → email) to the one in `profiles.email`.

## The setting that silently breaks everything

In `supabase/config.toml`, two keys look similar and do very different things:

```toml
[auth]
enable_signup = false        # invite-only: nobody can self-register. KEEP FALSE.

[auth.email]
enable_signup = true         # the email PROVIDER exists at all. KEEP TRUE.
```

Setting the second one to `false` renders `GOTRUE_EXTERNAL_EMAIL_ENABLED=false`, which disables email entirely — magic links, invitations and every login fail with _"Email logins are disabled"_. The invite-only guarantee comes from the **first** key, not the second. This was the actual state of the repo until 2026-08-23, and it would have surfaced only at the first real invite.

Hosted projects don't read `config.toml`: the same two settings live in the dashboard under Authentication → Sign In / Providers (issue #54).

## Which key the functions use

`invite-member`, `csv-import` and `reinvite-member` run two clients. The **caller** client carries your access token and only asks Auth who you are. The **admin** client — the one that reads your level, checks the Groups and the address, sends the invitation, calls `provision_profile()` and rolls back a failed invitation — is built from the project's **secret key** (`sb_secret_…`), which the gateway maps to `service_role`. The functions read it from `SUPABASE_SECRET_KEYS`, the JSON map of the project's secret keys that the platform injects into every function (the `default` key first), exactly as `send-push` does (#769, #796). They never read the legacy JWT `service_role` key, which Supabase retires by the end of 2026 (ruling L8).

There is nothing to set by hand: the CLI refuses any function secret whose name starts with `SUPABASE_`, and `npx supabase functions serve` injects the local secret key too. A hosted project must **have** a secret key — Project Settings → API Keys → _Secret keys_; create one if the list is empty. Without one both functions refuse to start: the boot error in the function's logs says `invite-member cannot start: SUPABASE_SECRET_KEYS holds no secret key` (or `csv-import …`) and names the dashboard page. The key is read once, when a function boots, so to rotate it: create a new secret key, delete the old one, then redeploy the functions so no warm worker keeps the deleted key.

## CORS: who is allowed to call this function from a browser

`invite-member` answers CORS preflight only for origins listed in the `ALLOWED_ORIGINS` environment variable (comma-separated; whitespace around each entry is trimmed). An origin not on the list gets `403` with no `Access-Control-Allow-Origin` header, and its preflight never reaches the handler's own auth checks. A request with no `Origin` header at all (server-to-server calls — curl, another function) is never CORS-gated; it goes straight to the normal `Authorization`/level checks, and only its response never carries `Access-Control-Allow-Origin` (browsers are the only caller that reads that header).

Locally the variable is unset, so the default `http://localhost:5173` applies — matching Vite's dev server. **No hosted app origin exists yet** (Cloudflare Pages deployment is issue #109), so `ALLOWED_ORIGINS` stays unset on staging/production until then; do not set it early to a guessed URL.

Once a hosted app origin exists, a human sets it from a real terminal (house rule 8 — secrets are never set from a non-interactive shell or CI):

```bash
npx supabase secrets set ALLOWED_ORIGINS=https://<app-origin>
```

## Checking the whole flow still works (local, ~3 minutes)

```bash
npx supabase start
npx supabase db reset
npx supabase functions serve invite-member
```

Then, with a BC access token, run the `curl` above and:

1. Open http://127.0.0.1:54324 — the invitation is there.
2. Open the link in it. You land on the redirect URL with an `access_token` in the fragment.
3. Paste that token into jwt.io. It must contain `app_metadata.member_role`, `member_level`, `dept_ids`, `team_ids`, `group_ids`. **If those are missing, the JWT claims hook is off** and every screen will look empty.
4. Query the API with it and confirm the permission model answers correctly:

```bash
curl "$SUPABASE_URL/rest/v1/departments?select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $NEW_TOKEN"
# → 7 departments (they are a member now)

curl "$SUPABASE_URL/rest/v1/profiles_contact?select=email" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $NEW_TOKEN"
# → exactly one row: their own. Contact details of others are not theirs to read.

curl "$SUPABASE_URL/rest/v1/departments?select=id" -H "apikey: $ANON_KEY"
# → 42501 permission denied. Without a session there is no access at all.
```

Last verified end to end on 2026-08-23: BC invited a member, the magic link produced a session carrying `member_role: voluntar`, `member_level: 1`, `dept_ids: ["edu"]`, and the four checks above answered exactly as written.

CSV import last verified end to end on 2026-09-15 from a fresh local database: three valid rows created three Auth users, three complete recruit profiles, the expected department/team memberships, and exactly three Mailpit invitations. A fourth row with an unknown department was reported without blocking the valid rows. Re-importing the same file skipped all three existing members and sent no additional email. **That run predates #602**, which moved both columns onto Groups; the next end-to-end run should confirm the Group roster rows rather than `member_departments`/`team_members`, which provisioning no longer writes at all (they are dropped by #590).

## Related

- `docs/adr/0003-invite-only-auth.md` — why invite-only, and what deactivation means
- `supabase/functions/invite-member/` — the function, its port, and its tests
- `supabase/functions/reinvite-member/` — correcting and re-sending a never-used invitation (#773)
- Issues: #54 (hosted auth checklist) · #107 (BC panel invite UI) · #71–#73 (CSV import)

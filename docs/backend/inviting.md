# Inviting members

How an OSUBB account comes into existence. There is no other way — public sign-up is disabled and RLS denies anyone without a profile (ADR-0003).

## What happens when you invite someone

1. BC calls the `invite-member` Edge Function with an email, a name, and optionally a role, departments and teams.
2. The function checks **you** are BC (level ≥ 6), reading your level from the database rather than your token — a token issued before a demotion still carries the old level for up to an hour.
3. It checks the departments and teams exist, and that the address doesn't already have an account. Both checks happen **before** anything is sent, so a typo never emails a real person.
4. Supabase sends a **magic link**. No password is created, distributed, or stored.
5. `provision_profile()` creates the profile plus department and team links in one atomic call — the member is complete or doesn't exist.
6. The member clicks the link and is signed in. Their token is stamped with role, level, departments and teams, which is what every permission rule reads.

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
        "dept_ids": ["edu"],
        "team_ids": []
      }'
```

`role` defaults to `recrut`; `dept_ids` and `team_ids` may be omitted. Valid roles and department ids come from the `roles` and `departments` tables — a recruit with no team yet is normal, not an error.

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

| Column  | Required | Meaning                                                          |
| ------- | -------- | ---------------------------------------------------------------- |
| `name`  | yes      | The member's full name                                           |
| `email` | yes      | The invitation address; it is trimmed and converted to lowercase |
| `dept`  | no       | One department id                                                |
| `team`  | no       | One team id                                                      |

Blank department and team cells are valid. A row can currently contain at most one department and one team; additional memberships can be added later through member management. Quoted values follow normal CSV rules, so a name containing a comma can be written as `"Popescu, Ana"`.

Valid local/demo department ids are:

| Id            | Display name  |
| ------------- | ------------- |
| `edu`         | Educațional   |
| `hr`          | Resurse Umane |
| `fin`         | Financiar     |
| `pr`          | Imagine & PR  |
| `youth`       | Tineret       |
| `diverse`     | Diverse       |
| `secretariat` | Secretariat   |
| `org`         | Organizație   |

Valid local/demo team ids are `interne`, `it`, `t-app`, `t-logistica`, and `t-recruti`. These ids are reference data, not labels invented by the CSV. For a hosted project, verify the current lists in the `departments` and `teams` tables before preparing a large import.

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

Send the template (or your completed copy) as JSON. Use the anonymous key only in the `apikey` header and the BC access token for authorization. **Never use or paste the service-role key here.**

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

Locally, open Mailpit at http://127.0.0.1:54324 and confirm one **"You've been invited"** message for every `created` row. Hosted imports require the SMTP provider from issue #146; without working hosted email delivery, the function cannot send real invitations.

## What the member sees

An email titled **"You've been invited"** with a single link. Clicking it signs them in — no password, nothing to remember. Future sign-ins also use a magic link sent to the same address; Google sign-in is not part of the accepted authentication design.

Tell them to check spam on first contact, and that the link signs them in on the device they open it on.

## When something goes wrong

| Response                                        | What it means                                         | What to do                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `401`                                           | Your session expired                                  | Sign in again and retry                                                                                     |
| `403 Doar BC poate invita membri`               | You are below level 6, or your profile is not `activ` | Ask BC to invite, or check your own status                                                                  |
| `409 … are deja cont`                           | That address already has an account                   | Nothing to do. **Re-inviting is refused on purpose** — it must never overwrite or delete an existing member |
| `400 Departament inexistent: x`                 | A department or team id doesn't exist                 | Fix the id. Nothing was sent — no email went out                                                            |
| `400 Email invalid` / `Numele este obligatoriu` | Missing or malformed input                            | Fix and retry                                                                                               |
| `502`                                           | Supabase couldn't send the email                      | Check the email provider is enabled (below), then retry                                                     |

**No email arrived?** Locally, mail never leaves your machine — open **Mailpit** at http://127.0.0.1:54324. On a hosted project, check Authentication → Logs, and confirm the **email provider is enabled** (see below).

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
3. Paste that token into jwt.io. It must contain `app_metadata.member_role`, `member_level`, `dept_ids`, `team_ids`. **If those are missing, the JWT claims hook is off** and every screen will look empty.
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

CSV import last verified end to end on 2026-09-15 from a fresh local database: three valid rows created three Auth users, three complete recruit profiles, the expected department/team memberships, and exactly three Mailpit invitations. A fourth row with an unknown department was reported without blocking the valid rows. Re-importing the same file skipped all three existing members and sent no additional email.

## Related

- `docs/adr/0003-invite-only-auth.md` — why invite-only, and what deactivation means
- `supabase/functions/invite-member/` — the function, its port, and its tests
- Issues: #54 (hosted auth checklist) · #107 (BC panel invite UI) · #71–#73 (CSV import)

# Release to production

A **Release** carries `main` into production: the pending migrations, every Edge Function, and the web app
at `app.osubb.ro`. It is always started by a person and approved by a person; nothing automatic ever
touches production (ruling L10 of the 2026-09-25 launch grill, issue #78). The glossary word is _Release_;
_Promotion_ is a Member moving up a Role, never a deploy.

This page covers starting, reviewing, approving and verifying a Release, its rollback, who holds which
login, and the recurring per-environment setup and lookups around it. The very first Release is different
— production doesn't exist yet, so most of this page doesn't apply — and is walked step by step in §11 of
[`launch-runbook-2026-10.md`](launch-runbook-2026-10.md), the runbook for that one run.

## The one command

```bash
gh workflow run release-production.yml --ref main
```

Then follow it with `gh run watch --exit-status` (pick the new run; the command exits non-zero if the
Release fails), or in the browser. To start it from the browser instead: **Actions → Release to production → Run workflow** (branch `main`). Started from any
other branch it refuses before anything else runs, and the `production` Environment admits only `main`
as a second lock.

## What happens

The workflow is `.github/workflows/release-production.yml`, two jobs:

1. **`report`** — no Environment, no production secret, so it reads **git**, not production: it writes
   to the run's summary the commit going live, the migration files added and the Edge Functions whose
   code changed, all counted from the newest `release/*` tag (the first Release lists everything). After
   a Release that failed before its tag, some of those migrations may already be applied; production's
   own record is the `supabase migration list` that the `release` job prints before it pushes. The report
   also warns when a migration file that was already released has been edited: `db push` never
   re-applies one.
2. **`release`** — waits in the `production` Environment for a required reviewer (Alex or Dobre; one
   approval is enough). Until someone approves, it has no secret and runs nothing. After approval, in
   order:
   1. checks the Environment has every secret and variable, and fails with their names if not;
   2. `supabase link`, prints `supabase migration list` (production's own record of what is pending),
      then `supabase db push --include-all`;
   3. `supabase functions deploy` for every function under `supabase/functions/`;
   4. builds `app/` with the production variables — the build refuses a URL that is not exactly
      `https://<SUPABASE_PROJECT_REF>.supabase.co` and any key that is not the publishable one;
   5. `wrangler pages deploy` to the `osubb-app` Pages project, branch `main`;
   6. smoke checks, below;
   7. tags the commit `release/<date>-<sha>`. A tag therefore means every step passed, and the next
      Release's report counts from it.

## Reviewing and approving

1. Open the run and read the **`report`** summary. Is the commit the one you expect? Are the migrations
   the ones you merged? Is there a warning about an edited migration?
2. **Take a local dump of production** before approving, to your own encrypted disk. The dump is never a
   workflow artifact: this repository is public. `supabase db dump` writes the schema only unless told
   otherwise, so take both:

   ```bash
   npx supabase db dump --db-url "<prod pooler URL>" -f prod-$(date +%F)-schema.sql
   npx supabase db dump --db-url "<prod pooler URL>" --data-only -f prod-$(date +%F)-data.sql
   ```

   The pooler URL with its password is in Bitwarden ("Supabase prod – pooler URL"). Delete dumps after
   30 days.

3. Approve in the **Review deployments** banner of the run. Rejecting, or letting it wait, leaves
   production untouched.

## Smoke checks

Run from GitHub's side after the deploy; every check reports, and any failure fails the Release (no tag).

| Check                                                                       | Proves                                                            |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `select 1` through the session pooler                                       | the database is up and the password in the Environment is current |
| `GET /functions/v1/send-push` without a key answers `401`                   | the functions are deployed and still refuse anonymous calls       |
| `/` sends a `Content-Security-Policy` (or its `-Report-Only` form) and HSTS | the `_headers` file of #770 shipped with this build               |
| `/manifest.webmanifest` is `application/manifest+json`                      | the PWA can still be installed                                    |

The header and manifest checks run on `https://osubb-app.pages.dev` and, once the CNAME resolves, on
`https://app.osubb.ro` as well; before the custom domain exists (the first Release) the run notes that it
checked the Pages address only.

## When a step fails

The steps run in order and stop at the first failure, so the log says how far the Release got. Everything
before the failed step is live; nothing after it ran. Fix forward on `main` and start a new Release: a
migration that was applied stays applied, a later `db push` carries only what is still pending, and the
functions and the web app are simply deployed again.

## What the workflow needs

| Where                               | Name                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `production` Environment, secrets   | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `CLOUDFLARE_API_TOKEN` (production one)       |
| `production` Environment, variables | `SUPABASE_PROJECT_REF`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY` |
| `production` Environment, rules     | deployment branches: `main` only; required reviewers: Alex, Dobre                              |
| Repository variable                 | `CLOUDFLARE_ACCOUNT_ID`                                                                        |
| Cloudflare                          | Pages project `osubb-app`, production branch `main`, custom domain `app.osubb.ro`              |

How each one is created is in §4, §6, §7 and §11 of the launch runbook.

## Rollback and the forward-fix rule

**The database is never rolled back on production.** `db push --include-all` only ever moves forward, and
Postgres has no reliable "undo" for a migration that already ran against live rows — some may already have
been read, changed, or referenced by rows that same migration wrote. A bad migration is fixed the way every
other bug is: write a new migration that corrects it, ship it through the ordinary PR process (house rules
1, 5, 7), and start a new Release. _Why:_ an installed PWA still on the previous bundle can hit the schema
mid-session, so a fix, like any other schema change, must expand before it contracts
(`docs/backend/conventions.md`) — the same discipline that makes forward-fixing safe going in keeps it safe
going "back".

**The web app rolls back one of two ways**, depending on whether Edge Functions changed with it:

1. **Fast, static-only — Cloudflare's own rollback.** Cloudflare dashboard → Workers & Pages → `osubb-app` →
   **Deployments** lists every past deployment; **Rollback** next to a previous one makes it live again in
   seconds, with no GitHub Actions run and no reviewer approval. _Why fast matters here:_ a broken bundle in
   front of Members outweighs the review ritual for the minute it takes. It swaps static assets only — it
   never touches the database or Edge Functions — so use it only when the previous bundle is still
   compatible with whatever schema and functions are live right now.
2. **Full — re-run the Release at the previous good commit.** Use this only when the previous app and Edge
   Functions are still compatible with the schema already live — the database only ever moves forward (the
   rule above), so a migration that shipped since that commit may have changed something the old code
   depends on; when it has, fix forward instead of reverting. When Edge Functions must roll back together
   with the web app (their contract changed in the same Release), Cloudflare's button alone leaves the
   functions on the new code. `release-production.yml` only ever runs from `refs/heads/main` — it refuses
   any other ref before the reviewer is even asked (ruling L10) — so "the previous `release/*` tag's commit"
   means bringing `main` there with a **new** commit that reverts `app/` and `supabase/functions/` to that
   tag's tree (`git revert` the offending commit(s), or a fresh commit matching that tree for those paths
   only) — never a force-push to `main` (house rule 7), and never a commit that also deletes a migration
   file already applied to production. Keep every migration file already applied: `db push --include-all`
   matches by file against what it has already recorded, so a missing file for an already-applied migration
   is a history mismatch, not a rollback. Push it, then run the one command as usual: the `release` job
   redeploys every Edge Function from that commit's `supabase/functions/`, rebuilds and redeploys the web
   app from the same commit, and tags a new `release/*` name. If restoring an accidentally-deleted migration
   file is part of the revert, the `report` job's "already released, edited" warning is expected — the
   migration itself still only ever moves forward, per the rule above.

Edge Functions have no rollback control of their own; they return to a previous version only through path 2.

## Per-environment one-time configuration

These manual dashboard, secret and Pages setup steps do not run as part of a Release — a hosted project
never reads `config.toml` for them (house rule 1 extends to infrastructure, not just schema). The one
exception is a function's own `[functions.*]` settings (`verify_jwt` and the like): `supabase functions
deploy` applies those from `config.toml` on every Release, so a change to them is a Release input like any
other and belongs in the `report` job's review, not this list. Each item below is set once per environment
by a human, and touched again only when it changes. To keep one copy instead of two drifting apart, the settings themselves live where each was
originally written; this page only points at them.

| What                                                                                                                                                  | Where it's documented                                                                    | Set for staging in | Set for production in |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------ | --------------------- |
| Auth dashboard settings (provider on, self-signup off, the JWT claims hook, URL Configuration, SMTP, the three email templates, the email rate limit) | `docs/backend/auth-config.md` § "Hosted projects"                                        | launch-runbook §5  | launch-runbook §7     |
| The `/auth/confirm` redirect the click-to-confirm templates depend on                                                                                 | `docs/backend/auth-config.md` § "Why the link opens a page with a button"                | §5.3               | §7.1                  |
| `ALLOWED_ORIGINS` for `invite-member` and every other CORS-gated function                                                                             | `docs/backend/inviting.md` § "CORS: who is allowed to call this function from a browser" | §5.8               | §7.5                  |
| Optional (only if push is enabled): VAPID pair and the two Vault rows (`project_url`, `secret_key`)                                                   | `docs/backend/push.md` § "Setting it up, per environment"                                | §5.9               | §7.5                  |
| Pages project and custom domain                                                                                                                       | `launch-runbook-2026-10.md`                                                              | §1                 | §11.2, §11.4          |

_Why linked and not copied:_ a value repeated in two places is a value that goes stale in one of them the
first time it changes; the runbook and the backend docs are what the person doing the work actually opens.

Demo data is a separate concern again — staging-only, never production, applied by hand on request, never by
a Release: `docs/backend/seeding-staging.md`.

## Who holds which login

Every credential below is a Bitwarden entry in the **OSUBB infra** collection (house rule 8, launch-runbook
intro) — this table says who is meant to hold it and where it lives, never the value itself.

| Account                                    | Holder(s)                                                              | Notes                                                                                                                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare account "OSUBB"                 | Alex's `@osubb.ro` user (Super Administrator)                          | `it@osubb.ro` is added as a second Super Administrator once the Workspace admin creates it (launch-runbook §13) — an invite, never a shared password. Recovery codes and its TOTP secret go in Bitwarden. |
| Resend team                                | Alex's `@osubb.ro` user                                                | `it@osubb.ro` invited as Admin in §13. Two sending-only API keys, one per environment, each scoped to `app.osubb.ro` alone — a leaked staging key is revoked without touching production.                 |
| Supabase organization "OSUBB" (production) | Owned by `it@osubb.ro` once it exists; Alex as second owner until then | Staging stays in its own, older, free organization — kept separate on purpose (L14).                                                                                                                      |
| GitHub repository                          | Alex: Admin. Dobre and Paul: Write                                     | Admin edits branch/Environment protection rules, so the reviewer gate below is only as strong as this list (launch-runbook §6.3).                                                                         |
| GitHub Environment `production`            | Required reviewers: Alex and Dobre, any one approval                   | Set once in **Settings → Environments → production**; nobody outside this list can approve a Release.                                                                                                     |
| cyber_folks DNS (cPanel)                   | Alex, plus whoever else is recorded in Bitwarden                       | The next coordinator needs this to touch a DNS record — write down who else holds the login the moment you learn it (launch-runbook §3.4).                                                                |

## The canary device

After every `send-push` deploy — by hand today, from CI once #110 merges, and as part of every production
Release from then on — the IT Coordinator sends their own subscribed device one test push and confirms it
arrives. The exact SQL is in `docs/backend/push.md`, § "Setting it up, per environment". _Why a device and
not another automated smoke check:_ the [smoke checks](#smoke-checks) above prove the function is deployed
and refuses an anonymous call, not that a real payload reaches a real browser and shows a notification — that
needs VAPID signing, the push service, and a subscribed device end to end, and is worth keeping outside the
automated gate so a stale or revoked canary subscription fails as a visible follow-up step, never as a Release
blocked for a reason that has nothing to do with the code going out.

## The Resend "never arrived" lookup

A Member says an invitation or a sign-in email never showed up. Before assuming Resend is broken, or the
Member's own inbox is at fault:

1. **Resend dashboard → Emails**, search by the recipient's address. Every send from either environment's
   key shows here — one Resend team, two keys (see "Who holds which login" above). _Why here first:_ it
   separates "we never sent it" from "we sent it and it bounced" from "it's sitting in spam", three
   different fixes.
2. Read the entry's status. **Delivered** means it left Resend and the receiving server accepted it — check
   spam next, and that the address really is the Member's. **Bounced** means Resend recorded a delivery
   rejection; inspect its details and distinguish temporary or undetermined bounces from permanent address
   or suppression failures. **Complained** means the recipient marked a delivered email as spam, so handle
   it separately from address validity. **No entry at all**, within Resend's 30-day retention window, means
   the send never happened — check `docs/backend/auth-config.md` § "Verifying the whole thing works" for the
   provider being off or the rate limit being hit. Past that window the dashboard has already dropped the
   record, so absence there proves nothing — confirm with the Member directly (spam folder, and that the
   address on file is correct) before assuming the send failed.
3. **If the fix is a mistyped address:** there is no re-send path today. `invite-member` refuses on purpose
   when the profile already exists (`409`, `docs/backend/inviting.md` § "When something goes wrong") — that
   is what protects an existing Member from being silently overwritten. Correcting the address and
   re-sending, for a Member who has never signed in, is issue **#773**
   ("Administrare: correct the email and re-send the invitation…", blocked by #103) — not built yet. Until it
   ships there is no workaround: do not delete and re-invite the profile, which is exactly the
   re-provisioning #773 exists to avoid.

## November recruitment pacing

The org-wide rollout (#37) stays in November, after the 2 October launch scope closes (ruling L15). _Why it
needs pacing at all:_ the CSV import accepts at most 100 rows per file (`docs/backend/inviting.md`) and
Resend's free plan sends at most 100 emails a day, so a recruitment batch that needs more than one file in
one day needs either three days spread across the free plan, or one month of Resend Pro ($20) with
**Rate Limits → Emails sent per hour** raised to 250 on the import days and put back afterward. Which of the
two is used is decided when November's actual batch size is known, not now (ruling L6).

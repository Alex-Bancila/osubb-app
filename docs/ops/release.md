# Release to production

A **Release** carries `main` into production: the pending migrations, every Edge Function, and the web app
at `app.osubb.ro`. It is always started by a person and approved by a person; nothing automatic ever
touches production (ruling L10 of the 2026-09-25 launch grill, issue #78). The glossary word is _Release_;
_Promotion_ is a Member moving up a Role, never a deploy.

This page covers starting, reviewing, approving and verifying a Release. Rollback, account holders and the
rest of the operations runbook are #772's; the first Release of all is §11 of
[`launch-runbook-2026-10.md`](launch-runbook-2026-10.md).

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

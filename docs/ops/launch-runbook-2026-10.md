# Launch runbook — every step the IT Coordinator performs (25 Sep → 2 Oct 2026)

The human lane of `docs/superpowers/plans/2026-09-25-launch-infrastructure-grill.md`. Steps are in the order
to do them; each says **why** before **how**. Agents and developers work the other lanes in parallel;
where a step waits on a merge it says so. Every secret goes to Bitwarden the moment it is shown, in a
collection named **OSUBB infra**, and nowhere else (house rule 8). Dashboard labels are those of
September 2026; if a menu has moved, search the dashboard for the label.

Accounts you sign in with this week: your `@osubb.ro` Google Workspace address for every new vendor
account (Cloudflare, Resend, the new Supabase organization). When the Workspace admin creates
`it@osubb.ro`, you add it as a second owner everywhere (§13); you never create the accounts on it now,
because that mailbox does not exist yet and a cPanel mailbox for `@osubb.ro` would never receive mail
(the domain's MX points at Google).

---

## §1 Cloudflare account and the staging Pages project — Friday 25 Sep

**Why.** Cloudflare has no organization tier below Enterprise; the _account_ is the organization. It is
free, it will serve `app.osubb.ro`, and it must outlive you: members with roles, not a shared password.

1. Go to `dash.cloudflare.com/sign-up`, sign up with your `@osubb.ro` address, confirm the email.
2. Profile (top right) → **My Profile → Authentication → Two-Factor Authentication**: enable with an
   authenticator app. Save the **recovery codes** in Bitwarden ("Cloudflare OSUBB – recovery codes").
3. Left menu → **Manage Account → Configurations → Account name → Change name** → `OSUBB`.
4. **Workers & Pages** → the right-hand panel shows **Account ID**. Copy it; it is not secret, it becomes
   the GitHub repository variable `CLOUDFLARE_ACCOUNT_ID` (§6).
5. **My Profile → API Tokens → Create Token → Custom token**: name `github-pages-staging`, permission
   **Account · Cloudflare Pages · Edit**, Account Resources = OSUBB, no IP filter, no expiry. Create, copy
   once, store in Bitwarden ("Cloudflare token – Pages staging/preview"). _Why a token and not your
   login:_ it can be revoked alone and it only deploys Pages.
6. From a terminal in the repo (this uses the token, so the project is **Direct Upload**, which is what
   lets GitHub Actions own every deploy):

   ```bash
   CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<id> npx wrangler pages project create osubb-staging --production-branch main
   ```

   Do **not** use "Connect to Git" in the dashboard: a Git-connected project deploys on every push and
   the GitHub reviewer gate could never stop it.

7. Nothing else here today. The production project `osubb-app`, the second token and the custom domain
   come Thursday (§11), after the production Supabase project exists.

## §2 Resend — Friday 25 Sep

**Why.** Every account in the app starts from an emailed link, and every sign-in on a new device is one
too. Supabase's built-in sender is 2 emails an hour to team addresses. Resend gives a per-email log that
answers "did the invitation arrive?" in seconds.

1. `resend.com/signup` with your `@osubb.ro` address; confirm; **Settings → Security → 2FA** on, recovery
   codes to Bitwarden.
2. **Domains → Add Domain** → `app.osubb.ro`, region **Ireland (eu-west-1)** (sending from the EU; the
   logs are stored in the US whatever you pick, which the Privacy Notice states). Resend now shows the
   DNS records. Leave this tab open for §3.
3. On the domain page turn **open tracking** and **click tracking** off (they rewrite links, and a
   rewritten magic link is a broken magic link).
4. **API Keys → Create API Key**: name `supabase-staging`, permission **Sending access**, domain
   `app.osubb.ro`. Copy once → Bitwarden ("Resend key – staging"). Repeat for `supabase-production` →
   Bitwarden ("Resend key – production"). _Why two:_ a leaked staging key is revoked without touching
   production.
5. Free plan is enough (100/day, 3,000/month). The upgrade to Pro ($20/month) is a November decision
   (§14).

## §3 DNS records at cyber_folks — Friday 25 Sep, before you stop for the day

**Why.** DNS for `osubb.ro` is answered by cyber_folks, so the records that prove OSUBB owns the sender
address must be typed there. They live on child names of `app` (`resend._domainkey.app`, `send.app`,
`_dmarc.app`), so they never collide with the hosting CNAME on `app` that comes Thursday. Doing this
today gives verification the weekend to settle.

1. cPanel → **Zone Editor** → `osubb.ro` → **Manage**. Never the **Subdomains** tool: it would create a
   web folder and an A record on `app` that would later block the CNAME.
2. Add, one by one, exactly what the Resend domain page shows (typical shape, but copy Resend's values):
   - `resend._domainkey.app` · **TXT** · `p=…` (the DKIM public key)
   - `send.app` · **MX** · priority `10` · `feedback-smtp.eu-west-1.amazonses.com`
   - `send.app` · **TXT** · `v=spf1 include:amazonses.com ~all`
   - `_dmarc.app` · **TXT** · `v=DMARC1; p=none; rua=mailto:<your @osubb.ro address>` (switch to
     `it@osubb.ro` when it exists)
     cPanel usually completes the name to `….app.osubb.ro.`; after saving, read each row back and check
     the full name is right. TTL: leave the default.
3. Back in Resend → the domain → **Verify**. It can take minutes or hours. Check again Saturday morning;
   the domain must say **Verified** before §4's SMTP test.
4. Write in Bitwarden who else holds the cPanel login (secure note "cyber_folks DNS"). The next
   coordinator needs it.

## §4 New Supabase organization and the production project — Friday 25 Sep

**Why.** Production must be its own project (separate data, separate keys) on **Pro** (daily backups, no
auto-pausing), in an organization the association owns, not tied to your personal Supabase login forever.
Staging stays on the free organization it is in today.

1. `supabase.com/dashboard` → organization switcher (top left) → **New organization**: name `OSUBB`,
   plan **Pro**. Payment method: the association's card (Vicepreședinte Financiar). Store the invoice
   email in Bitwarden.
2. **New project**: name `osubb-app-prod`, region **Frankfurt (eu-central-1)**, generate a strong database
   password → Bitwarden ("Supabase prod – DB password"). Wait for "Project is ready".
3. **Organization → Billing → Cost control → Spend cap: ON**. Screenshot → Bitwarden attachment. _Why:_
   a bug that hammers the database must cost at most the plan, never an open-ended bill.
4. **Project Settings → API keys**: note in Bitwarden which tabs exist (legacy `anon`/`service_role`, and
   `sb_publishable_…` / `sb_secret_…`). Copy the **publishable** key (not secret; it becomes a GitHub
   variable) and the **secret** key (Bitwarden only; it goes into Vault in §7). If the _Secret keys_ list
   is empty, create one first. _Why:_ `invite-member`, `csv-import` and `send-push` take it from the
   platform (`SUPABASE_SECRET_KEYS`, nothing to set by hand) and never read the legacy `service_role`
   key; without one the provisioning functions refuse to start (#796). Copy the **Project URL**
   and the **project ref**.
5. **Project Settings → Database → Connection string → Session pooler**: copy the URI, substitute the
   password → Bitwarden ("Supabase prod – pooler URL"). Used for the pre-Release dump (§11).
6. **Organization → Team**: nothing yet; `it@osubb.ro` is invited as Owner in §13.

## §5 Staging dashboard checklist (#54) — Saturday 26 Sep

**Why.** `config.toml` never reaches a hosted project; five settings must be set by hand, and the same
five on production in §7. `docs/backend/auth-config.md` explains each one.

Project `osubb-app` (staging, ref `bbhetqtmavveaoqlxjhp`):

1. **Authentication → Sign In / Providers → Email**: provider **enabled**; _Confirm email_ on; _Secure
   email change_ on. Under **Authentication → Sign In / Providers**, _Allow new users to sign up_: **OFF**
   (this is the invite-only guarantee; the provider switch above is a different thing).
2. **Authentication → Hooks → Customize Access Token (JWT) Claims**: enable, Postgres function
   `public.custom_access_token_hook`. Without it every screen is empty.
3. **Authentication → URL Configuration**: Site URL `https://osubb-staging.pages.dev`; Redirect URLs:
   `https://osubb-staging.pages.dev/auth/callback` and `https://osubb-staging.pages.dev/auth/confirm`.
   (The `/auth/confirm` route arrives with issue N1; adding the URL early is harmless.)
4. **Authentication → Email Templates**: paste `supabase/templates/invite.html` into _Invite user_,
   `magic-link.html` into _Magic Link_, and the change-email template into _Change Email Address_;
   Romanian subjects. When N1 merges, paste the new versions (the link changes shape).
5. **Project Settings → Authentication → SMTP Settings**: _Enable Custom SMTP_; sender email
   `noreply@app.osubb.ro`; sender name `OSUBB staging`; host `smtp.resend.com`; port `465`; username
   `resend`; password = the **staging** Resend key. Save.
6. **Authentication → Rate Limits → Emails sent per hour**: `100`.
7. Verify with the two curl checks in `docs/backend/auth-config.md` (self-signup must answer
   `422 signup_disabled`; a demo member login must return a token with `member_role`). Then
   **Authentication → Users → Invite user** to your own address and confirm the email arrives from
   `noreply@app.osubb.ro`, in the inbox, within a minute. Check **Resend → Emails** shows it as delivered.
8. After the first staging web deploy (§9) only: from a real terminal,

   ```bash
   npx supabase secrets set --project-ref bbhetqtmavveaoqlxjhp ALLOWED_ORIGINS=https://osubb-staging.pages.dev
   ```

9. Push, after issue N2 merges (it changes the key the cron job sends): generate a pair
   `npx web-push generate-vapid-keys` → Bitwarden ("VAPID staging"); then

   ```bash
   npx supabase secrets set --project-ref bbhetqtmavveaoqlxjhp VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:<your @osubb.ro>
   ```

   and in the dashboard **SQL Editor**:

   ```sql
   select vault.create_secret('https://bbhetqtmavveaoqlxjhp.supabase.co', 'project_url');
   select vault.create_secret('<sb_secret_ of staging>', 'secret_key');
   ```

   The public key also goes to GitHub as the `staging` variable `VITE_VAPID_PUBLIC_KEY` (§6). CI deploys
   `send-push` after #110 merges; until then nothing calls the function.

10. **Project Settings → API Keys → Secret keys**: at least one secret key (`sb_secret_…`) exists; if the
    list is empty, create one. _Why:_ `invite-member` and `csv-import` build their admin client from it
    and `send-push` checks the cron call against it, all through the platform-provided
    `SUPABASE_SECRET_KEYS` (#769, #796). Nothing to set with `supabase secrets set` (the CLI refuses names
    starting with `SUPABASE_`), and no function reads the legacy `service_role` key any more. Without a
    secret key the two provisioning functions refuse to start, and their logs name `SUPABASE_SECRET_KEYS`.

## §6 GitHub Environments and secrets — Saturday 26 Sep (pairs with the #110 PR)

**Why.** Secrets at repository level are readable by any workflow run from a branch in this repository.
Environments scope them: `staging` only from `main`, `production` only from `main` and only after a named
reviewer approves. Variables hold the public build values so a reviewer can read them.

1. Repository → **Settings → Environments → New environment**:
   - `preview`: no protection rules. Secret `CLOUDFLARE_API_TOKEN` (the staging/preview token of §1).
     Variables: `SUPABASE_PROJECT_REF`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (staging's
     **publishable** key, `sb_publishable_…`), `VITE_VAPID_PUBLIC_KEY` — all staging's values. _Why:_ a
     preview job can only read its own Environment's variables, not `staging`'s.
   - `staging`: _Deployment branches and tags_ → **Selected branches** → add `main`. Secrets:
     `SUPABASE_ACCESS_TOKEN` (create a new one at `supabase.com/dashboard/account/tokens`, name
     `github-ci`, Bitwarden), `SUPABASE_DB_PASSWORD` (staging), `STAGING_DB_URL` (same value as today's
     repository secret), `CLOUDFLARE_API_TOKEN`. Variables: `SUPABASE_PROJECT_REF` =
     `bbhetqtmavveaoqlxjhp`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` = staging's
     **publishable** key (`sb_publishable_…`), `VITE_VAPID_PUBLIC_KEY` (from §5.9; can be added later).
   - `production`: _Required reviewers_ → add yourself and Dobre; _Deployment branches_ → `main` only.
     Secrets: `SUPABASE_ACCESS_TOKEN` (the same token is fine; it is account-scoped), `SUPABASE_DB_PASSWORD`
     (production), `CLOUDFLARE_API_TOKEN` (the **production** token, created in §11). Variables:
     `SUPABASE_PROJECT_REF` (production ref), `VITE_SUPABASE_URL` (production URL),
     `VITE_SUPABASE_ANON_KEY` (production publishable key), `VITE_VAPID_PUBLIC_KEY` (§7).
2. **Settings → Secrets and variables → Actions → Variables**: repository variable
   `CLOUDFLARE_ACCOUNT_ID`.
3. **Settings → Collaborators**: Dobre and Paul = **Write**. Only you are Admin. _Why:_ protection rules
   are edited by admins; the reviewer gate is only as strong as the admin list.
4. After #110 has merged and its first staging run is green: **Settings → Secrets → Actions** → delete the
   four repository-level secrets. Not before, or the current `push-staging` job breaks.

## §7 Production dashboard checklist (#77) — Saturday 26 / Sunday 27 Sep

Same as §5 on the production project, with these values:

1. Site URL `https://app.osubb.ro`; Redirect URLs `https://app.osubb.ro/auth/callback`,
   `https://app.osubb.ro/auth/confirm`.
2. SMTP sender name `OSUBB`, password = the **production** Resend key. Rate limit `100`.
3. Templates: the same three; re-paste after N1 merges.
4. Verify with the two curl checks only (do **not** invite anyone: production must have zero profiles
   until the bootstrap of §12).
5. From a terminal: `ALLOWED_ORIGINS=https://app.osubb.ro`, a **new** VAPID pair ("VAPID production";
   never the staging pair), `VAPID_SUBJECT` (the platform gives `send-push`, `invite-member` and
   `csv-import` the secret key itself, from the one §4.4 made sure exists); SQL
   Editor: the two Vault rows with production's URL and secret key. The public key → `production`
   variable `VITE_VAPID_PUBLIC_KEY`.
6. **Data-processing agreements** (record each in Bitwarden with the date):
   - Supabase: organization **OSUBB → Legal documents → Data Processing Addendum** → accept.
   - Resend: `resend.com/legal/dpa` (binding on acceptance of the terms; save the PDF).
   - Cloudflare: **Manage Account → Configurations → Legal → Data Processing Addendum** (or
     `cloudflare.com/cloudflare-customer-dpa`) → accept.
     _Why:_ on 2 October OSUBB is the controller of real personal data and each vendor is a processor;
     the Privacy Notice names them.

## §8 The mapping document (#111) — Saturday 26 / Sunday 27 Sep

**Why.** The bootstrap (#112) imports the BC/BCE history row by row from your sheet; every "which column
is that?" must be answered before Thursday's dry run.

Write `docs/backend/bcbce-import-mapping.md`: each sheet column → the schema field or "dropped"; default
values; how a member's Department maps to the Group Appointment; how a grade maps to Difficulty/Rating;
what a missing value means. Commit it to `main` (docs-only commits are allowed).

## §9 First staging deploy and the real tests — Monday 28 / Tuesday 29 Sep

1. Review and merge the #110 PR. Watch **Actions**: `push-staging` → `deploy-functions-staging` →
   `deploy-web-staging`. Open `https://osubb-staging.pages.dev`.
2. Run §5.8 (`ALLOWED_ORIGINS`) and check §5.10 (a secret key exists). From the app's Administrare, invite
   your own address. Confirm in Resend
   → Emails, then sign in on your phone from the email. Install the app (Android: "Install app"; iPhone:
   Share → **Add to Home Screen**).
3. After N2 and §5.9: turn on **Notificări pe acest dispozitiv** in Profil, then run the test snippet from
   `docs/backend/push.md` in the SQL Editor and watch the phone.
4. Merge the other green PRs as they come (Wave 3 tail, Wave 4, Wave 5 leftovers, N1, N3, N4, #78). Each
   merge redeploys staging; that is expected.
5. Send the board the Privacy Notice text (`docs/legal/politica-de-confidentialitate.md`) after filling
   the placeholders at its top; ask for approval by Wednesday. Their approval is recorded in the PR that
   bumps the version to `1.0`.

## §10 Merge cut-off — Wednesday 30 Sep, end of day

Everything merged by now is the launch Release. Everything else is on Friday's open list. Do not merge
anything on Thursday except fixes found by the acceptance run.

## §11 Acceptance, production Pages project, first Release — Thursday 1 Oct

1. **Acceptance run on staging** with Dobre (ruling L17): sign in as each demo identity (anonymous,
   no-profile, inactive, ordinary, scoped Manager, BCE, BC, Moderator; demo passwords per
   `auth-config.md`); the full Task lifecycle and the two-session queue race; Calendar month view, RSVP;
   Announcements and Notifications; PWA install on Android and iPhone; push subscribe + one test
   notification; DevTools console clean; `curl -sI` on `/`, `/taskuri`, `/sw.js`, `/manifest.webmanifest`;
   Dobre invites a test address following `docs/backend/inviting.md` without your help. Write the
   result in the #36 issue.
2. **Production Pages project and token**: §1.5 again with name `github-pages-production` → Bitwarden and
   the `production` Environment; then

   ```bash
   CLOUDFLARE_API_TOKEN=<prod token> CLOUDFLARE_ACCOUNT_ID=<id> npx wrangler pages project create osubb-app --production-branch main
   ```

3. **First Release** (rehearsal on the empty database): Actions → **Release to production** → _Run
   workflow_. Read the `report` job. Take the dump even though it is empty, so the habit exists.
   _Why:_ `supabase db dump` writes the schema only unless told otherwise, so take both:

   ```bash
   npx supabase db dump --db-url "<prod pooler URL>" -f prod-2026-10-01-schema.sql
   npx supabase db dump --db-url "<prod pooler URL>" --data-only -f prod-2026-10-01-data.sql
   ```

   (keep them on an encrypted disk, delete after 30 days). Approve in the **Review deployments** banner.
   Watch `release` finish: migrations, functions, web to `osubb-app.pages.dev`, smoke checks.

4. **Custom domain**: Cloudflare → Workers & Pages → `osubb-app` → **Custom domains → Set up a custom
   domain** → `app.osubb.ro`. Cloudflare shows the CNAME target (`osubb-app.pages.dev`). **Then** cPanel
   → Zone Editor → add **CNAME** name `app`, target `osubb-app.pages.dev`. Wait until Cloudflare shows the
   domain **Active** (certificate issued; minutes to an hour). Open `https://app.osubb.ro`: the login
   screen, no certificate warning.
5. Run §7.5 if not done, then **Run workflow** again so the web build carries `VITE_VAPID_PUBLIC_KEY`.
6. `#112 --dry-run` against staging with Dobre; compare against the sheet row by row.
7. Prepare the invitation message and the one-page quickstart (Romanian): iPhone Home Screen steps
   first, then the sign-in flow (button, then code), then the Privacy Notice link.

## §12 Launch day — Friday 2 Oct

1. Morning: `npx supabase db dump …` (still empty). Run `#112` for real against production. Sign in at
   `https://app.osubb.ro` as the Moderator (yourself): the click-to-confirm page, the code path on the
   phone, install, push, one Task end to end.
2. **Go / no-go** with the open list from GitHub in front of you (ruling L15). If go:
3. Send the invitations (#36): from Administrare, one by one or via the CSV import, ≤ 80 today. Watch
   **Resend → Emails** for bounces; a bounced address is fixed with N5 (or, until N5 merges, tell the
   member to enter their correct address at the login screen only if the profile email was right).
4. Stay on call. The push health check (N2) writes you an in-app Notification if the outbox stalls;
   Resend shows deliveries; Cloudflare → `osubb-app` → Deployments shows the live version and the
   **Rollback** button next to the previous one.

## §13 Hand-over hardening — the week after

1. When `it@osubb.ro` exists: Cloudflare → Manage Account → Members → invite as **Super Administrator**;
   Supabase organization OSUBB → Team → invite as **Owner**; Resend → Team → invite as Admin. Enrol its
   2FA with an authenticator whose secret is stored in Bitwarden, so the next coordinator can sign in from
   their own phone.
2. GitHub organization: once GitHub Support restores it, issue N7.
3. Update `CLAUDE.md` status, `docs/backend/auth-config.md` (provider, cap, rate limit) and
   `docs/backend/push.md` (secret key, CI deploy).

## §14 November recruitment — decided then

Resend free = 100 emails a day; each import file ≤ 100 rows; each invitation is one email and each
later sign-in another. Either three days of ≤ 80 invitations, or **Resend → Billing → Pro** for one
month ($20). Raise **Rate Limits → Emails sent per hour** to `250` on import days and put it back after.

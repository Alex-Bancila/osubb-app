# Launch issue drafts (2026-09-25) — for Alex's go-ahead before anything reaches GitHub

Companion to `2026-09-25-launch-infrastructure-grill.md` (rulings L1–L20). **Created on GitHub on
2026-09-25 after Alex's go-ahead:** N1 = #768, N2 = #769, N3 = #770, N4 = #771, N5 = #773, N6 = #772,
N7 = #767, N8 = #766, N9 = #774, N10 = #775, N11 = #776, N12 = #777, N13 = #778; the edits below were
applied to #146, #109, #110, #78, #77, #54, #112, #36, #37 and #706 (retitles on #109, #110, #78). The
text below is the draft as approved.
After the go-ahead, the new issues are created in the order of section C, then the edits are applied, then
the umbrella #706 is updated with the real numbers. Every body below uses the house-rule-15 sections.

Labels used: `wave-6` (milestone "Wave 6 — Production launch", number 22), `shared`, `backend`, `frontend`, `ci`, `docs`, `auth`,
`page-*`, `ready-for-human`, `ready-for-agent`, `needs-info`, `after-launch`, `max-1h`.

---

## A. New issues

### N1 — Sign-in: click-to-confirm page for emailed links (`shared`, `frontend`, `auth`, `wave-6`, `ready-for-agent`)

## Goal

Emailed sign-in links no longer consume the one-time token before the Member acts. The invite, magic-link
and email-change templates link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>`;
the app page shows one button, **Conectează-mă**, and only the tap calls `supabase.auth.verifyOtp({
token_hash, type })`. The six-digit code path is unchanged.

## Why

`{{ .ConfirmationURL }}` goes to Supabase's verify endpoint, which spends the token server-side before the
app is reached. The code in the email is the **same** token. Microsoft 365 link scanning (every
`stud.ubbcluj.ro` address) can fetch that URL on delivery, leaving the Member with a dead link and a dead
code. Supabase's template docs and Resend's Supabase guide both recommend a page that requires a click.
Ruling L7 of the 2026-09-25 grill.

## What to build

- Route `/auth/confirm` (sibling of `/auth/callback`): reads `token_hash` and `type` (`invite`,
  `magiclink`, `email`, `email_change`, `recovery`), shows the OSUBB header, the address if present, one
  button; on tap calls `verifyOtp`, then follows `authDestination`. Errors use `toAuthErrorMessage`;
  expired/used token offers "Trimite alt link" back to the login screen with the email prefilled.
- `/auth/callback` keeps handling `?code=` and `#access_token=` (nothing else changes there).
- Templates `supabase/templates/invite.html`, `magic-link.html` and the change-email template: the button
  links to the new page; the code stays; copy updated ("Apasă butonul, apoi confirmă pe pagina care se
  deschide").
- `config.toml` `additional_redirect_urls` gains `/auth/confirm`; the PWA denylist gains `/auth/confirm`
  (never served from cache, same as `/auth/callback`).
- `docs/backend/auth-config.md` ("The six-digit code beside the link" section and the hosted checklist
  items 4–5), #54 and #77 checklists mention the new route.

## Implementation boundary

No change to `invite-member`, `csv-import`, `provision_profile` or any policy. No new dependency.

## Acceptance criteria

- [ ] Fetching `/auth/confirm?...` with GET (curl) creates no session; the token stays valid.
- [ ] Tapping the button signs the Member in on the device that opened the page, on all three flows.
- [ ] The six-digit code still works on the login screen.
- [ ] Local Mailpit shows the new link shape; the two curl checks in auth-config.md still pass.

## Required tests

- Vitest: the page renders without calling `verifyOtp`; the tap calls it with `token_hash` + `type`; an
  error result shows the Romanian message and the retry link; `pwa-config.test.ts` covers the denylist.
- Template lint: the three templates contain `token_hash={{ .TokenHash }}` and `{{ .Token }}` (repo check).

## Blocked by

None — can start immediately.

---

### N2 — Web Push hardening before production (`backend`, `frontend`, `page-notificari`, `wave-6`, `ready-for-agent`)

## Goal

The six operational gaps found in the 2026-09-25 research are closed so Web Push (ADR-0010) can be turned
on in production and stay on without anyone watching SQL.

## What to build

1. **Secret-key auth for cron → `send-push`.** `[functions.send-push] verify_jwt = false`; the function
   reads the `apikey` header and compares it in constant time with `SUPABASE_SECRET_KEY` (a function
   secret holding the `sb_secret_` key); any mismatch → 401. The `pg_cron` job sends the key from Vault on
   `apikey` (Vault row renamed `secret_key`). `bearerRole` and the `role`-claim check are removed.
   `docs/backend/push.md` step 3 rewritten. Tested on staging before #77 creates production's Vault row.
2. **Health check.** Hourly `pg_cron` job `osubb-push-health`: when `push_deliveries` has rows `pending`
   with `next_attempt_at < now() - interval '15 minutes'`, or more than 20 `failed` rows in 24 h, write
   one `system` Notification to the Moderator (deduped per day via `private.notify`'s key).
3. **`cron.job_run_details` purge.** Daily job keeping 14 days.
4. **Deploy from CI.** Covered by #110 (`supabase functions deploy` on merge to `main`); this issue only
   removes step 4 from `push.md` once #110 merges.
5. **App-start self-repair.** In the push subscription hook: after registration, compare
   `subscription.options.applicationServerKey` (base64url) with `VITE_VAPID_PUBLIC_KEY`; on mismatch, or
   when the Member's `push_tokens` row for this endpoint is missing while the switch is on, unsubscribe,
   resubscribe and upsert the row silently. Add a `pushsubscriptionchange` handler in `sw.ts` that
   resubscribes and posts the new subscription to the app.
6. **Canary device.** Runbook section: after each `send-push` deploy, send a test Notification to the IT
   Coordinator's installed device via the SQL snippet in `push.md`.

## Why

Legacy `service_role` JWT keys are deprecated by Supabase by the end of 2026; production must not be set
up with a key that expires within three months. Nothing alerts anyone today when the outbox stalls, and a
VAPID rotation leaves the Profil switch "on" while nothing arrives. Ruling L8.

## Implementation boundary

No change to the outbox schema, the trigger, `claim_push_deliveries`, `settle_push_delivery` or the
preferences. No vendor.

## Acceptance criteria

- [ ] A request without the exact secret key gets 401; the cron job delivers on staging with the new key.
- [ ] Stalling the outbox on staging (pause the cron job) produces the Moderator's Notification within
      an hour.
- [ ] Changing `VITE_VAPID_PUBLIC_KEY` on staging and reopening the app leaves the device subscribed
      and receiving, with a new `push_tokens` row.

## Required tests

- pgTAP: the health job exists and its query flags a stale pending row (mutation: remove the job → fail);
  the purge job exists; `secret_key` Vault name is what the cron body reads.
- Deno: `send-push` rejects a missing/wrong `apikey` and accepts the right one; no `role` parsing remains.
- Vitest: the self-repair branch resubscribes on key mismatch and on a missing row.

## Blocked by

None — can start immediately (#703, #704, #635 are merged).

---

### N3 — Security and caching headers for the deployed app (`shared`, `frontend`, `wave-6`, `ready-for-agent`)

## Goal

Every Cloudflare deployment ships a `_headers` file with a Content-Security-Policy, HSTS, framing and
referrer rules, immutable caching for hashed assets and `no-cache` for the shell, the service worker and
the manifest.

## What to build

- `app/pwa/_headers.template` (from the 2026-09-25 hosting research, §4.2) and a small Vite plugin next
  to `pwa-config.ts` that emits `_headers` at build with `__SUPABASE_HOST__` replaced by the host of
  `VITE_SUPABASE_URL`. Rules: `/*` security headers + `X-Robots-Tag: noindex`; `/assets/*`
  `public, max-age=31536000, immutable`; `/`, `/index.html`, `/sw.js`, `/manifest.webmanifest`
  `no-cache`; `/auth/*` `no-store`.
- CSP: `script-src 'self'` (the inline theme bootstrap in `index.html` moves to
  `public/theme-init.js`, loaded blocking in `<head>`, added to the precache globs);
  `style-src 'self' 'unsafe-inline'` until #699 removes Ionic, then retried without; `connect-src 'self'
https://<host> wss://<host>`; `frame-ancestors 'none'`; `object-src 'none'`.
- Shipped first as `Content-Security-Policy-Report-Only`; a checklist in the PR lists the screens to click
  on staging; a follow-up commit switches to enforcing after a clean pass.

## Why

Cloudflare Pages sets no security headers by default, and without a Cloudflare zone the HSTS toggle does
not exist; the file is the only place. A cached `sw.js` would pin members to an old bundle. Ruling L12.

## Acceptance criteria

- [ ] `curl -sI` on `/`, `/taskuri`, `/sw.js`, `/assets/<file>.js`, `/manifest.webmanifest` on staging
      shows the expected `cache-control`, CSP, HSTS and `content-type: application/manifest+json`.
- [ ] No CSP violation in DevTools across Profil, push subscribe, a Realtime notification, the sign-in
      pages.

## Required tests

- Vitest: the plugin produces the file with the staging host substituted and every rule present.
- Repo check: `index.html` contains no inline `<script>`.

## Blocked by

None — can start immediately (deploys via #110).

---

### N4 — Privacy Notice page and Privacy Acknowledgement (`shared`, `backend`, `frontend`, `page-administrare`, `wave-6`, `ready-for-agent`)

## Goal

Members can read OSUBB's Privacy Notice in the app, every Member acknowledges the current version once
before using the app, and BC can see who acknowledged which version.

## What to build

- **Backend.** `public.privacy_notice_acknowledgements(member_id, notice_version text, acknowledged_at)`,
  primary key `(member_id, notice_version)`, RLS on: a Member inserts only their own row; select for the
  Member's own rows and for `auth_level() >= 6`; no update or delete. `public.acknowledge_privacy_notice(
p_version)` (command shape per conventions; refuses a version other than the current one, which lives in
  `org_settings` key `privacy_notice_version`, BC-writable through the existing settings command).
  `public.privacy_acknowledgement_status()` returns, for level ≥ 6, every active Member with their latest
  acknowledged version and timestamp (null when none).
- **Frontend.** Route `/confidentialitate` renders `docs/legal/politica-de-confidentialitate.md`'s content
  (copied into the app as a TSX page; the markdown file stays the source of truth and the PR that changes
  the text bumps the version). Link on the login screen footer and in Profil. After sign-in, if the
  Member's latest acknowledgement is not the current version, a full-screen step shows the notice with one
  button, **Am citit și am înțeles**, and nothing else is reachable until it is tapped. Administrare:
  the member detail (#103) shows "Politica de confidențialitate: v<version> · <date>" or "neconfirmată";
  a "Confidențialitate" panel lists Members without the current version, with a count.
- The notice text is approved by the board before merge; placeholders (registration data, contact) are
  filled by Alex.

## Why

OSUBB becomes the controller of real personal data on launch day; GDPR Art. 13 requires the information,
and BC asked for a record they can see. Ruling L16 of the 2026-09-25 grill.

## Implementation boundary

An acknowledgement is not consent: nothing about a Member's data changes when they tap. No cookie banner
(the app sets no tracking cookies). No email is sent.

## Acceptance criteria

- [ ] A newly invited Member sees the notice step exactly once; after tapping, never again for that version.
- [ ] Bumping `privacy_notice_version` re-asks everyone; the old row stays.
- [ ] BC sees the list and the count; an ordinary Member cannot read others' rows (claimless sweep and
      per-role suites pass).

## Required tests

- pgTAP: RLS (self insert, no update/delete, level-6 read, claimless denied); the command refuses a stale
  version; the status function's shape; mutation of the version check must fail a named assertion.
- Vitest: the gate renders for a missing/old version and not for the current one; the panel renders the
  list.

## Blocked by

None — can start immediately (the member-detail line lands with #103 when it merges).

---

### N5 — Administrare: correct the email and re-send the invitation of a Member who never signed in (`backend`, `auth`, `page-administrare`, `wave-6`, `ready-for-agent`)

## Goal

BC/Moderator can fix a mistyped address and re-send the invitation for a Member whose
`auth.users.last_sign_in_at` is null, without deleting or re-provisioning anything.

## What to build

- Edge Function `reinvite-member` (level ≥ 6 caller, same layout as `invite-member`): given a profile id
  and an optional new email, refuses if the user has ever signed in; updates the auth user's email and
  `profiles.email` atomically when changed; calls `auth.admin.inviteUserByEmail` (or `generateLink` type
  `invite`) for the existing user; audit line in `role_history`-style history if one exists for profiles,
  else a `system` Notification to the caller.
- Administrare member detail (#103): "Retrimite invitația" with an editable email field, visible only when
  the Member has never signed in.
- Runbook `docs/backend/inviting.md`: the "invitation never arrived" procedure (check Resend log →
  correct → re-send).

## Why

`invite-member` refuses an existing profile by design (it protected members from a compensation delete).
A bounced or mistyped invitation currently has no recovery short of deleting the account. Ruling L19.

## Acceptance criteria

- [ ] Re-sending to a never-signed-in Member delivers a new invitation; the profile id is unchanged.
- [ ] A Member who has signed in is refused (409 `already_active`).

## Required tests

- Deno: refuses after sign-in; updates email then invites; never calls `deleteUser`.
- pgTAP: the email update path keeps `profiles.email` and `auth.users.email` equal (if done in SQL).

## Blocked by

- #103

---

### N6 — Operations runbook: releases, rollback, accounts (`docs`, `wave-6`, `ready-for-agent`)

## Goal

`docs/ops/release.md`: how a Release to production is started, reviewed, approved, verified and, if
needed, rolled back; the forward-fix rule; who holds which login; the per-environment one-time
configuration; the November recruitment pacing; the canary device; the Resend "never arrived" lookup.
`docs/ops/launch-runbook-2026-10.md` (written in this grill) is linked as the historical first run.

## Blocked by

- #78

---

### N7 — Transfer the repository into the OSUBB GitHub organization once recovered (`ready-for-human`, `docs`, `needs-info`, `wave-6`)

## Goal

After GitHub Support restores access to the existing OSUBB organization (proof: control of `osubb.ro`
DNS), transfer `Alex-Bancila/osubb-app` into it; re-point local clones; reinstall CodeRabbit; re-check
Environment protection rules and required reviewers; give the organization two owners; update
`CLAUDE.md`, `docs/agents/issue-tracker.md` and the README. Until then everything runs under the personal
account by ruling L4.

## Blocked by

None — waits on an external event (the recovery), not on an issue.

---

### N8 — Hand-off: apex email authentication for Google Workspace (`ready-for-human`, `wave-6`, `max-1h`)

## Goal

The Workspace admin (to be identified) adds `include:_spf.google.com` to the existing `osubb.ro` SPF
record, enables DKIM in the Workspace admin console and publishes its key, and adds `rua=` to DMARC.
Also creates `it@osubb.ro` (user or group) for the role accounts of L2/L5/L14.

## Why

Staff mail from `@osubb.ro` probably fails SPF/DKIM alignment today and is delivered only because DMARC
is `p=none`. Not app work, but found by the app's launch research and cheap to fix.

## Blocked by

None — can start immediately.

---

### After-launch (created with the label, per ruling L20)

- **N9 — Move `osubb.ro` nameservers to Cloudflare** (`after-launch`, `ready-for-human`): with the website
  and Workspace owners informed; import every record, keep DNS-only on records not ours; afterwards the
  Workers migration and Access on `app.osubb.ro` become possible.
- **N10 — Email digest of unread Notifications** (`after-launch`, `page-notificari`, `backend`): daily,
  opt-in, through Resend; competes with sign-in emails for the daily cap, hence after launch.
- **N11 — Resend bounce/complaint webhook → in-app Notification for BC** (`after-launch`, `backend`).
- **N12 — External uptime check for `app.osubb.ro` and the staging URL** (`after-launch`, `ci`).
- **N13 — Declarative Web Push payload for Safari/iOS 18.4+** (`after-launch`, `frontend`).

---

## B. Edits to existing issues (append a `## Grill of 2026-09-25` section unless stated)

### #146 — Configure a real SMTP provider

> L5: **Resend**, custom SMTP (`smtp.resend.com`, 465, user `resend`, password = a sending-only API key
> scoped to the domain), region `eu-west-1`, tracking off. Sender **`noreply@app.osubb.ro`** in both
> environments; sender name "OSUBB" in production, "OSUBB staging" on staging; one Resend team on
> `it@osubb.ro` (Alex's address until it exists); one key per environment. DNS at cyber_folks (Zone
> Editor): `resend._domainkey.app` TXT, `send.app` MX 10 `feedback-smtp.eu-west-1.amazonses.com`,
> `send.app` TXT `v=spf1 include:amazonses.com ~all`, `_dmarc.app` TXT `v=DMARC1; p=none;
rua=mailto:it@osubb.ro` — values copied from the Resend dashboard. Rate limit: 100/hour normally,
> 250/hour on recruitment days. Staging sends only to team and `resend.dev` addresses. November: three
> days of ≤ 80 invitations or one $20 month of Pro. Step-by-step: `docs/ops/launch-runbook-2026-10.md`
> §3.

### #109 — First Cloudflare Pages deploy → retitle "Cloudflare account and the staging Pages project (human)"

> L2/L3: create the Cloudflare account on Alex's `@osubb.ro` user, rename "OSUBB", 2FA, recovery codes in
> Bitwarden; later add `it@osubb.ro` as Super Administrator. Create an API token (Account › Cloudflare
> Pages › Edit) and the Pages project `osubb-staging` (production branch `main`, **Direct Upload**, no Git
> connection). Hand the token and the account id to #110. No custom domain here. Runbook §1–2.

### #110 — Pages env + preview builds → retitle "Deploy web and functions from GitHub Actions (staging + previews)"

> L3/L11/L12: GitHub Environments `preview` (any branch, `CLOUDFLARE_API_TOKEN`) and `staging` (`main`
> only; the four repository secrets moved there plus `CLOUDFLARE_API_TOKEN`; variables
> `SUPABASE_PROJECT_REF`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` = the **publishable** key,
> `VITE_VAPID_PUBLIC_KEY`); repository variable `CLOUDFLARE_ACCOUNT_ID`. Jobs in `ci.yml`:
> `deploy-web-preview` (PRs from same-repo branches; `wrangler pages deploy app/dist
--project-name=osubb-staging --branch=pr-<n>`; comment the URL on the PR), and after `push-staging`:
> `deploy-functions-staging` (`supabase functions deploy` for every function) and `deploy-web-staging`
> (`--branch=main`). README lists the URLs. Previews: sign in with the six-digit code; no invites
> (`ALLOWED_ORIGINS` exact-match). Delete the four repository-level secrets after the move.

### #78 — Gated production deploy workflow → retitle "Release to production (gated workflow)"

> L10/L11: **Release**, never "promote" (glossary). `.github/workflows/release-production.yml`,
> `workflow_dispatch` only. Job `report` (no environment): `supabase migration list` diff against
> production, changed functions since the last Release tag, the commit; writes the job summary. Job
> `release` (`environment: production`, `main` only, required reviewers Alex + Dobre): `supabase link`,
> `db push`, `functions deploy`, web build with production variables, `wrangler pages deploy app/dist
--project-name=osubb-app --branch=main`, smoke checks (`select 1` through the pooler URL, `GET
/functions/v1/send-push` → 401, `curl -sI https://app.osubb.ro/` headers, manifest content-type), then
> tags `release/<date>-<sha>`. The reviewer's local dump before approval is a runbook step, not a job.
> Blocked by: #77, #110.

### #77 — Create production project (Pro)

> L14/L16: a **new Supabase organization** owned by the role address (Alex's until then, Alex second
> owner), Pro, Frankfurt, spend cap on; note which API keys the project has. Checklist additions: SMTP
> (L5), templates incl. the click-to-confirm shape (N1), rate limit, URL configuration
> `https://app.osubb.ro` + `/auth/callback` + `/auth/confirm`, `ALLOWED_ORIGINS=https://app.osubb.ro`,
> VAPID secrets + Vault rows with the **new secret key** (N2), the three DPAs accepted (Supabase, Resend,
> Cloudflare) and recorded in Bitwarden. Then: Pages project `osubb-app`, production API token, GitHub
> Environment `production` (reviewers Alex, Dobre), custom domain in Pages **then** the `app` CNAME at
> cyber_folks. Runbook §5–7.

### #54 — Staging dashboard auth checklist

> L5/L7/L8: add SMTP (Resend, staging key, sender name "OSUBB staging"), the `/auth/confirm` redirect,
> `ALLOWED_ORIGINS=https://osubb-staging.pages.dev` after #110's first deploy, VAPID secrets and Vault
> rows with the new secret key after N2. Runbook §4.

### #112 — Production bootstrap

> L18: ships with the historical Tasks and grades per #111; `--dry-run` against staging on Thursday
> 1 October, real run Friday 2 October after the first Release. Blocked by: #111, #77 (unchanged; #602 is
> merged).

### #36 — BC/BCE onboarding

> L15/L17: go-live is no longer "Wave 5 accepted"; it is the acceptance run of ruling L17 on staging plus
> Alex's decision on 2 October. The quickstart starts with the iPhone "add to Home Screen" steps (push
> needs it) and links the Privacy Notice; the first sign-in shows the acknowledgement step (N4). Blocked
> by: #112, #78, N1, N4 (replaces #705).

### #706 — Umbrella: Wave 6

> Children add N1–N8; order: N1, N2, N3, N4 beside #110; #78 after #110 and #77; N6 after #78; N5 after
> #103; #36 after #112, #78, N1, N4. Go-live per L15: scope B, target 2 October, decision on the day.

### #37 — Org-wide rollout

> Unchanged; note the November pacing (L6) and that N4's acknowledgement list is the rollout's GDPR check.

---

## C. Creation order and dry-run commands

1. N8, N7 (no dependencies) → note numbers.
2. N1, N2, N3, N4 (no dependencies).
3. N6 (`Blocked by #78`), N5 (`Blocked by #103`).
4. N9–N13 with `after-launch`, no milestone.
5. Edits: #146, #109, #110, #78, #77, #54, #112, #36, #37; then #706 with the real numbers.

Each creation is one `gh issue create --title … --label … --milestone "Wave 6 — Production launch" --body-file <file>` run as a
single command per issue (never in a loop that could half-fail), bodies written to files under the
scratchpad first; each edit is `gh issue edit <n> --body-file` with the existing body plus the appended
section, and `gh issue edit <n> --title` where a retitle is listed.

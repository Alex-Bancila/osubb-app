# Web Push

How an in-app Notification reaches a Member's browser when the app is closed (ADR-0010, #703). The subscription side — the service worker and the **Notificări pe acest dispozitiv** switch — is #704; per-kind preferences are #635.

## How it works

1. Something writes a `notifications` row (`private.notify`, a Task command, a Fan-out). Suppression was already applied there: a row that exists is deliverable, and push never re-applies `notif_suppression`.
2. The trigger `notifications_enqueue_push` (`private.enqueue_push_deliveries`) writes one `public.push_deliveries` row per `push_tokens` row of the recipient with `platform = 'web'`. Only an **insert** enqueues: when `private.notify` refreshes an unread row through its dedupe key, the device is not buzzed again. **Per-Member preferences (#635)** are checked here and nowhere else: when the recipient has a `notification_push_preferences` row for the Notification's kind with `push_enabled = false`, and the Notification is not `critical`, no outbox row is written — the in-app row already exists and stays. No row means push is on. Only `announce`, `event` and `deadline` can be muted (`notification_push_preferences_kind_ck` refuses `task` and `system`), and a critical Announcement's Notification is written with `critical = true` by the fan-out, so it pushes regardless. `send-push` needs no change: it only ever sees rows that were enqueued.
3. Every minute the `pg_cron` job **`osubb-send-push`** checks for a due row. With none, it stops there — one index probe, no HTTP call. With one, it POSTs to `<project_url>/functions/v1/send-push` through `pg_net`, with the project's secret key (`sb_secret_…`) on the `apikey` header. Both values come from Vault (`project_url`, `secret_key`).
4. `send-push` runs with `verify_jwt = false` and authenticates the call itself (#769): the `apikey` header must equal one of the project's secret keys, compared in constant time, or it answers `401`. It reads those keys from `SUPABASE_SECRET_KEYS`, which the platform injects into every function; nothing reads a `role` claim or the legacy `service_role` JWT any more. Its own database client uses the same secret key. It claims up to 100 rows at a time with `public.claim_push_deliveries` (`for update skip locked`, so overlapping runs never send one row twice; up to 10 batches per run), encrypts `{ id, title, body, link }` for each browser subscription, signs it with VAPID, and records the answer with `public.settle_push_delivery`:

| Push service answer                     | Outcome                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `2xx`                                   | `sent`, `sent_at` stamped                                                                      |
| `404`, `410`                            | the subscription is gone: its `push_tokens` row is deleted and every outbox row of it cascades |
| `429`, `5xx`, network error             | back to `pending` 1, 2, 4, 8 minutes after attempts one to four; the fifth failure is `failed` |
| anything else (`400`/`401`/`403`/`413`) | `failed` at once, the push service's answer kept in `last_error`                               |

A claim is a five-minute lease. If the function dies between claiming and settling, the row is due again when the lease runs out (and fails with `lease_expired` if that was its fifth attempt), so nothing is lost silently. The settle quotes back the attempt number the claim returned, so a sender that stalled past its lease cannot overwrite the outcome of the run that reclaimed the row. Each push request, response included, is cut off after 20 seconds (retried like a network error), and a redirect from a push service is refused rather than followed.

5. The daily job **`osubb-prune-push-deliveries`** (03:15 UTC) deletes `sent` and `failed` rows older than seven days.
6. The hourly job **`osubb-push-health`** (`private.check_push_health()`, #769) looks for a stalled outbox: a `pending` (or lease-expired `sending`) row whose `next_attempt_at` passed more than 15 minutes ago, or more than 20 `failed` rows created in the last 24 hours. Either writes one `system` Notification, **Notificările push nu mai ajung la membri**, to every active Moderator, with both counts in its text. Its dedupe key is `push_health:<UTC date>`, so there is one unread row per day and each later run refreshes its counts in place without pushing again (read it, and the next run that still finds a problem starts a new one). It is in-app first: when push itself is what broke, the Moderator sees it in **Notificări**.
7. The daily job **`osubb-purge-cron-history`** (03:45 UTC) deletes `cron.job_run_details` rows older than 14 days. `osubb-send-push` alone writes 1,440 a day and pg_cron never deletes one.

No client can read or write `push_deliveries`: RLS is on, there is no policy, and nothing is granted to `anon`, `authenticated` or `service_role`. Only the two `security definer` functions above (executable by `service_role` alone) and the trigger touch it.

## Library

`send-push` uses [`web-push`](https://github.com/web-push-libs/web-push) (`npm:web-push@3.6.7`, pinned in `supabase/functions/deno.json`), the reference implementation, for the RFC 8291 encryption and the RFC 8292 VAPID signature only — `generateRequestDetails` — and sends the request with `fetch`. Its own `sendNotification` would go through `node:https`. It was verified end to end under `supabase functions serve` (edge runtime 1.74.3): the pg_cron job called the function through pg_net, a stand-in push service checked the VAPID signature and decrypted the payload, and the `201` / `410` / `503` answers became `sent`, a deleted token and a one-minute retry.

## Setting it up, per environment

The IT Coordinator owns all of this. Values live in Bitwarden, never in git (house rule 8).

### 1. Generate a VAPID pair (once per environment)

```bash
npx web-push generate-vapid-keys
```

It prints a **public key** and a **private key**, both base64url. Keep each environment's pair separate: a browser subscribed against one public key only accepts pushes signed with that pair's private key. Store both in Bitwarden. Changing the pair later invalidates every existing subscription — browsers must subscribe again.

### 2. Set the three function secrets

```bash
npx supabase secrets set --project-ref <ref> \
  VAPID_PUBLIC_KEY=<public key> \
  VAPID_PRIVATE_KEY=<private key> \
  VAPID_SUBJECT=mailto:it@osubb.ro
```

Run it from a real terminal (house rule 8: a non-interactive prompt can store an empty value). `SUPABASE_URL` and `SUPABASE_SECRET_KEYS` (the project's secret keys, the one `send-push` checks the caller against) are provided by the platform — there is no key to set here, and the CLI refuses any secret whose name starts with `SUPABASE_`. The project must have a secret key: Project Settings → API Keys → **API Keys** tab, create one if the list is empty. The **public** key also goes to the frontend as `VITE_VAPID_PUBLIC_KEY` (#704). A missing secret, a malformed VAPID subject or key, or a public key that does not belong to the private key makes the function answer `500` naming the setting (never its value) **before** claiming anything, so no attempt is burned.

### 3. Create the two Vault rows

In the dashboard's SQL editor (Vault is not reachable from `db push`):

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<sb_secret_ key>', 'secret_key');
```

`secret_key` is the project's **secret key** (`sb_secret_…`, Project Settings → API Keys), not the legacy JWT `service_role` key, which Supabase retires by the end of 2026 (#769, ruling L8). The job sends it on the `apikey` header; `send-push` has `verify_jwt = false` (`supabase/config.toml`) and compares it in constant time with the keys the platform gives the function, so any of the project's secret keys works and nothing else does. To rotate it: create a new secret key in the dashboard, then `select vault.update_secret((select id from vault.secrets where name = 'secret_key'), '<new key>');`, then delete the old key in the dashboard.

A project set up before #769 has a `service_role_key` row instead; nothing reads it any more, so after `secret_key` exists and a delivery has gone through, delete it: `delete from vault.secrets where name = 'service_role_key';`.

Without `project_url` the job fails every minute in which a row is due (`null value in column "url"` in `cron.job_run_details`); without `secret_key`, or with a wrong one, `send-push` answers `401` (`net._http_response`). Nothing is delivered either way — deliberately loud, and `osubb-push-health` tells the Moderator within the hour.

### 4. Deploy the function

Until #110 merges, CI deploys no function, the same as `invite-member`:

```bash
npx supabase functions deploy send-push --project-ref <ref>
```

Redeploy after any change under `supabase/functions/send-push/` or `supabase/functions/deno.json`, then run the canary check below. #110 deploys functions from CI on every merge to `main` (and the Release deploys production); this step is deleted when it merges (#769 item 4).

### 5. Give the frontend the public key

Set `VITE_VAPID_PUBLIC_KEY` = the **public** key from step 1 in the environment that builds the frontend (the Cloudflare Pages project's environment variables for that environment, #110; `app/.env.local` locally, see `app/.env.example`). It is read at build time, so rebuild after setting or changing it. Without it the app still works and the Profil switch says push is not available yet.

### 6. Canary device (after every `send-push` deploy)

The IT Coordinator keeps one device per environment with the installed app, signed in as themselves, and **Notificări pe acest dispozitiv** on — the canary. After each `send-push` deploy (by hand today, from CI once #110 merges), and after any change to the VAPID pair or the Vault rows, send it one Notification in the SQL editor:

```sql
select private.notify(
  array[(select id from public.profiles where email = '<IT Coordinator email>')],
  'system', 'Test push', 'Canary după deploy', null, null, null);

-- A minute later: sent is good; anything else is read as in "Nothing arrives" below.
select delivery.status, delivery.attempts, delivery.last_error, delivery.sent_at
  from public.push_deliveries as delivery
  join public.notifications as notification on notification.id = delivery.notification_id
 where notification.title = 'Test push'
 order by delivery.id desc limit 5;
```

The check passes when the notification shows on the canary's screen and its row is `sent`. The test Notification also stays in the in-app list; mark it read there.

## The browser side (#704)

- **Service worker.** `app/src/pwa/sw.ts`, built by vite-plugin-pwa in `injectManifest` mode, keeps the precache, the navigation fallback, the `/auth/callback` denylist and the network-only Supabase rule, and adds a `push` handler (shows `title`/`body` with the OSUBB icon, tagged `osubb-<id>`, and drops a malformed payload) and a `notificationclick` handler (focuses an open app window and navigates it to `link`, `/notificari` when there is none, or opens a new window). The tap writes nothing: marking the Notification read stays the in-app list's job.
- **The switch.** Profil → **Notificări pe acest dispozitiv** asks for permission, subscribes with `VITE_VAPID_PUBLIC_KEY` and inserts one `push_tokens` row (`platform = 'web'`, `token` = the `PushSubscription` JSON) through the self-only policies; turning it off unsubscribes and deletes that row. The switch is on only when the browser holds a subscription **and** its row exists.
- **Per-kind switches (#635).** Below the device switch, **Ce primești ca notificare push** holds one switch each for Anunțuri, Evenimente and Termene limită. They belong to the Member, not the browser, so they apply to every device; each change upserts one `notification_push_preferences` row through the self-only policies. The copy names the three that always arrive: Task Notifications, system Notifications and critical Announcements.
- **Self-repair at app start (#769).** Once per page load, after the service worker is ready, `usePushSelfRepair` (mounted in the signed-in shell) checks this device without asking anything: if push is on here — the Member's row for this browser's subscription exists, or they turned the switch on on this device (a per-Member flag in `localStorage`) — and the subscription was made with another key than `VITE_VAPID_PUBLIC_KEY`, or the row is missing, or the browser lost the subscription, it deletes the stale row, unsubscribes, subscribes again with the current key and stores the new row. So rotating the VAPID pair, or a `404`/`410` that removed a row, needs no action from Members beyond opening the app. It never runs without a granted permission (it must not prompt), and it never adopts a subscription another Member left on a shared device.
- **`pushsubscriptionchange` (#769).** When the push service expires or replaces a subscription, the service worker subscribes again (with the build's key) and posts the new subscription to every open window, which stores its row and deletes the old one. With no window open, the next app start's self-repair stores it.
- **Sign-out** deletes this device's row first (best-effort, bounded to five seconds), so a shared device stops receiving the previous Member's pushes. Sign-out and turning the switch off also clear the Member's push-on flag, so the self-repair leaves the device alone.
- **Platforms.** iOS offers Web Push only to the app added to the home screen; elsewhere the switch works from the browser tab or the installed app. A blocked permission can only be lifted in the browser's settings.

## Local development

`supabase/functions/.env` is git-ignored (`.env` in `.gitignore`). Put a locally generated pair in it:

```
VAPID_PUBLIC_KEY=…
VAPID_PRIVATE_KEY=…
VAPID_SUBJECT=mailto:it@osubb.ro
```

then `npx supabase functions serve send-push --env-file supabase/functions/.env`. For the local cron to reach it, create the Vault rows in the local database with `project_url = 'http://supabase_kong_osubb-app:8000'` (the gateway as the database container sees it) and `secret_key` = the `SECRET_KEY` (`sb_secret_…`) from `npx supabase status -o env`. `npx supabase db reset` removes both rows again. The local edge runtime injects `SUPABASE_SECRET_KEYS` just as the hosted one does, so `curl -X POST -H "apikey: <SECRET_KEY>" http://127.0.0.1:54321/functions/v1/send-push` answers `200` with the run's counts and any other `apikey` answers `401`.

## "Nothing arrives" — reading the outbox

Run in the SQL editor (as `postgres`; no API role can read the outbox):

```sql
-- The Member's devices: none means the browser never subscribed (#704), or a 404/410 removed it.
select id, platform, created_at,
       case when platform = 'web' then token::jsonb ->> 'endpoint' end as endpoint
  from public.push_tokens where member_id = '<member uuid>';

-- Their recent deliveries and what the push service answered.
select delivery.id, notification.kind, notification.title, delivery.status, delivery.attempts,
       delivery.next_attempt_at, delivery.sent_at, delivery.last_error
  from public.push_deliveries as delivery
  join public.notifications as notification on notification.id = delivery.notification_id
 where notification.member_id = '<member uuid>'
 order by delivery.id desc limit 20;

-- Is the job running, and did the function answer?
select start_time, status, return_message
  from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'osubb-send-push')
 order by start_time desc limit 10;
select created, status_code, content from net._http_response order by id desc limit 10;
```

Reading the answers:

- **No `push_deliveries` rows** for a new Notification: the Member has no `web` device, muted that kind (`select kind, push_enabled from public.notification_push_preferences where member_id = '<member uuid>'`), or the Notification was never written (check `notifications` — Suppression decides there).
- **`pending` with `attempts > 0`**: the push service is failing temporarily; `last_error` says how. It retries on its own.
- **`sending` for more than five minutes**: the function died mid-run; the next run reclaims it.
- **`failed` with `HTTP 401`/`403`**: the push service rejected the VAPID authorization. Likely causes: the browser subscribed with a different public key than the one now configured (rotate the pair and every browser must subscribe again), a `VAPID_SUBJECT` the service refuses, or a clock skew large enough to make the token look expired. A malformed or mismatched pair never gets this far: the function answers `500` naming the problem and claims nothing — see `net._http_response`. **`invalid_subscription`**: the stored token is not a usable `PushSubscription`.
- **`sent`** but nothing on screen: the push service accepted it; look at the device (notification permission, focus mode, and on iOS the app must be installed to the home screen).
- **`cron.job_run_details` shows `failed`** with a `null value in column "url"`: the Vault rows are missing. `net._http_response` with `401`: the Vault row `secret_key` is missing or is not one of the project's current secret keys (a deleted or rotated key, or the legacy `service_role` JWT). With `500` and `SUPABASE_SECRET_KEYS` in the body: the project has no secret key yet (step 2).
- **The Moderator got _Notificările push nu mai ajung la membri_**: `osubb-push-health` found deliveries overdue by more than 15 minutes (nothing is sending: the job is paused — `select jobname, active from cron.job` — or one of the two lines above) or more than 20 failures in a day (read their `last_error`; usually VAPID). Fix the cause; the backlog is sent by the next run and no new warning is written once the outbox is healthy.

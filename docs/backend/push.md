# Web Push

How an in-app Notification reaches a Member's browser when the app is closed (ADR-0010, #703). The subscription side — the service worker and the **Notificări pe acest dispozitiv** switch — is #704; per-kind preferences are #635.

## How it works

1. Something writes a `notifications` row (`private.notify`, a Task command, a Fan-out). Suppression was already applied there: a row that exists is deliverable, and push never re-applies `notif_suppression`.
2. The trigger `notifications_enqueue_push` (`private.enqueue_push_deliveries`) writes one `public.push_deliveries` row per `push_tokens` row of the recipient with `platform = 'web'`. Only an **insert** enqueues: when `private.notify` refreshes an unread row through its dedupe key, the device is not buzzed again.
3. Every minute the `pg_cron` job **`osubb-send-push`** checks for a due row. With none, it stops there — one index probe, no HTTP call. With one, it POSTs to `<project_url>/functions/v1/send-push` through `pg_net`, with the service-role key as bearer. Both values come from Vault.
4. `send-push` refuses any bearer whose `role` claim is not `service_role` (`401`). It claims up to 100 rows at a time with `public.claim_push_deliveries` (`for update skip locked`, so overlapping runs never send one row twice; up to 10 batches per run), encrypts `{ id, title, body, link }` for each browser subscription, signs it with VAPID, and records the answer with `public.settle_push_delivery`:

| Push service answer                     | Outcome                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `2xx`                                   | `sent`, `sent_at` stamped                                                                      |
| `404`, `410`                            | the subscription is gone: its `push_tokens` row is deleted and every outbox row of it cascades |
| `429`, `5xx`, network error             | back to `pending` 1, 2, 4, 8 minutes after attempts one to four; the fifth failure is `failed` |
| anything else (`400`/`401`/`403`/`413`) | `failed` at once, the push service's answer kept in `last_error`                               |

A claim is a five-minute lease. If the function dies between claiming and settling, the row is due again when the lease runs out (and fails with `lease_expired` if that was its fifth attempt), so nothing is lost silently. The settle quotes back the attempt number the claim returned, so a sender that stalled past its lease cannot overwrite the outcome of the run that reclaimed the row. Each push request, response included, is cut off after 20 seconds (retried like a network error), and a redirect from a push service is refused rather than followed.

5. The daily job **`osubb-prune-push-deliveries`** (03:15 UTC) deletes `sent` and `failed` rows older than seven days.

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

Run it from a real terminal (house rule 8: a non-interactive prompt can store an empty value). `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by the platform. The **public** key also goes to the frontend as `VITE_VAPID_PUBLIC_KEY` (#704). A missing secret, a malformed VAPID subject or key, or a public key that does not belong to the private key makes the function answer `500` naming the setting (never its value) **before** claiming anything, so no attempt is burned.

### 3. Create the two Vault rows

In the dashboard's SQL editor (Vault is not reachable from `db push`):

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<service_role key>', 'service_role_key');
```

`service_role_key` is the **legacy JWT** `service_role` key (Project Settings → API). The gateway verifies it (`verify_jwt = true`) and the function reads its `role` claim; a non-JWT secret key would be refused at the gateway. To rotate either value: `select vault.update_secret((select id from vault.secrets where name = 'service_role_key'), '<new key>');`.

Without these rows the job fails every minute in which a row is due (`null value in column "url"` in `cron.job_run_details`) and nothing is delivered — deliberately loud.

### 4. Deploy the function

CI deploys no function, the same as `invite-member`:

```bash
npx supabase functions deploy send-push --project-ref <ref>
```

Redeploy after any change under `supabase/functions/send-push/` or `supabase/functions/deno.json`.

## Local development

`supabase/functions/.env` is git-ignored (`.env` in `.gitignore`). Put a locally generated pair in it:

```
VAPID_PUBLIC_KEY=…
VAPID_PRIVATE_KEY=…
VAPID_SUBJECT=mailto:it@osubb.ro
```

then `npx supabase functions serve send-push --env-file supabase/functions/.env`. For the local cron to reach it, create the Vault rows in the local database with `project_url = 'http://supabase_kong_osubb-app:8000'` (the gateway as the database container sees it) and `service_role_key` = the `SERVICE_ROLE_KEY` from `npx supabase status -o env`. `npx supabase db reset` removes both rows again.

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

- **No `push_deliveries` rows** for a new Notification: the Member has no `web` device, or the Notification was never written (check `notifications` — Suppression decides there).
- **`pending` with `attempts > 0`**: the push service is failing temporarily; `last_error` says how. It retries on its own.
- **`sending` for more than five minutes**: the function died mid-run; the next run reclaims it.
- **`failed` with `HTTP 401`/`403`**: the browser subscribed with a different public key than the one configured (a malformed or mismatched pair never gets this far: the function answers `500` naming the problem and claims nothing — see `net._http_response`). **`invalid_subscription`**: the stored token is not a usable `PushSubscription`.
- **`sent`** but nothing on screen: the push service accepted it; look at the device (notification permission, focus mode, and on iOS the app must be installed to the home screen).
- **`cron.job_run_details` shows `failed`** with a `null value in column "url"`: the Vault rows are missing. `net._http_response` with `401`: the Vault key is not the `service_role` JWT.

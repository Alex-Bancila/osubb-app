# Email delivery problems

Every account starts from an emailed link, so an invitation that bounces is a Member who never gets in. Until #776 the only way to find one was to search the Resend log after someone noticed. Now Resend tells the app itself: a bounce, a spam complaint or a suppression becomes an in-app **system** Notification for BC and the Moderator, naming the Member and linking to their page in Administrare, where **Retrimite invitația** fixes the address (`docs/backend/inviting.md` § "The invitation never arrived"). The Resend dashboard stays the full log. Ruling L20 of `docs/superpowers/plans/2026-09-25-launch-infrastructure-grill.md` deferred this to after launch.

## How it works

1. Resend POSTs every subscribed event to the Edge Function **`resend-webhook`**, signed the Svix way: headers `svix-id`, `svix-timestamp` and `svix-signature`, the last holding one or more `v1,<base64>` HMAC-SHA256 signatures over `<svix-id>.<svix-timestamp>.<raw body>`, keyed with the base64 part of the endpoint's signing secret (`whsec_…`).
2. The function reads at most **64 KB** of body. A declared or streamed body past that is answered `413` without computing anything, so an unsigned sender cannot make it hash megabytes. Resend's email events are a few kilobytes.
3. The function has `verify_jwt = false` (`supabase/config.toml`): Resend sends no Supabase token, so the signature is the whole authentication. The function recomputes it with the function secret **`RESEND_WEBHOOK_SECRET`** and compares in constant time. A missing header, a wrong signature, a body changed after signing, or a `svix-timestamp` more than **5 minutes** from now (either way) is answered `401` before the body is even parsed, and nothing is written.
4. For the three handled events it calls `public.notify_email_delivery_problem(svix-id, email, event, reason)` once per recipient address, with its database client built from the project's secret key (`SUPABASE_SECRET_KEYS`, provided by the platform; #796). That function is executable by `service_role` alone.
5. **Once per delivery.** The database first records the pair (`svix-id`, address) in `private.resend_webhook_deliveries` and writes nothing when the pair is already there. That covers a request replayed inside the 5-minute window, and a Resend retry that lands on another day, which the per-day key below would let through. One event can name several recipients, so each address is its own record. Records older than seven days are purged on the way in; Resend stops retrying after about a day and a half.
6. The database maps the address to a `profiles` row, case-insensitively, and writes one `system` Notification to every live active Member at level ≥ 6 (BC and the Moderator) through `private.notify`, linking to `/administrare/membri/<member id>`. The dedupe key is `email_delivery:<address>:<Bucharest date>`, and a recipient who already holds it, read or not, is skipped, so a given address produces **at most one Notification per recipient per day**. The first event of the day wins; a bounce followed minutes later by the suppression it caused does not notify twice. An address no profile carries (a Resend test address, a typo that was never a Member) writes nothing and is not an error.
7. The function answers `200 {"notified": n}`, the number of Notifications written (`0` for a delivery already acted on, an unknown address or one already reported today). Any other event type gets `200 {"notified": 0, "ignored": "<type>"}`. A non-2xx answer would only make Resend retry an event there is nothing to do with. A database failure answers `500`, and Resend retries (immediately, then after 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h). A retry is safe: a database failure rolls the delivery record back with everything else, and a delivery that did land is recorded. Resend delivers at least once, so the same event can arrive twice anyway.

| Resend event       | Notification title             | What it means                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email.bounced`    | `Email respins: <name>`        | The receiving server rejected the email. Resend's `bounce.type`/`subType` and message are appended. Check the type before treating the address as bad: `Permanent` means a typo or a closed mailbox, while `Transient` or `Undetermined` can clear up by itself. |
| `email.complained` | `Email marcat ca spam: <name>` | The email was delivered and the recipient marked it as spam. Later invitations and sign-in links may stop arriving.                                                                                                                                              |
| `email.suppressed` | `Email blocat: <name>`         | Resend did not send at all: the address is on its suppression list after an earlier bounce or complaint. Resend's `suppressed.type` and message are appended.                                                                                                    |

**Deliberately not handled:** `email.failed` (a sending error on our side, such as an invalid key or a quota, not a bad address), `email.delivery_delayed` (temporary, and Resend keeps trying), and the delivery, open and click events. Subscribe the endpoint to the three events above only. Anything else sent to it is ignored anyway.

## Setting it up, per environment

The IT Coordinator does this once per environment, staging first. Values live in Bitwarden, never in git (house rule 8).

1. **Resend → Webhooks → Add Webhook.** Endpoint URL `https://<project ref>.supabase.co/functions/v1/resend-webhook` (the staging or the production ref). Events: `email.bounced`, `email.complained`, `email.suppressed`. Save. _Why one endpoint per environment:_ each project has its own members, and each endpoint gets its own signing secret.
2. **Copy the endpoint's signing secret** (`whsec_…`, shown on the webhook's page) into Bitwarden as "Resend webhook secret – staging" (or "– production").
3. **Set it as a function secret**, from a real terminal (a non-interactive prompt can store an empty value):

   ```bash
   npx supabase secrets set --project-ref <ref> RESEND_WEBHOOK_SECRET=whsec_…
   ```

   Functions read secrets at request time, so no redeploy is needed. Until it is set, the function answers `500` naming `RESEND_WEBHOOK_SECRET` (never its value), and Resend keeps retrying. The function itself is deployed with the rest, by CI on every merge (staging) and by the Release (production).

4. **Check it**, below.

**Both endpoints see both environments' mail.** One Resend team sends for staging and production from the same domain (ruling L5), and a Resend webhook has a URL and a list of events, with no filter by API key. So production's endpoint also receives staging's bounces, and the other way round. That is harmless: each project only knows its own members' addresses, and an unknown address writes nothing. An address that belongs to a Member in both projects is equally broken in both.

To rotate the secret: Resend → the webhook → rotate the signing secret, then run step 3 again with the new value within 24 hours. _Why the deadline:_ for 24 hours after a rotation Resend signs every request with both the old and the new secret, and the function accepts a request when any listed `v1` signature matches the one it holds, so nothing is refused while you switch. Miss the window and requests are refused (`401`) until the new value is set. Resend retries them, and a delivery that ran out of retries can be replayed from the webhook's page.

## Checking it works (staging, ~5 minutes)

Resend's test address `bounced@resend.dev` always hard-bounces, and staging is allowed to send to `resend.dev` addresses (ruling L5).

1. On staging, signed in as a BC or Moderator account, invite a throwaway Member with the address `bounced@resend.dev` (Administrare → invite, or `invite-member`; `docs/backend/inviting.md`). _Why an invited Member and not Resend's "send test email":_ the Notification names a Member, so the address has to belong to one. A test send to an address no profile carries reaches the function and is correctly ignored.
2. Within a minute, **Notificări** shows `Email respins: <name>`, linking to that Member's Administrare page. Resend → Webhooks → the endpoint shows the delivery answered `200` with `{"notified": n}`.
3. A second invitation to the same address the same day produces no second Notification (`{"notified": 0}` in Resend's delivery log).
4. Deactivate the throwaway Member afterwards.

A request without a valid signature is refused and writes nothing:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "https://<ref>.supabase.co/functions/v1/resend-webhook" \
  -H 'Content-Type: application/json' \
  -H 'svix-id: msg_test' -H "svix-timestamp: $(date +%s)" \
  -H 'svix-signature: v1,bm90IGEgc2lnbmF0dXJl' \
  -d '{"type":"email.bounced","data":{"to":["bounced@resend.dev"]}}'
# → 401
```

Locally, mail never reaches Resend (Mailpit catches it), so there is no webhook to receive. The function's behaviour is covered by `supabase/functions/resend-webhook/handler.test.ts` (signature, timestamp tolerance, each event, ignored events) and the database side by `supabase/tests/email_delivery_notifications.test.sql` (mapping, recipients, dedupe, unknown address, grants).

## The daily Email Digest (#775)

A Member who turns on **Rezumat zilnic pe email** in Profil gets, at most once a day, one email listing the in-app Notifications they have not read, each with a link into the app. It is off by default. Ruling L20 of the launch grill deferred it to after launch because every digest competes with sign-in emails for Resend's daily cap.

### How the digest works

1. **The switch.** Profil → **Rezumat zilnic pe email** upserts the Member's row in `public.notification_email_preferences` (`digest_enabled`, self-only RLS, no row means off). Every digest ends with a line linking to `/profil#rezumat-email`, which opens that switch: turning it off is the one-click opt-out. A link opened without a session goes through the login screen and lands there afterwards.
2. **The selection, at 07:00 Bucharest.** The `pg_cron` job **`osubb-email-digest`** runs every hour (`0 * * * *`), and its body, `private.prepare_email_digests()`, reads the Bucharest clock, so 07:00 stays 07:00 across the summer-time change. At 07:00 it writes one row in the outbox `private.email_digests` for every Member who has the switch on, an `activ` Profile and at least one Notification that is **unread, older than one hour and never digested before**, and stamps those Notifications `digested_at`. So each Notification is emailed at most once, and a Member gets **at most one digest per Bucharest day** (a unique key on Member and day). A Member whose earlier digest is still waiting gets no second one until it is gone.
3. **The call.** Between 07:00 and 21:59 Bucharest, whenever a digest is due and today's quota is not spent, the job POSTs to the Edge Function **`send-digest`** with the Vault row `secret_key` on the `apikey` header, exactly like `osubb-send-push` (`docs/backend/push.md`). `send-digest` has `verify_jwt = false` and compares the key in constant time. Nothing is sent at night.
4. **The quota guard.** `send-digest` claims digests with `public.claim_email_digests`, which never hands out more than **`email_daily_quota` minus the digests sent (or being sent) since 00:00 UTC**, the day Resend counts in. The claim takes the quota row's lock, so two overlapping runs cannot spend the same slot. Whatever the quota holds back stays pending and goes out the next morning. At claim time it also re-checks each digest: a Member who turned the switch off (the same day included), was deactivated, or has read every Notification in it is skipped, and no email leaves.
5. **The email.** Romanian, plain text plus HTML: "Ai N notificări necitite", then one line per Notification (title, Bucharest time, the start of its text, its link; at most the 20 newest, with "Și încă M în aplicație" for the rest), a button to `/notificari` and the opt-out line. Every title, text and Nickname is HTML-escaped, and a stored link that would leave the app opens `/notificari` instead. It is sent through the Resend API (`POST https://api.resend.com/emails`) from `EMAIL_FROM`, with the `Idempotency-Key` `osubb-digest-<id>`, so Resend never accepts the same digest twice.
6. **The outcome**, recorded with `public.settle_email_digest`:

| Resend answer                                               | Outcome                                                                                            |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `2xx`                                                       | `sent`; Resend's email id kept as `provider_id`                                                    |
| `429` `daily_quota_exceeded` / `monthly_quota_exceeded`     | back to `pending` for 07:00 the next day, the attempt not counted; the rest of the run is deferred |
| `401`, `403` (a wrong key, or a sender domain not verified) | the same, and the function answers `502`                                                           |
| `429` rate limit, `5xx`, network error                      | retried one hour, then two hours later; the third failure is `failed`                              |
| `409` (Resend's idempotency guard)                          | `sent` without a `provider_id`: an earlier attempt already reached Resend, so the slot stays spent |
| anything else (`400`, `422` a bad address)                  | `failed` at once, Resend's answer kept in `last_error`                                             |

The 07:00 run deletes finished digests (`sent`, `failed`, `skipped`) older than 30 days.

### Setting up the digest, per environment

The IT Coordinator does this once per environment, staging first. Values live in Bitwarden, never in git (house rule 8).

1. **Resend API key.** Resend → API Keys → create a **sending-only** key scoped to the `app.osubb.ro` domain for this environment (ruling L5), store it in Bitwarden as "Resend API key – staging" (or "– production"), then, from a real terminal:

   ```bash
   npx supabase secrets set --project-ref <ref> RESEND_API_KEY=re_…
   ```

2. **Sender.** Production uses the default, `OSUBB <noreply@app.osubb.ro>`. Staging sets its own name (ruling L5):

   ```bash
   npx supabase secrets set --project-ref <ref> "EMAIL_FROM=OSUBB staging <noreply@app.osubb.ro>"
   ```

3. **App origin.** The links use the **first `ALLOWED_ORIGINS` entry**, which must be the app's `https` origin (already set for `invite-member`, `docs/backend/inviting.md`).
4. **Vault rows.** `project_url` and `secret_key`, the same two rows `osubb-send-push` reads (`docs/backend/push.md`, step 3). Nothing new to create.
5. **Quota.** The organization setting **`email_daily_quota`** is seeded `90`: Resend's free plan allows 100 emails a day for the whole team, and invitations and sign-in links need the rest. BC or the Moderator changes it with `public.set_org_setting('email_daily_quota', '<n>')`: a whole number 0–99999, never empty; `0` pauses the digest. On a paid Resend plan without a daily cap, raise it.

Until `RESEND_API_KEY` is set, or while `ALLOWED_ORIGINS` has no `https` origin first, `send-digest` answers `500` naming the setting (never its value) before claiming anything, so no attempt is burned. The function is deployed with the rest, by CI on every merge (staging) and by the Release (production).

### Checking the digest works (staging)

1. Sign in as a team account whose address Resend may send to from staging (a team address, ruling L5), turn on **Rezumat zilnic pe email**, and leave a Notification unread for more than an hour.
2. Instead of waiting for 07:00, in the SQL editor, write the digest the 07:00 run would write, then call the function the way the job does:

   ```sql
   select private.enqueue_email_digests(now());
   select net.http_post(
     url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-digest',
     headers := jsonb_build_object('apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')),
     body := '{}'::jsonb);
   ```

3. The email arrives. Then read the outbox and the function's answer:

   ```sql
   select id, member_id, digest_day, status, attempts, next_attempt_at, last_error, provider_id, sent_at
     from private.email_digests order by id desc limit 10;
   select created, status_code, content from net._http_response order by id desc limit 5;
   ```

   `pending` with `next_attempt_at` at 07:00 tomorrow and `last_error` `provider_quota` or `provider_auth` means Resend refused on quota or on the key; `skipped` names why (`opted_out`, `member_inactive`, `nothing_unread`). A `401` in `net._http_response` is the Vault `secret_key`; a `500` names the missing setting.

The function is covered by `supabase/functions/send-digest/render.test.ts` (text, links, escaping) and `handler.test.ts` (auth, the quota guard, each Resend answer); the database side by `supabase/tests/email_digest.test.sql` (the preference's RLS, the selection, the quota guard and its race, settle, the job's hours, the setting, grants).

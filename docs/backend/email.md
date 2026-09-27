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

   Functions read secrets at request time, so no redeploy is needed. Until it is set, the function answers `500 {"code":"configuration"}` and Resend keeps retrying; the function's log (**Edge Functions → resend-webhook → Logs**) names `RESEND_WEBHOOK_SECRET` (never its value). The body names nothing: it reaches unsigned callers too (security pass L4). The function itself is deployed with the rest, by CI on every merge (staging) and by the Release (production).

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

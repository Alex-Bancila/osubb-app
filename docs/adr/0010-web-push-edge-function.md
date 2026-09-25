# ADR-0010 — Web Push through a Supabase Edge Function

- **Status:** Accepted
- **Date:** 2026-09-23
- **Deciders:** Alex Băncilă (ruling R21 of the 2026-09-23 production-readiness grill)
- **Supersedes:** the open provider comparison in ADR-0005 §Push notifications
- **Superseded by:** —
- **Amended:** 2026-09-25 — re-examined against OneSignal, FCM, Novu, Knock, Courier, MagicBell, Pusher Beams and a Cloudflare Worker sender and kept (ruling L8 of `docs/superpowers/plans/2026-09-25-launch-infrastructure-grill.md`); the cron-to-function authentication changes and six hardening items are added; see the notes below
- **Related:** ADR-0001, ADR-0002, ADR-0005, #703 (outbox and `send-push`), #704 (service worker and device subscription), #635 (per-Member push preferences), `CONTEXT.md`

## Context

In-app Notifications already exist: `notifications` rows are written by `private.notify`, the Task commands and the Fan-outs, and Suppression is applied where those rows are written — `notif_suppression` mutes BC and BCE for broadcast `task`, `event` and `deadline` kinds, while direct Notifications about a Member's own work always arrive. Nothing reaches a device that is not looking at the app.

`push_tokens(member_id, token, platform)` exists with self-only select/insert/delete policies (#66) and no writer. `pg_cron` is installed (#69) and runs the daily deadline reminders. The Edge Functions `invite-member` and `csv-import` set the layout and test pattern for a function. The PWA registers a `vite-plugin-pwa` service worker in `generateSW` mode, and ADR-0002 reserved the move to `injectManifest` for the day Web Push needs a custom handler.

ADR-0005 deferred browser push until after the Task Tracker and Calendar and asked for a comparison of a Cloudflare Worker/Queue, a Supabase Edge Function and an external provider. This ADR closes that comparison.

## Decision

**Provider.** Web Push is delivered by a Supabase Edge Function, `send-push`, speaking the standard Web Push protocol signed with VAPID. The VAPID pair and subject (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, a `mailto:` osubb.ro address) are function secrets per environment, kept in Bitwarden for humans; only the public key reaches the frontend (`VITE_VAPID_PUBLIC_KEY`). No external push provider is used.

**Outbox.** `public.push_deliveries` is the outbox of unsent Notifications × `push_tokens` rows with `platform = 'web'`. An `after insert` trigger on `notifications` writes one row per device of the recipient. No client reads or writes it: RLS on, no policy, nothing granted.

**Schedule.** A `pg_cron` job runs every minute and, only when a pending row is due, calls the function through `pg_net` with the service-role key; the project URL and key are read from Vault, never from git. The function accepts only a `service_role` bearer and claims a batch with `for update skip locked`, so overlapping runs never send the same row twice.

> **Amended 2026-09-25 (L8).** The legacy JWT `service_role` key is deprecated by Supabase by the end of 2026, so the call authenticates with the project's **secret key** (`sb_secret_…`) sent on the `apikey` header; `send-push` runs with `verify_jwt = false` and compares the header with its `SUPABASE_SECRET_KEY` function secret in code. The Vault row is `secret_key`. The `role`-claim check is removed. Tested on staging before production's Vault row is created.

**Retries and dead tokens.** `200`/`201` marks a row sent. `429`, `5xx` and network errors retry with exponential backoff — 1, 2, 4 and 8 minutes after attempts one to four — and the fifth failed attempt marks the row `failed`. `404` and `410` mean the subscription is gone: the `push_tokens` row is deleted and its outbox rows cascade. `400`/`401`/`403` (a VAPID or payload fault) fail at once with the response recorded. A daily job prunes `sent` and `failed` rows older than seven days.

**Deduplication.** The in-app row is the unit of delivery. `private.notify`'s dedupe upsert of an unread row refreshes its text in place and does not push again; only an insert enqueues.

**Suppression and preferences.** `notif_suppression` is honoured by construction — a `notifications` row exists only if the Fan-out decided it was deliverable — and is never re-applied at push time, which would silence BC's direct Task Notifications. The only push-time filter is #635's per-Member preferences, checked inside the enqueue trigger: a muted kind keeps its in-app row and writes no outbox row.

**Privacy.** The payload carries the Notification's `id`, `title`, `body` and `link` and nothing else. A subscription is stored as the `PushSubscription` JSON in `push_tokens.token`, readable only by its Member, and deleted when the Member turns the device off or signs out on it.

**Service worker.** The existing worker migrates to `injectManifest` with a `src/pwa/sw.ts` that keeps today's precache, navigation fallback, `/auth/callback` denylist and network-only Supabase rule, and adds a `push` handler that shows the notification with the OSUBB icon and a `notificationclick` handler that focuses or opens the app at its `link` (`/notificari` when null).

**Operations.** The IT Coordinator owns the VAPID pair, the function secrets and the two Vault rows per environment. Functions are deployed by hand per environment (`supabase functions deploy send-push`), as `invite-member` is today. The cost is zero beyond the Supabase plan.

> **Amended 2026-09-25 (L8, L12).** Functions are deployed from CI: on every merge to `main` for staging, and inside the gated Release for production. Before production, five more hardening items land: an hourly `pg_cron` health check that writes a `system` Notification to the Moderator when the outbox has stale `pending` rows or too many `failed` rows; a daily purge of `cron.job_run_details`; an app-start self-repair that re-subscribes when the stored subscription's key differs from `VITE_VAPID_PUBLIC_KEY` or the `push_tokens` row is gone, plus a `pushsubscriptionchange` handler; and a canary device per environment in the runbook. Alternatives re-examined and rejected on 2026-09-25: every vendor adds a data processor receiving member identifiers and plaintext text, removes no per-environment step, and either offers no EU/DPA option on a free plan or no iOS web push; Cloudflare has no push product.

### Alternatives rejected

- **Cloudflare Worker + Queue.** Workable, but a second platform to operate, deploy and hold secrets for, reading a database it does not own; the outbox and scheduler already live in Postgres.
- **An external provider (OneSignal or similar).** Hands member identifiers and notification content to a vendor in exchange for segmentation, analytics and native SDKs that OSUBB does not need.

## Consequences

- **Positive:** push rides the existing Notification rows, RLS, Suppression and `pg_cron`; one platform, one secret path, no new vendor or data processor.
- **Positive:** delivery state is inspectable with SQL, and the outbox survives function or push-service outages through retries.
- **Cost:** up to a minute of latency from the cron cadence, and one `select` per idle minute.
- **Cost:** per environment, someone must generate the VAPID pair, set the three function secrets, create the `project_url` and `service_role_key` Vault rows, and deploy `send-push`. The production checklist (#77) carries this as one line; `docs/backend/push.md` (#703) is the runbook.
- **Platform limits:** iOS delivers Web Push only to the app installed on the home screen; Android and desktop browsers deliver from the installed or the open app.
- **Work that follows:** #703 builds the outbox, trigger, claim/settle functions, cron jobs, `send-push` and the runbook; #704 migrates the service worker and adds the **Notificări pe acest dispozitiv** switch on Profil; #635 adds per-kind preferences on top of both.

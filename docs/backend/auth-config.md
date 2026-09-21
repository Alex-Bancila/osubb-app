# Auth configuration

Every authentication setting, what it renders to, and why it is the way it is. Verified against the running local stack on 2026-08-23 by reading the GoTrue container's environment — the "renders to" column is measured, not assumed.

Local settings live in `supabase/config.toml`. **Hosted projects do not read that file**: staging and production are configured in the dashboard, one project at a time (#54 for staging, #77 for production). The two must agree, and this table is what to check them against.

## The settings

| `config.toml`                             | Value                                                          | Renders to                                       | Why                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `[auth] enabled`                          | `true`                                                         | —                                                | Auth is on.                                                                                                                                                                                                                                                                                      |
| `[auth] site_url`                         | `http://localhost:5173`                                        | `GOTRUE_SITE_URL`                                | Where a magic link sends the member back — the Vite dev server. Must become the real app URL once the frontend deploys (#109).                                                                                                                                                                   |
| —                                         | —                                                              | —                                                | The moment `site_url` changes to the hosted app origin, the `invite-member` Edge Function's `ALLOWED_ORIGINS` secret must be set to that same origin — see "CORS: who is allowed to call this function from a browser" in `docs/backend/inviting.md` for the `npx supabase secrets set` command. |
| `[auth] additional_redirect_urls`         | the dev server + `/auth/callback`, both spellings of localhost | `GOTRUE_URI_ALLOW_LIST`                          | Every URL a link may return to. GoTrue refuses anything not on it, so a link to an unlisted origin silently falls back to `site_url` and the sign-in appears to do nothing. Keep it short and exact: it is the defence against open-redirect abuse.                                              |
| `[auth] jwt_expiry`                       | `3600`                                                         | `GOTRUE_JWT_EXP`                                 | One hour. This is also the **deactivation window**: a member set to `inactiv` keeps their claims until this expires (ADR-0003 amendment).                                                                                                                                                        |
| `[auth] enable_refresh_token_rotation`    | `true`                                                         | `GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED` | A refresh token is single-use; reuse signals theft.                                                                                                                                                                                                                                              |
| `[auth] refresh_token_reuse_interval`     | `10`                                                           | —                                                | Ten seconds of grace, so a double-tap or a flaky network doesn't log someone out.                                                                                                                                                                                                                |
| **`[auth] enable_signup`**                | **`false`**                                                    | **`GOTRUE_DISABLE_SIGNUP=true`**                 | **This is what makes the app invite-only** (ADR-0003). Nobody can self-register; accounts exist only through the BC invite.                                                                                                                                                                      |
| `[auth] enable_manual_linking`            | `false`                                                        | `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED`         | Members cannot attach arbitrary identities to their account by hand. Member sign-in uses magic links only (ADR-0003); no alternate-provider linking flow is offered.                                                                                                                             |
| `[auth.hook.custom_access_token] enabled` | `true`                                                         | `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED`        | Stamps `member_role`, `member_level`, `dept_ids`, `team_ids`, `group_ids` into the token. **Every RLS policy reads these** — without the hook, tokens carry no claims and every screen is empty.                                                                                                 |
| **`[auth.email] enable_signup`**          | **`true`**                                                     | **`GOTRUE_EXTERNAL_EMAIL_ENABLED=true`**         | **Whether the email provider exists at all.** See the trap below.                                                                                                                                                                                                                                |
| `[auth.email] enable_confirmations`       | `true`                                                         | `GOTRUE_MAILER_AUTOCONFIRM=false`                | An address must be confirmed by clicking its link — which is exactly what the invite flow does anyway.                                                                                                                                                                                           |
| `[auth.email] double_confirm_changes`     | `true`                                                         | `GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED`      | Changing an email confirms at both the old and new address, so a hijacked session cannot quietly move the account.                                                                                                                                                                               |
| `[auth.external.google] enabled`          | `false`                                                        | `GOTRUE_EXTERNAL_GOOGLE_ENABLED=false`           | Disabled by the accepted magic-link-only design (ADR-0003, #204); #55 was closed as not planned.                                                                                                                                                                                                 |
| `[functions.invite-member] verify_jwt`    | `true`                                                         | —                                                | The gateway rejects unauthenticated calls; the function still does the real check (level ≥ 6, read from the database).                                                                                                                                                                           |

## The trap: two keys named `enable_signup`

They look alike and mean opposite things.

```toml
[auth]
enable_signup = false        # invite-only: nobody self-registers.  KEEP FALSE.

[auth.email]
enable_signup = true         # the email PROVIDER exists at all.    KEEP TRUE.
```

`[auth].enable_signup` → `GOTRUE_DISABLE_SIGNUP`. That is the invite-only guarantee.

`[auth.email].enable_signup` → `GOTRUE_EXTERNAL_EMAIL_ENABLED`. Setting it to `false` disables **email entirely** — magic links, invitations and every login fail with _"Email logins are disabled"_.

The repo was in exactly that state until 2026-08-23 (fixed in PR #127). Nothing looked wrong: `db reset` was green, all tests passed, and the config _read_ as though it were the stricter, safer choice. It would have surfaced on the day someone sent the first real invitation.

If you ever "tighten" auth, verify both, and verify them by their effect:

```bash
# provider on?  signup off?
docker inspect supabase_auth_osubb-app --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E "EXTERNAL_EMAIL_ENABLED|DISABLE_SIGNUP"
```

## Verifying the whole thing works

Two commands, both of which must behave as written:

```bash
# 1 · self-registration is refused — invite-only is intact
curl -s -X POST "$SUPABASE_URL/auth/v1/signup" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"strain@example.com","password":"parola123"}'
# → 422 signup_disabled

# 2 · an existing member signs in and their token carries claims
curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"bc@demo.osubb","password":"parola123"}'
# → access_token whose app_metadata has member_role / member_level / dept_ids / group_ids
```

If (1) succeeds, the app is not invite-only. If (2) fails with _"Email logins are disabled"_, the provider is off. If (2) succeeds but `app_metadata` has no `member_role`, the **claims hook is not enabled** — the app will look empty for everyone, and that is the single most confusing failure in this system.

## Hosted projects

`config.toml` never leaves your machine. On staging and production the same four things must be set by hand, in Authentication:

1. **Email provider: enabled**
2. **Allow new users to sign up: OFF**
3. **Hooks → Customize Access Token (JWT) Claims: enabled**, pointing at `public.custom_access_token_hook`
4. **URL Configuration**: Site URL + redirect URLs matching the deployed app

Checklists: **#54** (staging) and **#77** (production). Run the two curl checks above against the hosted URL afterwards — the settings page can say the right thing while the behaviour differs, and only the behaviour matters.

## Related

- `docs/adr/0003-invite-only-auth.md` — why invite-only, and what deactivation means
- `docs/backend/inviting.md` — the BC runbook for creating accounts
- `supabase/migrations/20260819163238_jwt_claims_hook.sql` — the hook itself

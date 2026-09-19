# Routing browser verification — #193

Verified 2026-09-19 against the configured production build of #545, commit
`34b14d9`. This PR stacks on #545 because the original browser check found that
signed-out deep links discarded their destination; #537 records that defect.
The fix belongs to #545, while this PR contains verification evidence only.

## Method

Chromium headless with Playwright, at 1280×900 and 390×900 CSS pixels. The real
application, guards, React Router, navigation components and Supabase client ran.
Deterministic browser storage supplied signed-out, authenticated/no-profile,
Voluntar and BC sessions; network interception supplied public fixture data.
The OTP request was intercepted rather than sending an email. Service workers
were blocked to isolate routing from PWA caching and preserve network fixtures.
This verifies browser navigation, not the email provider or backend RLS.

The build used `VITE_SUPABASE_URL=http://127.0.0.1:54321` and the public placeholder
`VITE_SUPABASE_ANON_KEY=review-public-key`. No real credentials are in the evidence.

## Matrix

Every row below passed at both viewport sizes. Raw results are in `matrix.json`.

| Session                   | Check                                                   | Observed result                                                                  |
| ------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Signed out                | Open `/cereri?source=test#requests`                     | Login keeps the full destination in `next`                                       |
| Signed out                | Request a magic link                                    | Outgoing `redirect_to` callback URL keeps the same destination                   |
| Authenticated, no profile | Open the same protected deep link                       | Redirects to `/no-profile`; explanation is visible                               |
| Voluntar                  | Open the protected deep link                            | Requests screen renders with query and fragment intact                           |
| BC                        | Open the protected deep link                            | Requests screen renders with query and fragment intact                           |
| Voluntar                  | Open `/bc` directly                                     | Redirects to the dashboard                                                       |
| BC                        | Open `/bc` directly                                     | BC route remains available                                                       |
| Voluntar and BC           | Profile → Taskuri → Back → Forward → refresh            | Browser history and refresh preserve the expected routes                         |
| Voluntar and BC, desktop  | Sidebar Taskuri link                                    | Opens `/tracker`                                                                 |
| Voluntar and BC, mobile   | Taskuri tab, then drawer Calendar link                  | Opens the same `/tracker` and `/calendar` routes; drawer closes after navigation |
| Voluntar and BC           | Visit callback with the saved destination and a session | Returns to `/cereri?source=test#requests` through the guards                     |
| All                       | JavaScript console and page errors                      | Zero errors and zero router warnings in the completed run                        |

Normal resource cancellations caused by navigating away were observed as
`ERR_ABORTED` request events; they were not JavaScript console errors.

## Screenshots

- [Desktop BC requests screen](1280-bc.png)
- [Desktop account without a profile](1280-no-profile.png)
- [Mobile Voluntar requests screen](390-voluntar.png)
- [Mobile login confirmation](390-signed-out.png)

The associated fix also passes 34 focused route/login/callback tests and the
full frontend suite and coverage gates in GitHub CI.

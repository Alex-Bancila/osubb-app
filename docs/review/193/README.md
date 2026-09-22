# Routing browser verification — #193

Updated 2026-09-21 against the production build of the review fixes at
`0aa7371`. The deep-link fix from #545 is now on `main`.

The review corrections replace the clipped simplified mobile mark with the
complete approved principal logo in both themes. The Request form now says
**Grup** and explains it as the department, team, or project the Member worked
for; the selector references that explanation for assistive technology. The
query and submission behavior are unchanged.

## Method

Chromium headless with Playwright, at 1280×900 and 390×900 CSS pixels. The real
application, guards, React Router, navigation components and Supabase client ran.
Deterministic browser storage supplied signed-out, authenticated/no-profile,
Voluntar and BC sessions; network interception supplied public fixture data, including an Educațional
Department membership so the Request Group selector has an available option.
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

## Visual review checks

`visual-checks.json` records checks at 320, 390, and 1280 CSS pixels in light
and dark themes. Each visible logo uses the complete 889×459 principal asset,
preserves its aspect ratio, and fits inside its container. The Group explanation
is visible, and the fixture Department can be selected.

- [Narrow mobile, light](320-light-requests.png)
- [Narrow mobile, dark](320-dark-requests.png)
- [Mobile drawer, light](390-light-menu.png)
- [Mobile drawer, dark](390-dark-menu.png)

The existing shell and Request component tests were updated before the fix:
three assertions failed on the old asset and wording, then all 12 focused tests
passed with the fix. The Request test also checks the selector's accessible
description.

Local validation: typecheck, lint, formatting, all 61 test files / 407 tests,
and the production build passed. All 16 routing checks passed without console
errors or router warnings; all six viewport/theme visual checks passed.

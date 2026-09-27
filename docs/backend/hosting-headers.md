# Response headers and the Content Security Policy

Cloudflare Pages serves the app with the headers in `app/src/pwa/_headers.template` (ruling L12, #770), rendered into
`dist/_headers` at build by `app/src/pwa/headers-plugin.ts`, which fills in the Supabase REST and Realtime origins of the
build's `VITE_SUPABASE_URL`. Pages sets no security headers of its own, and without a Cloudflare zone this file is the
only source of HSTS. `app/src/pwa/headers-plugin.test.ts` pins every header named below.

## What every path gets

| Header                       | Value                                                          | Why                                                                                             |
| ---------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`    | see below                                                      | the backstop behind "no HTML sink in the app": injected script cannot run or reach another host |
| `Strict-Transport-Security`  | `max-age=31536000; includeSubDomains`                          | HTTPS only, for a year                                                                          |
| `X-Frame-Options`            | `DENY`                                                         | no framing, for browsers that ignore `frame-ancestors`                                          |
| `X-Content-Type-Options`     | `nosniff`                                                      | a file is only ever what its type says                                                          |
| `Referrer-Policy`            | `strict-origin-when-cross-origin`                              | an outside link never learns the path a Member was on                                           |
| `Permissions-Policy`         | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` | the app uses none of them                                                                       |
| `Cross-Origin-Opener-Policy` | `same-origin`                                                  | a page this app opens cannot reach back into it                                                 |
| `X-Robots-Tag`               | `noindex`                                                      | an internal tool stays out of search engines                                                    |

`Cache-Control` is set per path only (`/assets/*` immutable; the shell, `sw.js`, the manifest and `theme-init.js`
`no-cache`; `/auth/*` `no-store`), because Pages joins a header named by two matching rules with a comma.

## The Content Security Policy is enforced

```text
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self';
connect-src 'self' <supabase origin> <supabase realtime origin>; worker-src 'self'; manifest-src 'self';
frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
```

**Why enforced.** supabase-js keeps the session, refresh token included, in `localStorage` (its default; the app has no
cookie infrastructure to move it). Any script injected into the page could read it and keep the account for as long as
the refresh token lives. The app has no HTML-injection sink today; the enforced policy is what keeps a future one from
becoming an account takeover: no inline or third-party script runs, and nothing can be sent to a host other than the
app and its Supabase project.

**Why `style-src` has no `'unsafe-inline'`.** React applies `style={…}` props through the CSSOM
(`element.style.setProperty`), which CSP does not govern, so the avatar colour, progress bars and the CSS custom
properties the calendar and task cards set all keep working. What the policy does block — a `<style>` element or a
`style="…"` attribute written as markup — appears nowhere in the bundle. The Ionic stylesheet injection that once needed
`'unsafe-inline'` left with #699.

**There is no `report-uri` or `report-to`.** A violation is logged in the browser's DevTools console (_"… violates the
following Content Security Policy directive …"_) and the action is blocked. That is where to look first when something
renders without its style or a request never leaves.

### Evidence for the switch (2026-09-27)

The policy above was served with a production build (`npm run build`, pointed at the local stack) from a static server
that applies `dist/_headers` the way Pages does, and walked through signed in as the seeded BC account: Acasă, Taskuri
(Task details sheet, **Task nou** form), Clasament, Grupuri and one Group, Cereri, Campanii, Calendar (agenda and month
view), Anunțuri (details sheet), Notificări, Voluntari, Profil (**Editează profil** sheet), Administrare (Member Card,
a Member's page, a Group's six tabs, Perioade de evaluare) and `/confidentialitate`, plus sign-in by the emailed link
and by the six-digit code. A `securitypolicyviolation` listener and the console recorded **zero violations**. A probe
that wrote a `<style>` element and a `style` attribute was blocked and reported, which showed the policy was live and
the listener was listening.

## When the policy has to change

- **Member photos (#629, after launch):** add the Supabase Storage origin to `img-src`.
- **A new third-party origin** (fonts, analytics, a CDN): name it in the directive it needs, never with a wildcard; keep
  `script-src 'self'`.
- **A library that injects a `<style>` element:** prefer a hash (`'sha256-…'`) of its fixed stylesheet over
  `'unsafe-inline'`, and write down which library needs it in the template.

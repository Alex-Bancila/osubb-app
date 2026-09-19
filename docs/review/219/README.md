# Brand accessibility verification — #219

Verified 2026-09-19 in Chromium with Playwright and axe-core against the real
configured production UI. This branch stacks on #545 so the session screens
also contain the separately reviewed deep-link fix.

## Scope and method

The migrated shell, login, callback failure, no-profile screen, Requests and
Tracker were exercised at 1280×900 and 390×900 CSS pixels in light and dark
`data-theme` modes. Session/network fixtures supply a signed-out visitor, an
account without organization claims, a Voluntar, and a BC member. The build uses
the public placeholders `http://127.0.0.1:54321` / `review-public-key`; no actual
member data or credentials are in these artifacts. Service workers are blocked
to isolate UI checks from PWA caching. The browser waits for the actual heading
and bundled fonts before each accessibility scan and screenshot.

Requests and Tracker use empty data fixtures here; their populated lists,
command dialogs and state-specific behavior remain covered by their feature
PRs. This is a verification of the migrated foundation and existing route
surfaces, not a claim that the remaining Ionic screens have been migrated.

## Findings fixed

1. Active mobile tab text used the raw brand red and measured only 4.34:1 in
   light mode and 4.11:1 in dark mode. It now uses the existing theme-aware
   `red-700` text token, while the labels and icons remain present.
2. Callback error text had the same contrast issue, and its outline retry link
   inherited Ionic's red anchor color. The destructive semantic text token now
   uses `red-700`; outline buttons explicitly set foreground text color, including
   when rendered as links. The brand logo and raw brand-red token are unchanged.
3. The drawer and buttons ignored reduced-motion preferences. Their transition
   property is now `none` under reduced motion, and the one-pixel button press
   movement is enabled only under `motion-safe`.

## Results

| Requirement                   | Browser evidence                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Contrast and accessible names | All 20 viewport/theme/route cases pass the WCAG A/AA axe checks, including color contrast                                        |
| Minimum target size           | No visible button, link, input, select or textarea below 44×44 CSS pixels in the checked surfaces                                |
| Keyboard focus                | Tab produces a visible focus ring in each checked surface; screenshots retain focused controls                                   |
| Drawer focus                  | Opening the drawer puts focus inside; Escape closes it and returns to the trigger                                                |
| Reduced motion                | Drawer and button computed transition property is `none`; an enabled button held down has `translate: none`                      |
| Normal motion                 | The same held button keeps its existing `translate: 0px 1px` feedback without reduced motion                                     |
| Non-color cues                | Navigation keeps text plus icons; active links retain `aria-current`; field labels and textual error explanations remain visible |
| Viewports and themes          | Desktop/mobile × light/dark, recorded in the JSON files and screenshots                                                          |

Raw scan, target-size and focus results are in `audit.json`. The eight explicit
pointer-down motion comparisons are in `motion.json`. A CSS transition duration
may still compute to `0.15s`; `transition-property: none` is what disables the
transition, so duration alone is not evidence of motion.

Ten focused shell/primitive tests pass, along with lint, formatting and the
configured production build. The full frontend tests and coverage gates are
also required in PR CI.

## Screenshots

- [Desktop light login with keyboard focus](1280-light-signed-out.png)
- [Mobile light login with keyboard focus](390-light-signed-out.png)
- [Desktop dark Requests](1280-dark-voluntar.png)
- [Mobile dark Requests and focused menu trigger](390-dark-voluntar.png)

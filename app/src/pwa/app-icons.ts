/**
 * The app icon's files in `public/`, one name per surface. Generated from the
 * vector source by `scripts/app-icon/generate.mjs`; see
 * `docs/brand/reference.md` ("App icon"). The in-app logo is separate and
 * lives in `src/assets/brand/`.
 */

/** `<link rel="icon">`: SVG for browsers that take it, PNG for the rest. */
const FAVICONS = [
  { href: '/favicon.svg', type: 'image/svg+xml', sizes: 'any' },
  { href: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
  { href: '/favicon-16x16.png', type: 'image/png', sizes: '16x16' },
] as const;

/** iOS home screen: 180 x 180, opaque (iOS rounds the corners itself). */
const APPLE_TOUCH_ICON = '/apple-touch-icon.png';

/**
 * Manifest icons. `any` is the rounded square desktop launchers draw as-is;
 * `maskable` is full-bleed, and the mark stays inside the 40% safe-zone
 * circle, so Android can cut any shape from it.
 */
const MANIFEST_ICONS = [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  {
    src: '/icon-maskable-192.png',
    sizes: '192x192',
    type: 'image/png',
    purpose: 'maskable',
  },
  {
    src: '/icon-maskable-512.png',
    sizes: '512x512',
    type: 'image/png',
    purpose: 'maskable',
  },
] as const;

/** A push Notification's picture: the full-bleed icon reads at any crop. */
const NOTIFICATION_ICON = '/icon-maskable-192.png';

/** Android's status bar: a white silhouette Android tints to one colour. */
const NOTIFICATION_BADGE = '/badge-96.png';

export {
  APPLE_TOUCH_ICON,
  FAVICONS,
  MANIFEST_ICONS,
  NOTIFICATION_BADGE,
  NOTIFICATION_ICON,
};

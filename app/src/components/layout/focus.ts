/**
 * The one keyboard focus ring for a hand-rolled control (a link, a tab, a
 * segment): a 2 px `--ring` outline, 2 px out, only on `:focus-visible`.
 *
 * Why `outline-solid`: in Tailwind 4, `outline-none` sets
 * `--tw-outline-style: none`, and `focus-visible:outline-2` draws
 * `outline-style: var(--tw-outline-style)` — nothing. Naming the style on
 * focus is what makes the ring appear (layout X1). Use this constant instead
 * of re-typing the classes; `ui/button.tsx` does the same thing.
 */
export const focusRingClass =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring';

/** The same ring drawn inside the control, for cells in a tight row. */
export const focusRingInsetClass =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-solid focus-visible:outline-ring';

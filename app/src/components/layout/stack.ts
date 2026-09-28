/** The gaps a panel's content (or any stack) may use, in 4 px steps. */
export type PanelStack = 2 | 3 | 4 | 6;

/**
 * A flex column with one gap, for blocks inside a panel box (or any other
 * stack): a child's `m-0` cannot cancel a flex gap the way it cancels
 * `space-y-*` (layout X2). Static strings, so Tailwind sees every one.
 */
export const stackClass: Record<PanelStack, string> = {
  2: 'flex flex-col gap-2',
  3: 'flex flex-col gap-3',
  4: 'flex flex-col gap-4',
  6: 'flex flex-col gap-6',
};

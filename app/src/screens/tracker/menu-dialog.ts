/**
 * A pop-up opened from an `ActionMenu` item instead of its own button: the
 * details sheet holds the state, the control draws no trigger, and when the
 * pop-up closes focus goes back to the menu's "⋯" button.
 */
export type MenuDialog = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The element that takes focus back; the menu's button. */
  returnFocus: () => HTMLElement | null;
};

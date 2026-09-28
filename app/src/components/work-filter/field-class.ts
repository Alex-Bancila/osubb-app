/**
 * A text or date input inside the Work Filter panel: the same 44 px field
 * as `NativeSelect` and the Combobox trigger (#842) — border, background,
 * radius and focus ring — so every cell of the grid reads as one control
 * (layout X4: the dates had the darker input background, the selects the
 * surface).
 */
export const workFilterFieldClass =
  'h-11 w-full min-w-0 rounded-lg border border-border bg-background px-4 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:border-input dark:bg-input/30';

/**
 * One cell of the grid: the label over its control. A Group or Campaign
 * name wraps inside its trigger instead of being cut (layout X4).
 */
export const workFilterCellClass =
  'grid min-w-0 content-start gap-1.5 [&_[data-slot=combobox-trigger]]:h-auto [&_[data-slot=combobox-trigger]]:min-h-11 [&_[data-slot=combobox-trigger]]:py-2 [&_[data-slot=combobox-trigger]]:text-left [&_[data-slot=combobox-trigger]]:whitespace-normal [&_[data-slot=combobox-trigger]>span]:whitespace-normal';

/** Room kept for the "+n" chip when the line overflows. */
export const MORE_CHIP_WIDTH = 40;
export const CHIP_GAP = 6;

/**
 * How many chips fit on one line: all of them, or the first ones plus room
 * for "+n". The Group chip always shows (it truncates when even it is too
 * wide). Pure, so the rule is testable without a layout engine.
 */
export function chipsThatFit(widths: number[], available: number): number {
  if (!widths.length || available <= 0) return widths.length;
  const total = widths.reduce(
    (sum, width, index) => sum + width + (index ? CHIP_GAP : 0),
    0,
  );
  if (total <= available) return widths.length;
  let used = widths[0] ?? 0;
  let shown = 1;
  while (
    shown < widths.length &&
    used + CHIP_GAP + (widths[shown] ?? 0) + CHIP_GAP + MORE_CHIP_WIDTH <=
      available
  ) {
    used += CHIP_GAP + (widths[shown] ?? 0);
    shown += 1;
  }
  return shown;
}

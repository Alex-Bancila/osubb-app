/** Room kept for the "+n" chip when the line overflows. */
export const MORE_CHIP_WIDTH = 40;
export const CHIP_GAP = 6;
/**
 * The narrowest the last chip on the line may truncate to and still say what
 * it is ("Campanie: Școala…"). A chip narrower than this keeps its own width.
 */
export const MIN_TRUNCATED_CHIP = 96;

/**
 * How many chips fit on one line: all of them, or the first ones plus room
 * for "+n". The last chip shown may truncate down to `MIN_TRUNCATED_CHIP`, so
 * a chip a few pixels too wide stays on the line instead of folding into
 * "+1" (F-5); the Group chip always shows (it truncates when even it is too
 * wide). Pure, so the rule is testable without a layout engine.
 */
export function chipsThatFit(widths: number[], available: number): number {
  if (!widths.length || available <= 0) return widths.length;
  const needed = (count: number) => {
    let used = 0;
    for (let index = 0; index < count; index += 1) {
      const width = widths[index] ?? 0;
      used +=
        (index ? CHIP_GAP : 0) +
        (index === count - 1 ? Math.min(width, MIN_TRUNCATED_CHIP) : width);
    }
    return count < widths.length ? used + CHIP_GAP + MORE_CHIP_WIDTH : used;
  };
  for (let count = widths.length; count > 1; count -= 1)
    if (needed(count) <= available) return count;
  return 1;
}

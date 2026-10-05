/**
 * An inline editor in a grid with pinned columns ("De invitat"): on a phone
 * the space beside the pinned Nume column is narrower than an email, phone
 * or Role editor, so a cell that opens there must neither hide under the
 * pinned column nor run past the grid's right edge.
 *
 * The open editor is lifted over the pinned columns (`editorLayerClass`), and
 * the grid scrolls sideways so the whole editor is inside its view:
 *
 * - it fits beside the pinned columns: its left edge comes just right of them,
 *   or its right edge comes to the grid's edge, whichever moves it less;
 * - it is wider than that space: its right edge comes to the grid's right
 *   edge and it covers the end of the pinned columns, never more than it must,
 *   so the row's checkbox and the start of its name stay in sight.
 */

/** The open editor's layer: above the pinned body cells (`z-[1]`), under the sticky header (`z-[4]`). */
export const editorLayerClass = 'relative z-[3] rounded-sm bg-card';

/** Marks a cell that stays put while the grid scrolls sideways. */
const PINNED_ATTRIBUTE = 'data-pinned';
/** Marks the grid's sideways scroll container. */
const SCROLLER_ATTRIBUTE = 'data-grid-scroller';

/** Viewport x-coordinates (px) of one moment: the editor, the pinned edge, the grid's view. */
export type RevealGeometry = {
  scrollLeft: number;
  editorLeft: number;
  editorRight: number;
  /** The right edge of the row's pinned cells. */
  pinnedRight: number;
  /** The grid's visible area, inside its border and without a scrollbar. */
  viewLeft: number;
  viewRight: number;
};

/** The grid's `scrollLeft` that shows the whole editor (the rules above). */
export function revealedScrollLeft(geometry: RevealGeometry): number {
  const { scrollLeft, editorLeft, editorRight, viewLeft, viewRight } = geometry;
  const start = Math.min(Math.max(geometry.pinnedRight, viewLeft), viewRight);
  const width = editorRight - editorLeft;
  let delta = 0;
  if (width <= viewRight - start) {
    if (editorLeft < start) delta = editorLeft - start;
    else if (editorRight > viewRight) delta = editorRight - viewRight;
  } else if (width <= viewRight - viewLeft) {
    delta = editorRight - viewRight;
  } else {
    // Wider than the whole grid: its start, where the typing begins, wins.
    delta = editorLeft - viewLeft;
  }
  return Math.max(0, Math.round(scrollLeft + delta));
}

/**
 * Scrolls the grid around a just-opened editor, instantly as #1013's
 * keyboard reveal does.
 */
export function revealBesidePinned(editor: HTMLElement): void {
  const cell = editor.closest('td,th');
  const scroller = editor.closest<HTMLElement>(`[${SCROLLER_ATTRIBUTE}]`);
  const row = cell?.parentElement;
  // A pinned cell's own editor never moves sideways.
  if (!cell || !scroller || !row || cell.hasAttribute(PINNED_ATTRIBUTE)) return;
  const view = scroller.getBoundingClientRect();
  const viewLeft = view.left + scroller.clientLeft;
  const viewRight = viewLeft + scroller.clientWidth;
  const pinnedRight = Math.max(
    viewLeft,
    ...[...row.querySelectorAll(`[${PINNED_ATTRIBUTE}]`)].map(
      (pinned) => pinned.getBoundingClientRect().right,
    ),
  );
  const box = editor.getBoundingClientRect();
  const left = revealedScrollLeft({
    scrollLeft: scroller.scrollLeft,
    editorLeft: box.left,
    editorRight: box.right,
    pinnedRight,
    viewLeft,
    viewRight,
  });
  if (left !== Math.round(scroller.scrollLeft))
    scroller.scrollTo({ left, behavior: 'instant' });
}

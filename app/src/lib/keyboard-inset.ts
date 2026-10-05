import { useEffect, useSyncExternalStore } from 'react';

/**
 * The phone's on-screen keyboard (#1013): while it is open, the field being
 * typed in and the actions that follow it (Salvează, Trimite, Aprobă…) stay
 * above it, on every page, sheet and dialog, with no scrolling.
 *
 * One listener on `window.visualViewport` measures the keyboard and publishes
 * it on `<html>`:
 *
 * - `--keyboard-inset`: how much of the layout viewport the keyboard covers.
 *   iOS Safari (also as a Home-Screen PWA) never shrinks the layout viewport,
 *   so there it is the keyboard's height; Android Chrome resizes the layout
 *   viewport itself (`interactive-widget=resizes-content` in index.html), so
 *   there it stays 0 and `100dvh` already ends at the keyboard.
 *   `--visible-height` (tailwind.css) is `100dvh` minus it: the shell, sheets
 *   and dialogs size to that.
 * - `data-keyboard="open"`: the keyboard is up, on either platform. The
 *   `keyboard:` variant hides the phone navigation bar, and every element
 *   marked `data-keyboard-pin` (the sheet and dialog footers, a form's own
 *   action row) sticks to the bottom of the visible area.
 *
 * After the layout settles, the focused field is scrolled into view together
 * with its actions (`actionsFor`: the pinned row, a row marked
 * `data-keyboard-actions` that cannot stick, or the form's submit button),
 * and clear of a pinned footer. Instantly, never smoothly: the layout
 * adjusts, the screen does not glide (reduced motion asks for no more).
 *
 * Only a touch device's keyboard counts: a desktop browser keeps 0 and no
 * attribute, so desktop behaviour never changes.
 */

export type KeyboardState = { open: boolean; inset: number };

/** A keyboard is taller than this; browser toolbars that come and go are not. */
export const KEYBOARD_MIN_HEIGHT = 120;

const CLOSED: KeyboardState = { open: false, inset: 0 };

/** The viewport numbers one measurement needs; `measureKeyboard` is pure. */
export type ViewportSample = {
  /** The layout viewport's height (`innerHeight`, `clientHeight`). */
  layoutHeight: number;
  /** The tallest layout viewport seen at this width: no keyboard. */
  baseline: number;
  /** `visualViewport.height`, `offsetTop` and `scale`. */
  visualHeight: number;
  offsetTop: number;
  scale: number;
  /** Whether the keyboard counted as open at the previous measurement. */
  wasOpen: boolean;
  /** Whether focus sits in a field that raises the keyboard. */
  editing: boolean;
};

export function measureKeyboard(sample: ViewportSample): KeyboardState {
  // Pinch-zoomed: the visual viewport is small because the Member zoomed in,
  // not because of a keyboard. Leave the layout alone.
  if (Math.abs(sample.scale - 1) > 0.05) return CLOSED;
  const keyboardHeight = sample.baseline - sample.visualHeight;
  // Opening needs a field in focus (a shrunk window is not a keyboard);
  // closing follows the geometry alone, so the tap on a footer button that
  // blurs the field does not move that button before the tap lands.
  const open =
    keyboardHeight > KEYBOARD_MIN_HEIGHT && (sample.wasOpen || sample.editing);
  if (!open) return CLOSED;
  const inset = Math.max(
    0,
    Math.round(sample.layoutHeight - sample.offsetTop - sample.visualHeight),
  );
  return { open, inset };
}

const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** A field that raises the on-screen keyboard (or a picker in its place). */
export function isEditable(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly;
  if (element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement)
    return !element.readOnly && !NON_TEXT_INPUTS.has(element.type);
  return false;
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (
    let node = element.parentElement;
    node && node !== document.documentElement;
    node = node.parentElement
  ) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      node.scrollHeight > node.clientHeight
    )
      return node;
  }
  return null;
}

const ACTIONS = '[data-keyboard-pin],[data-keyboard-actions]';
const LAYER = '[data-slot="sheet-content"],[data-slot="dialog-content"]';

function last<T>(list: ArrayLike<T>): T | null {
  return list[list.length - 1] ?? null;
}

/**
 * The actions the Member taps after typing in this field: the action row its
 * form, sheet or dialog marks (`data-keyboard-pin` pinned, or
 * `data-keyboard-actions` for a row that cannot stick), else its form's
 * submit button.
 */
export function actionsFor(field: HTMLElement): HTMLElement | null {
  const form = field.closest('form');
  if (form) {
    const marked = last(form.querySelectorAll<HTMLElement>(ACTIONS));
    if (marked) return marked;
    const submit = last(
      [...form.querySelectorAll<HTMLElement>('button,input')].filter(
        (control) =>
          (control instanceof HTMLButtonElement ||
            control instanceof HTMLInputElement) &&
          control.type === 'submit',
      ),
    );
    if (submit) return submit;
  }
  // No form, or a form with no button of its own (an inline edit): the
  // nearest marked row around the field, without leaving its sheet or page.
  for (
    let node = field.parentElement;
    node && node !== document.body;
    node = node.parentElement
  ) {
    const marked = last(node.querySelectorAll<HTMLElement>(ACTIONS));
    if (marked) return marked;
    if (node.matches(`${LAYER},main`)) return null;
  }
  return null;
}

/** The pinned row's surface reaches 0.75rem above it (tailwind.css). */
const PIN_BAND = 12;
/** The gap kept between the field and that surface. */
const REVEAL_GAP = 8;

/**
 * Scrolls the focused field into view together with its actions: the actions
 * first, so they come up to the keyboard's edge, then the field, so it wins
 * when both do not fit. A field under a pinned footer is then lifted clear of
 * it (`scrollIntoView` does not know about sticky elements).
 */
export function revealFocusedField(field: HTMLElement): void {
  const actions = actionsFor(field);
  const pinned =
    actions !== null && getComputedStyle(actions).position === 'sticky';
  // A stuck row is already in view, and this is then a no-op; a row that
  // cannot stick (a scroll container between it and the page) comes up.
  if (actions && !actions.contains(field))
    actions.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  field.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (!actions || !pinned || actions.contains(field)) return;
  const overlap =
    field.getBoundingClientRect().bottom +
    REVEAL_GAP +
    PIN_BAND -
    actions.getBoundingClientRect().top;
  if (overlap <= 0) return;
  const scroller = scrollParent(field);
  if (scroller) scroller.scrollTop += overlap;
}

let state: KeyboardState = CLOSED;
const subscribers = new Set<() => void>();

function publish(next: KeyboardState) {
  const root = document.documentElement;
  if (next.inset > 0)
    root.style.setProperty('--keyboard-inset', `${next.inset}px`);
  else root.style.removeProperty('--keyboard-inset');
  if (next.open) root.dataset.keyboard = 'open';
  else delete root.dataset.keyboard;
  if (next.open === state.open && next.inset === state.inset) return;
  state = next;
  subscribers.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  return () => subscribers.delete(notify);
}

function snapshot() {
  return state;
}

/**
 * The keyboard as `useKeyboardInset` last measured it, for a component that
 * needs the number itself (a floating list keeping clear of the keyboard).
 * It only reads: the measuring listener lives in `App`.
 */
export function useKeyboardState(): KeyboardState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Tracks the on-screen keyboard and publishes it on `<html>` (see the top of
 * this file). Mounted once, in `App`; elsewhere read `useKeyboardState`.
 */
export function useKeyboardInset(): KeyboardState {
  useEffect(() => {
    const viewport = window.visualViewport;
    // Only a touch screen's keyboard moves the layout (#1013): desktop and
    // jsdom keep the page exactly as it was.
    const touch =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;
    if (!viewport || !touch) return;

    let width = window.innerWidth;
    let baseline = 0;
    let frame = 0;
    let focusMoved = false;

    const layoutHeight = () =>
      Math.max(window.innerHeight, document.documentElement.clientHeight);

    const measure = () => {
      frame = 0;
      const before = state;
      const layout = layoutHeight();
      // A rotation starts a new baseline: the keyboard-free height changed.
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        baseline = 0;
      }
      baseline = Math.max(baseline, layout, viewport.height);
      publish(
        measureKeyboard({
          layoutHeight: layout,
          baseline,
          visualHeight: viewport.height,
          offsetTop: viewport.offsetTop,
          scale: viewport.scale,
          wasOpen: state.open,
          editing: isEditable(document.activeElement),
        }),
      );
      // Reveal when the keyboard opens or changes height, or focus moves to
      // another field; never on a plain pan, so the Member can still scroll
      // away from the field while typing.
      const field = document.activeElement;
      const settle =
        state.open &&
        (!before.open || before.inset !== state.inset || focusMoved);
      focusMoved = false;
      // The layout follows the new inset in this frame; reveal in the next.
      if (settle && isEditable(field))
        requestAnimationFrame(() => {
          if (document.activeElement === field) revealFocusedField(field);
        });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const focused = () => {
      focusMoved = true;
      schedule();
    };

    measure();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    document.addEventListener('focusin', focused);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('focusin', focused);
      publish(CLOSED);
    };
  }, []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

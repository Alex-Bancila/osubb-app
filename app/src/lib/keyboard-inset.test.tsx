import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KEYBOARD_MIN_HEIGHT,
  actionsFor,
  isEditable,
  measureKeyboard,
  revealFocusedField,
  useKeyboardInset,
  useKeyboardState,
  type ViewportSample,
} from './keyboard-inset';

// jsdom has no scrollIntoView: one stand-in records who asked to be shown.
const scrollIntoView = vi.fn();
beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

const PHONE = 812;
const KEYBOARD = 336;

const closed: ViewportSample = {
  layoutHeight: PHONE,
  baseline: PHONE,
  visualHeight: PHONE,
  offsetTop: 0,
  scale: 1,
  wasOpen: false,
  editing: true,
};

describe('measureKeyboard', () => {
  it('reads the keyboard height on iOS, where only the visual viewport shrinks', () => {
    expect(
      measureKeyboard({ ...closed, visualHeight: PHONE - KEYBOARD }),
    ).toEqual({ open: true, inset: KEYBOARD, offsetTop: 0 });
  });

  it('subtracts how far iOS panned the visual viewport', () => {
    expect(
      measureKeyboard({
        ...closed,
        visualHeight: PHONE - KEYBOARD,
        offsetTop: 40,
      }),
    ).toEqual({ open: true, inset: KEYBOARD - 40, offsetTop: 40 });
  });

  it('opens with no inset on Android, where the layout itself shrinks', () => {
    expect(
      measureKeyboard({
        ...closed,
        layoutHeight: PHONE - KEYBOARD,
        visualHeight: PHONE - KEYBOARD,
      }),
    ).toEqual({ open: true, inset: 0, offsetTop: 0 });
  });

  it('ignores a browser toolbar coming and going', () => {
    expect(
      measureKeyboard({
        ...closed,
        visualHeight: PHONE - KEYBOARD_MIN_HEIGHT,
      }),
    ).toEqual({ open: false, inset: 0, offsetTop: 0 });
  });

  it('opens only for a focused field, but closes on the geometry alone', () => {
    const shrunk = { ...closed, visualHeight: PHONE - KEYBOARD };
    expect(measureKeyboard({ ...shrunk, editing: false })).toEqual({
      open: false,
      inset: 0,
      offsetTop: 0,
    });
    // The tap on a footer button blurs the field: the button stays put.
    expect(
      measureKeyboard({ ...shrunk, editing: false, wasOpen: true }),
    ).toEqual({ open: true, inset: KEYBOARD, offsetTop: 0 });
  });

  it('leaves a pinch-zoomed page alone', () => {
    expect(
      measureKeyboard({ ...closed, visualHeight: PHONE / 2, scale: 2 }),
    ).toEqual({ open: false, inset: 0, offsetTop: 0 });
  });
});

describe('isEditable', () => {
  it('counts the fields that raise a keyboard or a picker', () => {
    const text = document.createElement('input');
    const search = Object.assign(document.createElement('input'), {
      type: 'search',
    });
    const area = document.createElement('textarea');
    const select = document.createElement('select');
    expect([text, search, area, select].map(isEditable)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it('leaves out buttons, ticks and read-only fields', () => {
    const box = Object.assign(document.createElement('input'), {
      type: 'checkbox',
    });
    const readOnly = Object.assign(document.createElement('textarea'), {
      readOnly: true,
    });
    const button = document.createElement('button');
    expect([box, readOnly, button, null].map(isEditable)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('the actions revealed with a field', () => {
  it('prefers the row its form pins', () => {
    render(
      <form>
        <input aria-label="Notă" />
        <div data-keyboard-pin="" data-testid="actions">
          <button type="submit">Trimite</button>
        </div>
      </form>,
    );
    expect(actionsFor(screen.getByRole('textbox'))).toBe(
      screen.getByTestId('actions'),
    );
  });

  it('falls back to the form’s submit button', () => {
    render(
      <form>
        <input aria-label="Adresa nouă" />
        <button type="button">Ajutor</button>
        <button>Schimbă adresa</button>
      </form>,
    );
    expect(actionsFor(screen.getByRole('textbox'))).toBe(
      screen.getByRole('button', { name: 'Schimbă adresa' }),
    );
  });

  it('finds a marked row around a field outside any form', () => {
    render(
      <main>
        <div>
          <div>
            <textarea aria-label="Motiv" />
          </div>
          <div data-keyboard-actions="" data-testid="role">
            <button type="button">Salvează rolul</button>
          </div>
          <div data-keyboard-actions="" data-testid="status">
            <button type="button">Salvează statusul</button>
          </div>
        </div>
      </main>,
    );
    expect(actionsFor(screen.getByRole('textbox'))).toBe(
      screen.getByTestId('status'),
    );
  });

  it('never reaches past the page for someone else’s actions', () => {
    render(
      <>
        <main>
          <input aria-label="Caută" />
        </main>
        <div data-keyboard-pin="" />
      </>,
    );
    expect(actionsFor(screen.getByRole('textbox'))).toBeNull();
  });

  it('scrolls the actions into view first, then the field', () => {
    render(
      <form>
        <input aria-label="Titlu" />
        <button>Salvează</button>
      </form>,
    );
    const order: string[] = [];
    scrollIntoView.mockImplementation(function (this: Element) {
      order.push(this.tagName);
    });
    revealFocusedField(screen.getByRole('textbox'));
    expect(order).toEqual(['BUTTON', 'INPUT']);
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      block: 'nearest',
      inline: 'nearest',
    });
  });
});

class FakeViewport extends EventTarget {
  height = PHONE;
  offsetTop = 0;
  scale = 1;
}

function Probe() {
  useKeyboardInset();
  const state = useKeyboardState();
  return (
    <>
      <input aria-label="Notă" />
      <output>{state.open ? `open ${state.inset}` : 'closed'}</output>
    </>
  );
}

describe('useKeyboardInset', () => {
  let viewport: FakeViewport;
  let coarse = true;

  beforeEach(() => {
    coarse = true;
    viewport = new FakeViewport();
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('innerHeight', PHONE);
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: coarse, media: query })),
    );
    // One frame at a time, run at once: the hook measures in a frame and
    // reveals the field in the next.
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
      run(0);
      // 0: no frame left pending, so the next event schedules again.
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function keyboard(height: number) {
    act(() => {
      viewport.height = PHONE - height;
      viewport.dispatchEvent(new Event('resize'));
    });
  }

  it('publishes an iOS keyboard as --keyboard-inset and data-keyboard', () => {
    render(<Probe />);
    act(() => screen.getByRole('textbox').focus());

    keyboard(KEYBOARD);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--keyboard-inset')).toBe(
      `${KEYBOARD}px`,
    );
    expect(root.dataset.keyboard).toBe('open');
    expect(screen.getByRole('status')).toHaveTextContent(`open ${KEYBOARD}`);

    keyboard(0);
    expect(root.style.getPropertyValue('--keyboard-inset')).toBe('');
    expect(root.dataset.keyboard).toBeUndefined();
    expect(screen.getByRole('status')).toHaveTextContent('closed');
  });

  it('publishes how far iOS panned the visible area, for sheets and dialogs', () => {
    render(<Probe />);
    act(() => screen.getByRole('textbox').focus());

    act(() => {
      viewport.offsetTop = 60;
      viewport.height = PHONE - KEYBOARD - 60;
      viewport.dispatchEvent(new Event('scroll'));
    });
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--keyboard-offset-top')).toBe('60px');
    expect(root.style.getPropertyValue('--keyboard-inset')).toBe(
      `${KEYBOARD}px`,
    );

    keyboard(0);
    expect(root.style.getPropertyValue('--keyboard-offset-top')).toBe('');
  });

  it('brings the focused field into view once the keyboard is up', () => {
    render(<Probe />);
    const field = screen.getByRole('textbox');
    act(() => field.focus());

    keyboard(KEYBOARD);
    expect(scrollIntoView.mock.contexts).toContain(field);
  });

  it('changes nothing on a desktop, whatever the window does', () => {
    coarse = false;
    render(<Probe />);
    act(() => screen.getByRole('textbox').focus());

    keyboard(KEYBOARD);
    expect(
      document.documentElement.style.getPropertyValue('--keyboard-inset'),
    ).toBe('');
    expect(document.documentElement.dataset.keyboard).toBeUndefined();
    expect(screen.getByRole('status')).toHaveTextContent('closed');
  });

  it('clears what it published when it unmounts', () => {
    const { unmount } = render(<Probe />);
    act(() => screen.getByRole('textbox').focus());
    keyboard(KEYBOARD);

    unmount();
    expect(document.documentElement.dataset.keyboard).toBeUndefined();
    expect(
      document.documentElement.style.getPropertyValue('--keyboard-inset'),
    ).toBe('');
  });
});

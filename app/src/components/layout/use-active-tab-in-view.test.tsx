import { render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActiveTabInView } from './use-active-tab-in-view';

function size(el: Element, props: Record<string, number>) {
  for (const [key, value] of Object.entries(props))
    Object.defineProperty(el, key, { configurable: true, value });
}

const scrollTo = vi.fn();

function Strip({
  active,
  scrollWidth = 700,
}: {
  active: string;
  scrollWidth?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useActiveTabInView(ref, active);
  return (
    <div
      ref={(node) => {
        ref.current = node;
        // jsdom lays nothing out: give the strip and its tabs a size, as a
        // 343 px strip holding five tabs would have.
        if (!node) return;
        size(node, { scrollWidth, clientWidth: 343 });
        Object.defineProperty(node, 'scrollTo', {
          configurable: true,
          value: scrollTo,
        });
        node
          .querySelectorAll('button')
          .forEach((tab, index) =>
            size(tab, { offsetLeft: 16 + index * 100, offsetWidth: 90 }),
          );
      }}
      role="tablist"
    >
      {['membri', 'grupuri', 'roluri', 'cereri', 'setari'].map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={tab === active}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

let resized: (() => void) | undefined;

beforeEach(() => {
  scrollTo.mockReset();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resized = undefined;
});

describe('useActiveTabInView', () => {
  it('centres the active tab of an overflowing strip (X7)', () => {
    render(<Strip active="setari" />);
    // Setări: 16 + 4 × 100 = 416 px in; centred in 343 px.
    expect(scrollTo).toHaveBeenCalledWith({ left: 416 - (343 - 90) / 2 });
  });

  it('leaves a strip that fits alone, and centres once it starts to overflow', () => {
    const { getByRole } = render(<Strip active="setari" scrollWidth={300} />);
    expect(scrollTo).not.toHaveBeenCalled();
    // The window narrows below 640 px: the strip now overflows.
    size(getByRole('tablist'), { scrollWidth: 700 });
    resized?.();
    expect(scrollTo).toHaveBeenCalledOnce();
    // Further resizes while it overflows leave the member's scroll alone.
    resized?.();
    expect(scrollTo).toHaveBeenCalledOnce();
  });
});

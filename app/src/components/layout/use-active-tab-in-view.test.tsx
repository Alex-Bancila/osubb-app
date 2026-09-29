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

// Each observer and what it watches, so a test resizes one element.
let observers: { callback: () => void; targets: Set<Element> }[] = [];
function resize(target: Element) {
  for (const observer of observers)
    if (observer.targets.has(target)) observer.callback();
}

beforeEach(() => {
  scrollTo.mockReset();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      targets = new Set<Element>();
      constructor(callback: () => void) {
        observers.push({ callback, targets: this.targets });
      }
      observe(target: Element) {
        this.targets.add(target);
      }
      disconnect() {
        this.targets.clear();
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  observers = [];
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
    resize(getByRole('tablist'));
    expect(scrollTo).toHaveBeenCalledOnce();
    // Further resizes while it overflows leave the member's scroll alone.
    resize(getByRole('tablist'));
    expect(scrollTo).toHaveBeenCalledOnce();
  });

  it('centres again when the tabs themselves widen, as when the web font lands (F-25)', () => {
    const { getByRole } = render(<Strip active="setari" scrollWidth={300} />);
    expect(scrollTo).not.toHaveBeenCalled();
    // The strip keeps its width; its tabs grow past it.
    size(getByRole('tablist'), { scrollWidth: 700 });
    resize(getByRole('tab', { name: 'setari' }));
    expect(scrollTo).toHaveBeenCalledWith({ left: 416 - (343 - 90) / 2 });
  });
});

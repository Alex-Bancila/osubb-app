import { render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useActiveTabInView } from './use-active-tab-in-view';

function size(el: Element, props: Record<string, number>) {
  for (const [key, value] of Object.entries(props))
    Object.defineProperty(el, key, { configurable: true, value });
}

const scrollTo = vi.fn();

function Strip({ active }: { active: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useActiveTabInView(ref, active);
  return (
    <div
      ref={(node) => {
        ref.current = node;
        // jsdom lays nothing out: give the strip and its tabs a size, as a
        // 343 px strip holding five tabs would have.
        if (!node) return;
        size(node, { scrollWidth: 700, clientWidth: 343 });
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

describe('useActiveTabInView', () => {
  it('centres the active tab of an overflowing strip (X7)', () => {
    render(<Strip active="setari" />);
    // Setări: 16 + 4 × 100 = 416 px in; centred in 343 px.
    expect(scrollTo).toHaveBeenCalledWith({ left: 416 - (343 - 90) / 2 });
  });
});

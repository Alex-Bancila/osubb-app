import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { swipe } from '../test/swipe';
import { readSwipe, swipeStartsElsewhere, useSwipeTabs } from './swipe-tabs';

describe('readSwipe', () => {
  it('reads a long, mostly sideways move as next (left) or previous (right)', () => {
    expect(readSwipe({ x: 200, y: 100 }, { x: 140, y: 110 })).toBe('next');
    expect(readSwipe({ x: 100, y: 100 }, { x: 170, y: 90 })).toBe('previous');
  });

  it('ignores a short move, and a diagonal one that is mostly a scroll', () => {
    expect(readSwipe({ x: 200, y: 100 }, { x: 160, y: 100 })).toBeNull();
    expect(readSwipe({ x: 200, y: 100 }, { x: 120, y: 160 })).toBeNull();
  });
});

describe('swipeStartsElsewhere', () => {
  it('claims nothing for plain content, everything for a field or an opted-out part', () => {
    render(
      <div data-testid="panel">
        <p>Text</p>
        <input aria-label="Caută" />
        <div data-swipe-ignore>
          <span>Hartă</span>
        </div>
      </div>,
    );
    const panel = screen.getByTestId('panel');
    expect(swipeStartsElsewhere(screen.getByText('Text'), panel)).toBe(false);
    expect(swipeStartsElsewhere(screen.getByLabelText('Caută'), panel)).toBe(
      true,
    );
    expect(swipeStartsElsewhere(screen.getByText('Hartă'), panel)).toBe(true);
  });
});

function Tabs({
  onSelect,
  current = 'b',
}: {
  onSelect: (next: string) => void;
  current?: string;
}) {
  const handlers = useSwipeTabs({ order: ['a', 'b', 'c'], current, onSelect });
  return (
    <div data-testid="panel" {...handlers}>
      <p>Conținut</p>
      <textarea aria-label="Note" />
      <div data-testid="row" style={{ overflowX: 'auto' }}>
        <span>chips</span>
      </div>
    </div>
  );
}

describe('useSwipeTabs', () => {
  it('opens the next tab on a swipe left and the previous on a swipe right', () => {
    const onSelect = vi.fn();
    render(<Tabs onSelect={onSelect} />);
    swipe(screen.getByTestId('panel'), 'left');
    expect(onSelect).toHaveBeenLastCalledWith('c');
    swipe(screen.getByTestId('panel'), 'right');
    expect(onSelect).toHaveBeenLastCalledWith('a');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('does nothing past the last tab', () => {
    const onSelect = vi.fn();
    render(<Tabs onSelect={onSelect} current="c" />);
    swipe(screen.getByTestId('panel'), 'left');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores a short move, a diagonal one and a second finger', () => {
    const onSelect = vi.fn();
    render(<Tabs onSelect={onSelect} />);
    const panel = screen.getByTestId('panel');
    swipe(panel, 'left', { distance: 30 });
    swipe(panel, 'left', { distance: 80, drift: 70 });
    fireEvent.touchStart(panel, {
      touches: [
        { clientX: 200, clientY: 100 },
        { clientX: 220, clientY: 100 },
      ],
    });
    fireEvent.touchMove(panel, {
      touches: [
        { clientX: 60, clientY: 100 },
        { clientX: 80, clientY: 100 },
      ],
    });
    fireEvent.touchEnd(panel, {
      changedTouches: [{ clientX: 60, clientY: 100 }],
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves a swipe that starts in a field, or on something that scrolls sideways, alone', () => {
    const onSelect = vi.fn();
    render(<Tabs onSelect={onSelect} />);
    swipe(screen.getByLabelText('Note'), 'left');
    const row = screen.getByTestId('row');
    Object.defineProperty(row, 'scrollWidth', {
      value: 600,
      configurable: true,
    });
    Object.defineProperty(row, 'clientWidth', {
      value: 300,
      configurable: true,
    });
    swipe(screen.getByText('chips'), 'left');
    expect(onSelect).not.toHaveBeenCalled();
    // Once that row fits, it no longer claims the finger.
    Object.defineProperty(row, 'scrollWidth', {
      value: 300,
      configurable: true,
    });
    swipe(screen.getByText('chips'), 'left');
    expect(onSelect).toHaveBeenCalledWith('c');
  });
});

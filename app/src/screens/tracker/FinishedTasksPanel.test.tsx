import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FinishedTasks } from '../../queries/task-lists';
import { FinishedTasksPanel } from './FinishedTasksPanel';

const finished = (overrides: Partial<FinishedTasks> = {}): FinishedTasks => ({
  rows: [{ id: 1 } as FinishedTasks['rows'][number]],
  total: 120,
  isPending: false,
  isError: false,
  error: null,
  hasMore: true,
  isLoadingMore: false,
  isFetching: false,
  moreFailed: false,
  loadMore: vi.fn(),
  refetch: vi.fn(),
  ...overrides,
});

describe('FinishedTasksPanel', () => {
  // Fails if the next page arrives behind a disabled button alone: the rows
  // it brings hold their place under the list, so the end never looks stuck.
  it('holds the place of the next page under the list while it is read', () => {
    render(
      <FinishedTasksPanel
        finished={finished({ isLoadingMore: true, isFetching: true })}
      >
        <p>Rândurile citite</p>
      </FinishedTasksPanel>,
    );
    const status = screen.getByRole('status', {
      name: 'Se încarcă mai multe taskuri…',
    });
    expect(
      status.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThanOrEqual(3);
    // Under the rows read so far, which stay.
    expect(
      screen.getByText('Rândurile citite').compareDocumentPosition(status) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Se încarcă…' })).toBeDisabled();
  });

  it('holds no place when no page is on its way', () => {
    render(
      <FinishedTasksPanel finished={finished()}>
        <p>Rândurile citite</p>
      </FinishedTasksPanel>,
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Încarcă mai multe' }),
    ).toBeEnabled();
  });

  // #1147: moving a full window on drops its first page above the button.
  // Without scroll anchoring (Safari) the rows would jump by that page's
  // height; the panel puts the button back where it was pressed.
  it('keeps the button where it was pressed when the window drops its first page', async () => {
    const user = userEvent.setup();
    let scrollTop = 4000;
    const scroller = document.scrollingElement ?? document.documentElement;
    const scrollTopWas = Object.getOwnPropertyDescriptor(scroller, 'scrollTop');
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    try {
      const atStart = finished({ hasMore: true });
      const view = render(
        <FinishedTasksPanel finished={{ ...atStart, earlier: 0, full: true }}>
          <p>Rândurile citite</p>
        </FinishedTasksPanel>,
      );
      const button = screen.getByRole('button', { name: 'Încarcă mai multe' });
      // 600 px down the screen when pressed; 100 px once a page above it went.
      let top = 600;
      button.getBoundingClientRect = () => ({ top }) as DOMRect;

      await user.click(button);
      expect(atStart.loadMore).toHaveBeenCalledOnce();
      top = 100;
      view.rerender(
        <FinishedTasksPanel finished={{ ...atStart, earlier: 50, full: true }}>
          <p>Rândurile citite</p>
        </FinishedTasksPanel>,
      );

      expect(scrollTop).toBe(3500);

      // A later render that moves nothing scrolls nothing.
      view.rerender(
        <FinishedTasksPanel finished={{ ...atStart, earlier: 50, full: true }}>
          <p>Rândurile citite</p>
        </FinishedTasksPanel>,
      );
      expect(scrollTop).toBe(3500);
    } finally {
      if (scrollTopWas)
        Object.defineProperty(scroller, 'scrollTop', scrollTopWas);
      else delete (scroller as { scrollTop?: number }).scrollTop;
    }
  });
});

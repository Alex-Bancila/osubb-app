import { render, screen } from '@testing-library/react';
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
});

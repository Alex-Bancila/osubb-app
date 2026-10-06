import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { WorkItem } from '../../lib/work-filter';
import { openFilters } from '../../test/filters';

vi.mock('../../queries/work-filter-options', () => ({
  useWorkFilterOptions: () => ({
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    data: {
      groups: [
        { id: 1, name: 'Educațional', path: [1], status: 'active' },
        { id: 2, name: 'Mentorat', path: [1, 2], status: 'active' },
        { id: 8, name: 'Comunicare', path: [8], status: 'active' },
      ],
      campaigns: [],
    },
  }),
}));

import {
  TRACKER_FILTER_DATES_HINT,
  TRACKER_FILTER_HINT,
  TrackerWorkFilter,
} from './TrackerWorkFilter';

function renderFilter(rows: WorkItem[]) {
  return render(
    <MemoryRouter initialEntries={['/tracker']}>
      <TrackerWorkFilter rows={rows} />
    </MemoryRouter>,
  );
}

describe('Tracker Work Filter hint (F-8)', () => {
  it('speaks only of dates when no Group level shows', async () => {
    // One Group with work: Rule W draws no Group level. Taskuri keeps Rule W;
    // only the Calendar always draws its Group levels (R40).
    renderFilter([{ group_id: 1, campaign_id: null }]);
    await openFilters(userEvent.setup());
    expect(
      screen.queryByRole('combobox', { name: 'Grup principal' }),
    ).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Subgrup' })).toBeNull();
    expect(screen.getByText(TRACKER_FILTER_DATES_HINT)).toBeInTheDocument();
    expect(screen.queryByText(/Grupul include/)).toBeNull();
  });

  it('explains the Group level when one shows', async () => {
    renderFilter([
      { group_id: 1, campaign_id: null },
      { group_id: 8, campaign_id: null },
    ]);
    await openFilters(userEvent.setup());
    expect(
      screen.getByRole('combobox', { name: 'Grup principal' }),
    ).toBeInTheDocument();
    expect(screen.getByText(TRACKER_FILTER_HINT)).toBeInTheDocument();
  });
});

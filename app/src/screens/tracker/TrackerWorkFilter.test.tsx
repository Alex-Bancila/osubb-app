import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { WorkItem } from '../../lib/work-filter';
import { filterButton, openFilters } from '../../test/filters';

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
import { useTitleSearch } from './use-title-search';

function Filter(
  props: Omit<ComponentProps<typeof TrackerWorkFilter>, 'search'>,
) {
  return <TrackerWorkFilter {...props} search={useTitleSearch()} />;
}

function renderFilter(
  rows: WorkItem[],
  props: Partial<ComponentProps<typeof Filter>> = {},
) {
  return render(
    <MemoryRouter initialEntries={['/tracker']}>
      <Filter rows={rows} {...props} />
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

describe('Tracker toolbar', () => {
  const toolbar = () => screen.getByRole('group', { name: 'Filtre taskuri' });
  const searchbox = () =>
    screen.getByRole('searchbox', { name: 'Caută după titlu' });

  it('leads with the title search, then Filtrează as an icon button', () => {
    renderFilter([{ group_id: 1, campaign_id: null }]);
    expect(toolbar().firstElementChild).toBe(searchbox().closest('label'));
    expect(
      searchbox().compareDocumentPosition(filterButton()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(filterButton()).toHaveAccessibleName('Filtrează');
  });

  it('names the count in the placeholder when it is known', () => {
    const { unmount } = renderFilter([], { count: 22 });
    expect(searchbox()).toHaveAttribute(
      'placeholder',
      'Caută în 22 de taskuri',
    );
    unmount();
    renderFilter([], { count: 0 });
    expect(searchbox()).toHaveAttribute('placeholder', 'Caută după titlu');
  });

  it('holds its row with the search disabled while the list is not there', () => {
    renderFilter([], { disabled: true });
    expect(searchbox()).toBeDisabled();
    expect(filterButton()).toBeVisible();
  });
});

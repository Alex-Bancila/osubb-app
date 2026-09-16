import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DataTable, type DataTableColumn } from './DataTable';

type ScoreRow = {
  member: string;
  points: number;
};

const columns: DataTableColumn<ScoreRow>[] = [
  { accessorKey: 'member', header: 'Membru', enableSorting: false },
  { accessorKey: 'points', header: 'Puncte' },
];

function visibleMembers() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);
}

describe('DataTable', () => {
  it('renders typed rows and sorts them from an accessible header button', async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        data={[
          { member: 'Mara', points: 18 },
          { member: 'Andrei', points: 7 },
        ]}
        emptyTitle="Niciun membru"
        emptyDescription="Rezultatele vor apărea aici."
      />,
    );

    expect(visibleMembers()).toEqual(['Mara', 'Andrei']);

    const pointsHeader = screen.getByRole('columnheader', { name: /Puncte/ });
    const sortButton = within(pointsHeader).getByRole('button', {
      name: 'Sortează Puncte crescător',
    });
    expect(pointsHeader).toHaveAttribute('aria-sort', 'none');

    await user.click(sortButton);

    expect(pointsHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(sortButton).toHaveAccessibleName('Sortează Puncte descrescător');
    expect(visibleMembers()).toEqual(['Andrei', 'Mara']);
  });

  it('uses native keyboard activation for both sort directions', async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        data={[
          { member: 'Mara', points: 18 },
          { member: 'Andrei', points: 7 },
        ]}
        emptyTitle="Niciun membru"
      />,
    );

    const sortButton = screen.getByRole('button', {
      name: 'Sortează Puncte crescător',
    });
    sortButton.focus();
    await user.keyboard(' ');
    expect(visibleMembers()).toEqual(['Andrei', 'Mara']);

    await user.keyboard('{Enter}');
    expect(sortButton).toHaveAccessibleName('Sortează Puncte crescător');
    expect(visibleMembers()).toEqual(['Mara', 'Andrei']);
  });

  it('names the actual next direction when a column starts descending', async () => {
    const user = userEvent.setup();
    const descendingColumns: DataTableColumn<ScoreRow>[] = [
      { accessorKey: 'member', header: 'Membru', enableSorting: false },
      { accessorKey: 'points', header: 'Puncte', sortDescFirst: true },
    ];
    render(
      <DataTable
        columns={descendingColumns}
        data={[
          { member: 'Mara', points: 18 },
          { member: 'Andrei', points: 7 },
        ]}
        emptyTitle="Niciun membru"
      />,
    );

    const sortButton = screen.getByRole('button', {
      name: 'Sortează Puncte descrescător',
    });
    await user.click(sortButton);

    expect(visibleMembers()).toEqual(['Mara', 'Andrei']);
    expect(sortButton).toHaveAccessibleName('Sortează Puncte crescător');
  });

  it('shows an explained empty state inside a horizontally scrollable table', () => {
    const { container } = render(
      <DataTable<ScoreRow>
        columns={[]}
        data={[]}
        emptyTitle="Niciun membru"
        emptyDescription="Rezultatele vor apărea aici."
      />,
    );

    expect(screen.getByText('Niciun membru')).toBeVisible();
    expect(screen.getByText('Rezultatele vor apărea aici.')).toBeVisible();
    expect(screen.getByRole('cell')).toHaveAttribute('colspan', '1');
    expect(
      container.querySelector('[data-slot="table-container"]'),
    ).toHaveClass('overflow-x-auto');
  });
});

describe('DataTable filters', () => {
  it('filters supplied rows and composes filtering with keyboard sorting', async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        data={[
          { member: 'Mara', points: 18 },
          { member: 'Maria', points: 7 },
          { member: 'Andrei', points: 3 },
        ]}
        emptyTitle="Niciun rezultat"
        filters={[{ columnId: 'member', label: 'Caută membru' }]}
      />,
    );
    await user.type(
      screen.getByRole('searchbox', { name: 'Caută membru' }),
      'Mar',
    );
    expect(visibleMembers()).toEqual(['Mara', 'Maria']);
    const sort = screen.getByRole('button', {
      name: 'Sortează Puncte crescător',
    });
    sort.focus();
    await user.keyboard('{Enter}');
    expect(visibleMembers()).toEqual(['Maria', 'Mara']);
    await user.clear(screen.getByRole('searchbox'));
    expect(visibleMembers()).toEqual(['Andrei', 'Maria', 'Mara']);
    await user.type(screen.getByRole('searchbox'), 'nimeni');
    expect(screen.getByText('Niciun rezultat')).toBeVisible();
  });
});

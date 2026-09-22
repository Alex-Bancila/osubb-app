import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  GroupFilterCombobox,
  type GroupFilterOption,
} from './GroupFilterCombobox';

// Moved from LeadershipScreen.test.tsx with the extraction (#646): this
// search/label behaviour belongs to the shared Combobox itself, not to
// either screen that mounts it, so it is pinned once, here.
describe('GroupFilterCombobox', () => {
  const groups: GroupFilterOption[] = [
    { id: 7, name: 'Educație', path: [7] },
    { id: 9, name: 'Mentorat', path: [7, 9] },
  ];
  const groupsById = new Map(groups.map((group) => [group.id, group]));

  function Harness({
    onValueChange,
  }: {
    onValueChange: (group: GroupFilterOption | null) => void;
  }) {
    return (
      <div>
        <span id="group-filter-label">Grup</span>
        <GroupFilterCombobox
          ariaLabelledBy="group-filter-label"
          groups={groups}
          groupsById={groupsById}
          value={null}
          onValueChange={onValueChange}
          placeholder="Toate grupurile"
        />
      </div>
    );
  }

  it('searches Groups by name or parent and labels a Child Group with its parent', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await user.click(screen.getByRole('combobox', { name: 'Grup' }));
    await user.type(
      await screen.findByPlaceholderText('Caută un grup'),
      'educ',
    );
    // "Mentorat · Educație" matches through its parent's name.
    await waitFor(() =>
      expect(
        within(screen.getByRole('listbox'))
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['Educație', 'Mentorat· Educație']),
    );

    await user.click(screen.getByRole('option', { name: /Mentorat/ }));
    expect(onValueChange).toHaveBeenCalledWith(groups[1]);
  });

  it('lets the caller append extra text to the search match and extra content to a row', async () => {
    type ArchivableGroup = GroupFilterOption & { status: string };
    const withArchived: ArchivableGroup[] = [
      { id: 7, name: 'Educație', path: [7], status: 'active' },
      { id: 11, name: 'Vechi', path: [11], status: 'archived' },
    ];
    const byId = new Map(withArchived.map((group) => [group.id, group]));
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <div>
        <span id="group-filter-label">Grup</span>
        <GroupFilterCombobox
          ariaLabelledBy="group-filter-label"
          groups={withArchived}
          groupsById={byId}
          value={null}
          onValueChange={onValueChange}
          placeholder="Toate grupurile"
          itemToStringLabel={(group) =>
            group.name + (group.status === 'archived' ? ' (arhivat)' : '')
          }
          renderItem={(group) => (
            <>
              {group.name}
              {group.status === 'archived' && <span>arhivat</span>}
            </>
          )}
        />
      </div>,
    );

    await user.click(screen.getByRole('combobox', { name: 'Grup' }));
    await user.type(
      await screen.findByPlaceholderText('Caută un grup'),
      'arhivat',
    );
    expect(
      await screen.findByRole('option', { name: /Vechiarhivat/ }),
    ).toBeVisible();
  });
});

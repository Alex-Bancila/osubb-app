import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupPreferenceRow } from '../../lib/preferred-groups';

const state = vi.hoisted(() => ({
  rows: undefined as GroupPreferenceRow[] | undefined,
  mutate: vi.fn(),
  saveError: null as Error | null,
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/group-preferences', () => ({
  useGroupPreferences: () => ({
    data: state.rows,
    isPending: state.rows === undefined,
    isError: false,
  }),
  useSaveGroupPreferences: () => ({
    mutate: state.mutate,
    isPending: false,
    isError: state.saveError !== null,
    error: state.saveError,
  }),
}));
vi.mock('../../queries/reference', () => ({
  useGroups: () => ({
    isPending: false,
    isError: false,
    data: new Map(
      [
        {
          id: 1,
          name: 'Organizația',
          path: [1],
          status: 'active',
          is_organization: true,
          color: null,
        },
        {
          id: 10,
          name: 'Educațional',
          path: [10],
          status: 'active',
          color: '#0a7d4f',
        },
        {
          id: 11,
          name: 'Mentorat',
          path: [10, 11],
          status: 'active',
          color: null,
        },
        {
          id: 12,
          name: 'Ateliere',
          path: [10, 11, 12],
          status: 'active',
          color: null,
        },
        {
          id: 20,
          name: 'Resurse Umane',
          path: [20],
          status: 'active',
          color: null,
        },
        {
          id: 21,
          name: 'Recrutare',
          path: [20, 21],
          status: 'active',
          color: null,
        },
        {
          id: 30,
          name: 'Adunarea Generală',
          path: [30],
          status: 'active',
          color: null,
        },
      ].map((group) => [group.id, group]),
    ),
  }),
}));

import { PreferredGroupsCard } from './PreferredGroupsCard';

const everySelected: GroupPreferenceRow[] = [
  { group_id: 1, selected: true, locked: 'organization' },
  { group_id: 10, selected: true, locked: null },
  { group_id: 11, selected: true, locked: null },
  { group_id: 12, selected: true, locked: null },
  { group_id: 20, selected: true, locked: 'position' },
  { group_id: 21, selected: true, locked: 'position' },
  { group_id: 30, selected: true, locked: 'adunarea_generala' },
];

function renderCard() {
  return render(
    <MemoryRouter initialEntries={['/profil']}>
      <PreferredGroupsCard />
    </MemoryRouter>,
  );
}

const box = (name: string) => screen.getByRole('checkbox', { name });

async function openSheet() {
  const user = userEvent.setup();
  renderCard();
  await user.click(screen.getByRole('button', { name: 'Alege grupurile' }));
  return {
    user,
    dialog: screen.getByRole('dialog', { name: 'Grupuri preferate' }),
  };
}

describe('PreferredGroupsCard (R43)', () => {
  beforeEach(() => {
    state.rows = everySelected;
    state.mutate.mockReset();
    state.saveError = null;
  });

  it('is not drawn below level 5, where the server answers no Group', () => {
    state.rows = [];
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('says every Group is selected by default', () => {
    renderCard();
    expect(
      screen.getByRole('heading', { name: 'Grupuri preferate' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Toate cele 7 grupuri')).toBeInTheDocument();
    expect(
      screen.getByText('Primești notificări din toate grupurile.'),
    ).toBeInTheDocument();
  });

  it('counts the unselected Groups and names them', () => {
    state.rows = everySelected.map((row) =>
      row.group_id === 11 || row.group_id === 12
        ? { ...row, selected: false }
        : row,
    );
    renderCard();
    expect(screen.getByText('5 din 7 grupuri')).toBeInTheDocument();
    const off = screen.getByRole('list', { name: 'Grupuri debifate' });
    expect(
      within(off)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Mentorat', 'Ateliere']);
  });

  it('draws the tree with locked Groups ticked, disabled and explained', async () => {
    await openSheet();
    expect(box('OSUBB')).toBeChecked();
    expect(box('OSUBB')).toHaveAttribute('aria-disabled', 'true');
    expect(box('OSUBB')).toHaveAccessibleDescription(
      'Toată organizația — rămâne mereu.',
    );
    expect(box('Adunarea Generală')).toHaveAccessibleDescription(
      'Adunarea Generală — rămâne mereu.',
    );
    expect(box('Recrutare')).toHaveAccessibleDescription(
      'Ai o funcție aici — rămâne mereu.',
    );
    expect(box('Educațional')).toBeChecked();
    expect(box('Educațional')).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('unticks a parent with its subgroups, then a subgroup alone leaves the parent mixed', async () => {
    const { user } = await openSheet();
    await user.click(box('Educațional'));
    expect(box('Educațional')).not.toBeChecked();
    expect(box('Mentorat')).not.toBeChecked();
    expect(box('Ateliere')).not.toBeChecked();
    await user.click(box('Educațional'));
    await user.click(box('Ateliere'));
    expect(box('Ateliere')).not.toBeChecked();
    expect(box('Educațional')).toHaveAttribute('aria-checked', 'mixed');
    expect(box('Mentorat')).toHaveAttribute('aria-checked', 'mixed');
  });

  it('saves the unticked Groups in one request, then says so', async () => {
    state.mutate.mockImplementation(
      (_ids: number[], options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
    );
    const { user } = await openSheet();
    const save = screen.getByRole('button', { name: 'Salvează' });
    expect(save).toBeDisabled();
    await user.click(box('Mentorat'));
    await user.click(screen.getByRole('button', { name: 'Salvează' }));
    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate.mock.calls[0]?.[0]).toEqual([11, 12]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByText('Grupurile preferate au fost salvate.'),
    ).toBeInTheDocument();
  });

  it('Deselectează tot respects the locks; Selectează tot ticks everything again', async () => {
    const { user } = await openSheet();
    await user.click(screen.getByRole('button', { name: 'Deselectează tot' }));
    expect(box('Educațional')).not.toBeChecked();
    expect(box('OSUBB')).toBeChecked();
    expect(box('Recrutare')).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Salvează' }));
    expect(state.mutate.mock.calls[0]?.[0]).toEqual([10, 11, 12]);
    await user.click(screen.getByRole('button', { name: 'Selectează tot' }));
    expect(box('Educațional')).toBeChecked();
  });

  it('Renunță leaves everything as it was', async () => {
    const { user } = await openSheet();
    await user.click(box('Educațional'));
    await user.click(screen.getByRole('button', { name: 'Renunță' }));
    expect(state.mutate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Alege grupurile' }));
    expect(box('Educațional')).toBeChecked();
  });

  it('says why a save was refused', async () => {
    state.saveError = new Error('group_preference_locked');
    await openSheet();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'OSUBB, Adunarea Generală și Biroul de Conducere rămân mereu selectate.',
    );
  });
});

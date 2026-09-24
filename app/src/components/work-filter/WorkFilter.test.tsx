import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import type {
  WorkFilterCampaign,
  WorkFilterGroup,
} from '../../lib/work-filter';
import { WorkFilter, type WorkFilterLevels } from './WorkFilter';

const groups: WorkFilterGroup[] = [
  {
    id: 5,
    name: 'Organizația',
    path: [5],
    status: 'active',
    is_organization: true,
  },
  { id: 1, name: 'Educațional', path: [1], status: 'active' },
  { id: 2, name: 'Mentorat', path: [1, 2], status: 'active' },
  { id: 3, name: 'Grupa A', path: [1, 2, 3], status: 'active' },
  { id: 4, name: 'Traineri', path: [1, 4], status: 'active' },
  { id: 8, name: 'Comunicare', path: [8], status: 'active' },
  { id: 9, name: 'Social media', path: [8, 9], status: 'active' },
];
const campaigns: WorkFilterCampaign[] = [
  { id: 10, name: 'Bun venit', group_id: 1 },
  { id: 11, name: 'Mentorat de toamnă', group_id: 2 },
  { id: 13, name: 'Traineri noi', group_id: 4 },
  { id: 14, name: 'Brand', group_id: 8 },
];

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderFilter(query = '', levels?: WorkFilterLevels) {
  return render(
    <MemoryRouter initialEntries={[`/clasament${query}`]}>
      <WorkFilter groups={groups} campaigns={campaigns} levels={levels} />
      <Search />
    </MemoryRouter>,
  );
}
const search = () => screen.getByTestId('search').textContent;
const options = async () =>
  (await screen.findAllByRole('option')).map((option) => option.textContent);

describe('WorkFilter', () => {
  it('offers top-level Groups with OSUBB first, then only the Groups below the root', async () => {
    const user = userEvent.setup();
    renderFilter();
    const sub = screen.getByRole('combobox', { name: 'Subgrup' });
    expect(sub).toHaveTextContent('Toate subgrupurile');
    expect(sub).toBeDisabled();

    await user.click(screen.getByRole('combobox', { name: 'Grup principal' }));
    expect(await options()).toEqual(['OSUBB', 'Comunicare', 'Educațional']);
    await user.click(screen.getByRole('option', { name: 'Educațional' }));
    expect(search()).toBe('?grup=1');

    await user.click(screen.getByRole('combobox', { name: 'Subgrup' }));
    // Every descendant, each shown with its parent.
    expect(await options()).toEqual([
      'Mentorat· Educațional',
      'Grupa A· Mentorat',
      'Traineri· Educațional',
    ]);
    await user.click(screen.getByRole('option', { name: /^Mentorat/ }));
    expect(search()).toBe('?grup=1&subgrup=2');
  });

  it('offers the Campaigns on the chosen Group, its ancestors and below it', async () => {
    const user = userEvent.setup();
    renderFilter('?grup=1&subgrup=2');
    await user.click(screen.getByRole('combobox', { name: 'Campanie' }));
    expect(await options()).toEqual([
      'Bun venit· Educațional',
      'Mentorat de toamnă· Mentorat',
    ]);
    await user.click(screen.getByRole('option', { name: /^Bun venit/ }));
    expect(search()).toBe('?grup=1&subgrup=2&campanie=10');
  });

  it('restores every level from the URL and clears the levels below a changed one', async () => {
    const user = userEvent.setup();
    renderFilter(
      '?grup=1&subgrup=2&campanie=11&de_la=2026-09-01&pana_la=2026-09-30',
    );
    expect(
      screen.getByRole('combobox', { name: 'Grup principal' }),
    ).toHaveTextContent('Educațional');
    expect(screen.getByRole('combobox', { name: 'Subgrup' })).toHaveTextContent(
      'Mentorat',
    );
    expect(
      screen.getByRole('combobox', { name: 'Campanie' }),
    ).toHaveTextContent('Mentorat de toamnă');
    expect(screen.getByLabelText('De la')).toHaveValue('2026-09-01');
    expect(screen.getByLabelText('Până la')).toHaveValue('2026-09-30');

    await user.click(screen.getByRole('combobox', { name: 'Grup principal' }));
    await user.click(await screen.findByRole('option', { name: 'Comunicare' }));
    // The Subgrup and Campaign depended on the root; the range did not.
    expect(search()).toBe('?grup=8&de_la=2026-09-01&pana_la=2026-09-30');
  });

  it('summarises the filter in chips that remove their level and announce it', async () => {
    const user = userEvent.setup();
    renderFilter(
      '?grup=1&subgrup=2&campanie=11&de_la=2026-09-01&pana_la=2026-09-30',
    );
    const chips = screen.getByRole('group', { name: 'Filtre active' });
    expect(
      within(chips)
        .getAllByRole('button')
        .map((chip) => chip.getAttribute('aria-label') ?? chip.textContent),
    ).toEqual([
      'Elimină filtrul Grup principal: Educațional',
      'Elimină filtrul Subgrup: Mentorat',
      'Elimină filtrul Campanie: Mentorat de toamnă',
      'Elimină filtrul De la: 1 septembrie 2026',
      'Elimină filtrul Până la: 30 septembrie 2026',
      'Șterge filtrele',
    ]);

    await user.click(
      screen.getByRole('button', { name: 'Elimină filtrul Subgrup: Mentorat' }),
    );
    expect(search()).toBe('?grup=1&de_la=2026-09-01&pana_la=2026-09-30');
    expect(
      screen.getByText('Filtrul Subgrup: Mentorat a fost eliminat.'),
    ).toBeInTheDocument();
    // Focus lands on the chip that took the removed one's place.
    expect(document.activeElement).toHaveAccessibleName(
      'Elimină filtrul De la: 1 septembrie 2026',
    );

    await user.click(screen.getByRole('button', { name: 'Șterge filtrele' }));
    expect(search()).toBe('');
    expect(screen.queryByRole('group', { name: 'Filtre active' })).toBeNull();
    expect(document.activeElement).toHaveAccessibleName('Grup principal');
  });

  it('shows the range error under Până la and keeps the dates in the URL', async () => {
    const user = userEvent.setup();
    renderFilter('?de_la=2026-09-15');
    const to = screen.getByLabelText('Până la');
    await user.type(to, '2026-09-14');
    expect(search()).toBe('?de_la=2026-09-15&pana_la=2026-09-14');
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent(
      'Data de sfârșit nu poate fi înaintea celei de început.',
    );
    expect(to).toHaveAttribute('aria-invalid', 'true');
    expect(to).toHaveAccessibleDescription(
      'Data de sfârșit nu poate fi înaintea celei de început.',
    );

    await user.clear(to);
    await user.type(to, '2026-09-15');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hides the levels a page does not filter by', () => {
    renderFilter('?campanie=10', { campaign: false, dates: false });
    expect(screen.queryByRole('combobox', { name: 'Campanie' })).toBeNull();
    expect(screen.queryByLabelText('De la')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Filtre active' })).toBeNull();
  });

  it('labels every control, with no axe violations', async () => {
    const { container } = renderFilter(
      '?grup=1&subgrup=2&campanie=11&de_la=2026-09-15&pana_la=2026-09-01',
    );
    expect(
      (
        await axe.run(container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });
});

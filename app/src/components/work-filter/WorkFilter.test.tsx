import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type {
  WorkFilterCampaign,
  WorkFilterGroup,
  WorkFilterLevels,
  WorkItem,
} from '../../lib/work-filter';
import { closeFilters, filterButton, openFilters } from '../../test/filters';
import { WorkFilter } from './WorkFilter';

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

function renderFilter(
  query = '',
  levels?: WorkFilterLevels,
  work?: readonly WorkItem[],
) {
  return render(
    <MemoryRouter initialEntries={[`/clasament${query}`]}>
      <WorkFilter
        groups={groups}
        campaigns={campaigns}
        levels={levels}
        work={work}
        hint="Grupul include subgrupurile sale."
      />
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
    await openFilters(user);
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
    await openFilters(user);
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
    await openFilters(user);
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
    // With no chip left, focus returns to Filtrează.
    expect(filterButton()).toHaveFocus();
  });

  it('shows the range error under Până la and keeps the dates in the URL', async () => {
    const user = userEvent.setup();
    renderFilter('?de_la=2026-09-15');
    await openFilters(user);
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

  it('hides the levels a page does not filter by', async () => {
    const user = userEvent.setup();
    renderFilter('?campanie=10', { campaign: false, dates: false });
    await openFilters(user);
    expect(screen.queryByRole('combobox', { name: 'Campanie' })).toBeNull();
    expect(screen.queryByLabelText('De la')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Filtre active' })).toBeNull();
  });

  it('hides both Group levels when the page does not filter by Group, and clearing keeps them in the URL', async () => {
    const user = userEvent.setup();
    renderFilter('?grup=1&subgrup=2&campanie=10', { group: false });
    const sheet = await openFilters(user);
    expect(
      within(sheet).getByRole('combobox', { name: 'Campanie' }),
    ).toBeVisible();
    await closeFilters(user);
    expect(
      screen.queryByRole('combobox', { name: 'Grup principal' }),
    ).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Subgrup' })).toBeNull();
    const chips = screen.getByRole('group', { name: 'Filtre active' });
    expect(within(chips).getAllByRole('button')).toHaveLength(2);
    expect(chips).not.toHaveTextContent('Grup principal');
    await user.click(screen.getByRole('button', { name: 'Șterge filtrele' }));
    expect(search()).toBe('?grup=1&subgrup=2');
    // With no chip left, focus returns to Filtrează.
    expect(filterButton()).toHaveFocus();
  });

  it('labels every control, with no axe violations, closed and open', async () => {
    const user = userEvent.setup();
    const { container } = renderFilter(
      '?grup=1&subgrup=2&campanie=11&de_la=2026-09-15&pana_la=2026-09-01',
    );
    const rules = { 'color-contrast': { enabled: false } };
    expect((await axe.run(container, { rules })).violations).toEqual([]);
    const sheet = await openFilters(user);
    expect((await axe.run(sheet, { rules })).violations).toEqual([]);
  });

  describe('Rule W', () => {
    // Two Tasks: one in Grupa A (deep under Educațional), one in Social media.
    const work: WorkItem[] = [
      { group_id: 3, campaign_id: 11 },
      { group_id: 9, campaign_id: 14 },
    ];

    it('offers only the Groups with work, with their parents, and no Group without any', async () => {
      const user = userEvent.setup();
      renderFilter('', undefined, work);
      await openFilters(user);
      await user.click(
        screen.getByRole('combobox', { name: 'Grup principal' }),
      );
      // OSUBB owns nothing here, so it is not offered.
      expect(await options()).toEqual(['Comunicare', 'Educațional']);
      await user.click(screen.getByRole('option', { name: 'Educațional' }));
      // Mentorat is Grupa A's parent; Traineri owns nothing.
      await user.click(screen.getByRole('combobox', { name: 'Subgrup' }));
      expect(await options()).toEqual([
        'Mentorat· Educațional',
        'Grupa A· Mentorat',
      ]);
    });

    it('does not draw a level with one option or none, and shows its URL value as a chip', async () => {
      const user = userEvent.setup();
      // Under Comunicare: one Subgrup (Social media), one Campaign (Brand).
      renderFilter('?grup=8&campanie=14', undefined, work);
      // Every set level is a chip, its control drawn or not.
      expect(
        screen.getByRole('button', { name: 'Elimină filtrul Campanie: Brand' }),
      ).toBeVisible();
      expect(
        screen.getByRole('button', {
          name: 'Elimină filtrul Grup principal: Comunicare',
        }),
      ).toBeVisible();
      const sheet = await openFilters(user);
      expect(
        within(sheet).getByRole('combobox', { name: 'Grup principal' }),
      ).toBeVisible();
      expect(
        within(sheet).queryByRole('combobox', { name: 'Subgrup' }),
      ).toBeNull();
      expect(
        within(sheet).queryByRole('combobox', { name: 'Campanie' }),
      ).toBeNull();
    });

    it('keeps a Group the shared URL carries though it owns nothing', async () => {
      const user = userEvent.setup();
      renderFilter('?grup=5', undefined, work);
      await openFilters(user);
      expect(
        screen.getByRole('combobox', { name: 'Grup principal' }),
      ).toHaveTextContent('OSUBB');
    });
  });

  describe('the Filtrează button', () => {
    it('counts the set levels and opens one sheet, returning focus on close', async () => {
      const user = userEvent.setup();
      renderFilter('?grup=1&de_la=2026-09-01');
      const open = filterButton();
      expect(open).toHaveAccessibleName('Filtrează, 2 filtre active');
      expect(open).toHaveTextContent('Filtrează2');
      expect(open).toHaveAttribute('aria-expanded', 'false');
      // It is the toolbar's first control, before the chips.
      const toolbar = screen.getByRole('group', { name: 'Filtre' });
      expect(within(toolbar).getAllByRole('button')[0]).toBe(open);

      const sheet = await openFilters(user);
      expect(open).toHaveAttribute('aria-expanded', 'true');
      expect(open).toHaveAttribute('aria-controls', sheet.id);
      expect(sheet).toHaveAccessibleDescription(
        'Grupul include subgrupurile sale.',
      );
      expect(
        within(sheet).getByRole('combobox', { name: 'Grup principal' }),
      ).toHaveTextContent('Educațional');
      expect(within(sheet).getByLabelText('De la')).toHaveValue('2026-09-01');
      await closeFilters(user);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(open).toHaveFocus();
      expect(open).toHaveAttribute('aria-expanded', 'false');
    });

    it('names one filter in the singular', () => {
      renderFilter('?grup=1');
      expect(filterButton()).toHaveAccessibleName('Filtrează, 1 filtru activ');
    });

    it('clears every level from the sheet', async () => {
      const user = userEvent.setup();
      renderFilter('?grup=1');
      const sheet = await openFilters(user);
      await user.click(
        within(sheet).getByRole('button', { name: 'Șterge filtrele' }),
      );
      expect(search()).toBe('');
      // The sheet stays open on the cleared controls until Vezi rezultatele.
      expect(
        within(sheet).queryByRole('button', { name: 'Șterge filtrele' }),
      ).toBeNull();
      await closeFilters(user);
      expect(filterButton()).toHaveAccessibleName('Filtrează');
    });

    it('is not drawn when the filter offers nothing', () => {
      renderFilter('', { group: false, campaign: false, dates: false });
      expect(screen.queryByRole('button', { name: /^Filtrează/ })).toBeNull();
      expect(screen.queryByRole('group', { name: 'Filtre' })).toBeNull();
    });
  });

  it("counts a page's own set cells as chips and clears them too", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <MemoryRouter initialEntries={['/tracker?grup=1']}>
        <WorkFilter
          groups={groups}
          campaigns={campaigns}
          fields={() => <p>Stare</p>}
          extraChips={[
            { key: 'state', label: 'Stare', text: 'În lucru', onRemove },
          ]}
          search={<input aria-label="Caută după titlu" />}
        />
        <Search />
      </MemoryRouter>,
    );
    expect(filterButton()).toHaveAccessibleName('Filtrează, 2 filtre active');
    // The search stays in the toolbar, after the button.
    const toolbar = screen.getByRole('group', { name: 'Filtre' });
    expect(within(toolbar).getByLabelText('Caută după titlu')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Șterge filtrele' }));
    expect(search()).toBe('');
    expect(onRemove).toHaveBeenCalled();
  });

  it('says so while the options load, and offers a retry when they fail', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <MemoryRouter>
        <WorkFilter
          label="Filtre calendar"
          status={{ pending: true }}
          groups={[]}
          campaigns={[]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Se încarcă filtrele…')).toBeInTheDocument();
    // The button keeps its place, disabled, while the options load.
    expect(filterButton()).toBeDisabled();
    const onRetry = vi.fn();
    rerender(
      <MemoryRouter>
        <WorkFilter
          label="Filtre calendar"
          status={{ failed: true, error: new Error('x'), onRetry }}
          groups={[]}
          campaigns={[]}
        />
      </MemoryRouter>,
    );
    await user.click(
      screen.getByRole('button', { name: 'Reîncarcă filtrele' }),
    );
    expect(onRetry).toHaveBeenCalled();
  });
});

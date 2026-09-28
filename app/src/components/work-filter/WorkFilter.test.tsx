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

  it('hides both Group levels when the page does not filter by Group, and clearing keeps them in the URL', async () => {
    const user = userEvent.setup();
    renderFilter('?grup=1&subgrup=2&campanie=10', { group: false });
    expect(
      screen.queryByRole('combobox', { name: 'Grup principal' }),
    ).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Subgrup' })).toBeNull();
    const chips = screen.getByRole('group', { name: 'Filtre active' });
    expect(within(chips).getAllByRole('button')).toHaveLength(2);
    expect(chips).not.toHaveTextContent('Grup principal');
    await user.click(screen.getByRole('button', { name: 'Șterge filtrele' }));
    expect(search()).toBe('?grup=1&subgrup=2');
    // With no chip left, focus returns to the first field the page shows.
    expect(screen.getByRole('combobox', { name: 'Campanie' })).toHaveFocus();
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

  describe('Rule W', () => {
    // Two Tasks: one in Grupa A (deep under Educațional), one in Social media.
    const work: WorkItem[] = [
      { group_id: 3, campaign_id: 11 },
      { group_id: 9, campaign_id: 14 },
    ];

    it('offers only the Groups with work, with their parents, and no Group without any', async () => {
      const user = userEvent.setup();
      renderFilter('', undefined, work);
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

    it('does not draw a level with one option or none, and shows its URL value as a chip', () => {
      // Under Comunicare: one Subgrup (Social media), one Campaign (Brand).
      renderFilter('?grup=8&campanie=14', undefined, work);
      expect(screen.queryByRole('combobox', { name: 'Subgrup' })).toBeNull();
      expect(screen.queryByRole('combobox', { name: 'Campanie' })).toBeNull();
      const chip = screen.getByRole('button', {
        name: 'Elimină filtrul Campanie: Brand',
      });
      // Its control is not drawn, so the chip shows at every width.
      expect(chip.parentElement).not.toHaveClass('md:hidden');
      // Grup principal is drawn: its chip is for the phone only (K1).
      expect(
        screen.getByRole('button', {
          name: 'Elimină filtrul Grup principal: Comunicare',
        }).parentElement,
      ).toHaveClass('md:hidden');
    });

    it('keeps a Group the shared URL carries though it owns nothing', () => {
      renderFilter('?grup=5', undefined, work);
      expect(
        screen.getByRole('combobox', { name: 'Grup principal' }),
      ).toHaveTextContent('OSUBB');
    });
  });

  describe('on a phone', () => {
    it('collapses to a Filtre (n) button that opens the panel in a sheet', async () => {
      const user = userEvent.setup();
      renderFilter('?grup=1&de_la=2026-09-01');
      const open = screen.getByRole('button', { name: 'Filtre (2)' });
      expect(open).toHaveClass('md:hidden');
      // The inline grid and hint are for md and up.
      expect(
        document.querySelector('[data-slot=work-filter-grid]')?.parentElement,
      ).toHaveClass('max-md:hidden');
      await user.click(open);
      const sheet = screen.getByRole('dialog', { name: 'Filtre' });
      expect(sheet).toHaveAccessibleDescription(
        'Grupul include subgrupurile sale.',
      );
      expect(
        within(sheet).getByRole('combobox', { name: 'Grup principal' }),
      ).toHaveTextContent('Educațional');
      expect(within(sheet).getByLabelText('De la')).toHaveValue('2026-09-01');
      await user.click(
        within(sheet).getByRole('button', { name: 'Vezi rezultatele' }),
      );
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('clears every level from the sheet', async () => {
      const user = userEvent.setup();
      renderFilter('?grup=1');
      await user.click(screen.getByRole('button', { name: 'Filtre (1)' }));
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'Șterge filtrele',
        }),
      );
      expect(search()).toBe('');
      // The sheet stays open on the cleared controls until Vezi rezultatele.
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'Vezi rezultatele',
        }),
      );
      expect(screen.getByRole('button', { name: 'Filtre' })).toBeVisible();
    });
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

import { render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { chooseOption } from '../../test/select';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
// R43: Grupuri preferate, read by the page's scope.
const preferences = vi.hoisted(() => ({
  muted: new Set<number>() as ReadonlySet<number>,
}));
vi.mock('../../queries/group-preferences', () => ({
  usePreferredGroupsData: () => ({ muted: preferences.muted, memberId: 'me' }),
}));
vi.mock('../../queries/work-filter-options', () => ({
  useWorkFilterOptions: () => ({
    isPending: false,
    isError: false,
    data: {
      groups: [
        { id: 1, name: 'Educațional', path: [1], status: 'active' },
        { id: 2, name: 'Mentorat', path: [1, 2], status: 'active' },
        { id: 30, name: 'Gala', path: [30], status: 'active' },
        // Readable, but owns no Task on this list (Rule W).
        { id: 40, name: 'Adunarea Generală', path: [40], status: 'active' },
      ],
      campaigns: [
        { id: 7, name: 'Toamnă', group_id: 1 },
        { id: 8, name: 'Primăvară', group_id: 1 },
      ],
    },
  }),
}));
import { closeFilters, filterButton, openFilters } from '../../test/filters';
import { taskRow } from '../../test/task-fixtures';
import { PreferredGroupsScope } from '../../components/preferred-groups/PreferredGroupsScope';
import { ManagerTaskList as SearchedManagerTaskList } from './ManagerTaskList';
import { useTitleSearch } from './use-title-search';
import { compareManagedTasks } from './manager-task-list';
import { toTaskPresentation } from './task-presentation';

const now = new Date('2026-09-15T12:00:00Z');
const edu = {
  name: 'Educațional',
  short: 'EDU',
  color: '#0a7d4f',
  category: 'department',
  path: [1],
  is_organization: false,
};
const rows = [
  taskRow({
    id: 1,
    title: 'Viitor fără termen',
    deadline: null,
    group: edu,
  }),
  taskRow({
    id: 2,
    title: 'Z urgent',
    deadline: '2026-09-14T10:00:00Z',
    status: 'in_progress',
    review_round: 1,
    campaign_id: 7,
    campaign: { name: 'Toamnă' },
    group: edu,
  }),
  taskRow({
    id: 3,
    title: 'Ședință de mentorat',
    deadline: '2026-09-20T10:00:00Z',
    group_id: 2,
    group: { ...edu, name: 'Mentorat', category: 'team', path: [1, 2] },
  }),
  taskRow({
    id: 4,
    title: 'Afișe pentru gală',
    deadline: '2026-09-18T10:00:00Z',
    group_id: 30,
    group: {
      name: 'Gala',
      short: null,
      color: null,
      category: 'project',
      path: [30],
      is_organization: false,
    },
  }),
  taskRow({
    id: 5,
    title: 'Bilanț vechi',
    deadline: '2026-09-10T10:00:00Z',
    status: 'completed',
    completed_at: '2026-09-11T10:00:00Z',
    group: edu,
  }),
];

/** Six Tasks: the list controls (Stare, Ordonează) appear. */
const sixRows = [
  ...rows,
  taskRow({
    id: 6,
    title: 'Cerere sală',
    deadline: '2026-09-25T10:00:00Z',
    campaign_id: 8,
    campaign: { name: 'Primăvară' },
    group: edu,
  }),
];

/** The list with the search the page hands it, and De gestionat's empty text. */
function ManagerTaskList(
  props: Pick<
    ComponentProps<typeof SearchedManagerTaskList>,
    'rows' | 'now' | 'onOpenTask'
  >,
) {
  const search = useTitleSearch();
  return (
    <SearchedManagerTaskList
      {...props}
      search={search}
      empty="Nu ai taskuri de gestionat acum."
    />
  );
}

function renderList(search = '', onOpenTask = vi.fn(), list = rows) {
  const view = render(
    <MemoryRouter initialEntries={[`/tracker${search}`]}>
      <ManagerTaskList rows={list} now={now} onOpenTask={onOpenTask} />
    </MemoryRouter>,
  );
  return { ...view, onOpenTask };
}

const list = () => screen.getByRole('region', { name: 'Lista taskurilor' });
const titles = () =>
  within(list())
    .queryAllByRole('article')
    .map(
      (row) =>
        document.getElementById(row.getAttribute('aria-labelledby') ?? '')
          ?.textContent,
    );

describe('ManagerTaskList', () => {
  it('pins overdue rows first, then deadline ascending with undated last', () => {
    renderList();
    expect(titles()).toEqual([
      'Z urgent',
      'Bilanț vechi',
      'Afișe pentru gală',
      'Ședință de mentorat',
      'Viitor fără termen',
    ]);
    expect(within(list()).getByRole('status')).toHaveTextContent('5 taskuri');
  });

  it('keeps overdue first when ordered by title', async () => {
    const user = userEvent.setup();
    renderList('', vi.fn(), sixRows);
    await openFilters(user);
    // Two choices: a segmented control, not a list.
    await user.click(
      within(
        screen.getByRole('radiogroup', { name: 'Ordonează după' }),
      ).getByRole('radio', { name: 'Titlu' }),
    );
    await closeFilters(user);
    // The order is no filter: nothing is counted.
    expect(filterButton()).toHaveAccessibleName('Filtrează');
    expect(titles()).toEqual([
      'Z urgent',
      'Afișe pentru gală',
      'Bilanț vechi',
      'Cerere sală',
      'Ședință de mentorat',
      'Viitor fără termen',
    ]);
  });

  it('filters by Stare, offering only the states the list holds', async () => {
    const user = userEvent.setup();
    renderList('', vi.fn(), sixRows);
    await openFilters(user);
    const stare = screen.getByLabelText('Stare');
    await user.click(stare);
    expect(
      (await screen.findAllByRole('option')).map(
        (option) => option.textContent,
      ),
    ).toEqual([
      'Toate stările',
      'De făcut',
      'În lucru',
      'Finalizat',
      'Termen depășit',
      'Modificări cerute',
      'Finalizat cu întârziere',
    ]);
    await user.click(screen.getByRole('option', { name: 'Modificări cerute' }));
    await chooseOption(user, stare, 'Finalizat cu întârziere');
    await closeFilters(user);
    expect(titles()).toEqual(['Bilanț vechi']);
    // The chosen Stare is a chip, counted on Filtrează.
    expect(filterButton()).toHaveAccessibleName('Filtrează, 1 filtru activ');
    expect(
      screen.getByRole('button', {
        name: 'Elimină filtrul Stare: Finalizat cu întârziere',
      }),
    ).toBeVisible();
    await openFilters(user);
    await chooseOption(user, screen.getByLabelText('Stare'), 'De făcut');
    await closeFilters(user);
    expect(titles()).toEqual([
      'Afișe pentru gală',
      'Ședință de mentorat',
      'Cerere sală',
      'Viitor fără termen',
    ]);
    // The count takes no row of its own: the search's placeholder says it,
    // and a screen reader hears it as a status.
    const count = within(list()).getByRole('status');
    expect(count).toHaveTextContent('4 taskuri');
    expect(count).toHaveClass('sr-only');
    expect(
      screen.getByRole('searchbox', { name: 'Caută după titlu' }),
    ).toHaveAttribute('placeholder', 'Caută în 4 taskuri');
  });

  it('searches titles without case or diacritics, after a short pause', async () => {
    const user = userEvent.setup();
    const { rerender } = renderList('', vi.fn(), sixRows);
    await user.type(
      screen.getByRole('searchbox', { name: 'Caută după titlu' }),
      'SEDINTA',
    );
    await waitFor(() => expect(titles()).toEqual(['Ședință de mentorat']));
    // The search is visible in the toolbar, so Filtrează does not count it.
    expect(filterButton()).toHaveAccessibleName('Filtrează');
    // Below six Tasks the search stays, and still applies.
    rerender(
      <MemoryRouter initialEntries={['/tracker']}>
        <ManagerTaskList rows={rows} now={now} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('searchbox')).toHaveValue('SEDINTA');
    expect(titles()).toEqual(['Ședință de mentorat']);
    rerender(
      <MemoryRouter initialEntries={['/tracker']}>
        <ManagerTaskList rows={sixRows} now={now} />
      </MemoryRouter>,
    );
    await openFilters(user);
    await chooseOption(user, screen.getByLabelText('Stare'), 'Finalizat');
    await closeFilters(user);
    // The search is the nearer way out, so the empty state names it.
    expect(
      screen.getByText('Niciun task nu corespunde căutării.'),
    ).toBeVisible();
    // Said once: no '0 taskuri' count line above the empty state (B19).
    expect(within(list()).queryByRole('status')).toBeNull();
    expect(list()).not.toHaveTextContent('0 taskuri');
  });

  it.each([
    // A Group means it and every Group below it.
    [
      '?grup=1',
      ['Z urgent', 'Bilanț vechi', 'Ședință de mentorat', 'Viitor fără termen'],
    ],
    ['?grup=1&subgrup=2', ['Ședință de mentorat']],
    ['?grup=1&campanie=7', ['Z urgent']],
    ['?de_la=2026-09-14&pana_la=2026-09-18', ['Z urgent', 'Afișe pentru gală']],
  ])('narrows by the Work Filter in the URL (%s)', (search, expected) => {
    renderList(search);
    expect(titles()).toEqual(expected);
  });

  it('puts Stare and the order in the filter sheet as the app’s own controls, the search in the toolbar', async () => {
    const user = userEvent.setup();
    renderList('', vi.fn(), sixRows);
    const toolbar = screen.getByRole('group', { name: 'Filtre taskuri' });
    // The title search first, filling the row, then Filtrează as an icon
    // button after it (#903).
    const searchbox = within(toolbar).getByRole('searchbox', {
      name: 'Caută după titlu',
    });
    expect(searchbox).toBeVisible();
    expect(toolbar.firstElementChild).toBe(searchbox.closest('label'));
    expect(
      searchbox.compareDocumentPosition(filterButton()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByLabelText('Stare')).toBeNull();
    const sheet = await openFilters(user);
    expect(within(sheet).queryByLabelText('Origine')).toBeNull();
    // No browser drop-down: Stare is the app's select, the order — two
    // choices — a segmented control after it.
    expect(sheet.querySelectorAll('select')).toHaveLength(0);
    const stare = within(sheet).getByLabelText('Stare');
    expect(stare).toHaveAttribute('data-slot', 'select');
    expect(sheet.querySelectorAll('[data-slot=select]')).toHaveLength(1);
    const order = within(sheet).getByRole('radiogroup', {
      name: 'Ordonează după',
    });
    expect(order).toHaveAttribute('data-slot', 'segmented-radio');
    expect(
      within(order)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Termen', 'Titlu']);
    expect(within(order).getByRole('radio', { name: 'Termen' })).toBeChecked();
    expect(
      stare.compareDocumentPosition(order) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(sheet).getByRole('combobox', { name: 'Grup principal' }),
    ).toBeVisible();
    expect(
      within(sheet).getByRole('combobox', { name: 'Campanie' }),
    ).toBeVisible();
  });

  it('drops a chosen Stare the list no longer holds instead of emptying it', async () => {
    const user = userEvent.setup();
    const { rerender } = renderList('', vi.fn(), sixRows);
    await openFilters(user);
    await chooseOption(user, screen.getByLabelText('Stare'), 'Finalizat');
    await closeFilters(user);
    expect(titles()).toEqual(['Bilanț vechi']);
    const open = sixRows.filter((row) => row.status !== 'completed');
    const more = [...open, taskRow({ id: 9, title: 'Nou', group: edu })];
    rerender(
      <MemoryRouter initialEntries={['/tracker']}>
        <ManagerTaskList rows={more} now={now} />
      </MemoryRouter>,
    );
    expect(filterButton()).toHaveAccessibleName('Filtrează');
    expect(titles()).toHaveLength(more.length);
    // The state is cleared, not hidden: it does not return with its rows.
    rerender(
      <MemoryRouter initialEntries={['/tracker']}>
        <ManagerTaskList rows={sixRows} now={now} />
      </MemoryRouter>,
    );
    expect(titles()).toHaveLength(sixRows.length);
    await openFilters(user);
    expect(screen.getByLabelText('Stare')).toHaveAttribute('data-value', '');
    expect(screen.getByLabelText('Stare')).toHaveTextContent('Toate stările');
  });

  it('shows Stare and Ordonează only from six Tasks, the search always', async () => {
    const user = userEvent.setup();
    renderList();
    expect(
      screen.getByRole('searchbox', { name: 'Caută după titlu' }),
    ).toHaveAttribute('placeholder', 'Caută în 5 taskuri');
    await openFilters(user);
    expect(screen.queryByLabelText('Stare')).toBeNull();
    expect(screen.queryByLabelText('Ordonează după')).toBeNull();
  });

  it('tells a search that matches nothing from a list with no Task, with a way out', async () => {
    const user = userEvent.setup();
    const { rerender } = renderList();
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(
      await screen.findByText('Niciun task nu corespunde căutării.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Șterge căutarea' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(titles()).toHaveLength(rows.length);
    rerender(
      <MemoryRouter initialEntries={['/tracker']}>
        <ManagerTaskList rows={[]} now={now} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Nu ai taskuri de gestionat acum.')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Șterge căutarea' }),
    ).toBeNull();
    // The toolbar keeps its row over an empty list.
    expect(screen.getByRole('searchbox')).toBeVisible();
  });

  it('says the filters match nothing when no search is typed', () => {
    renderList('?de_la=2030-01-01&pana_la=2030-01-02');
    expect(
      screen.getByText('Niciun task nu corespunde filtrelor.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Șterge căutarea' }),
    ).toBeNull();
  });

  it('offers only the Groups and Campaigns of the managed Tasks (Rule W)', async () => {
    const user = userEvent.setup();
    renderList();
    await openFilters(user);
    await user.click(screen.getByRole('combobox', { name: 'Grup principal' }));
    // The Adunarea Generală is readable but owns no Task here.
    expect(
      (await screen.findAllByRole('option')).map((o) => o.textContent),
    ).toEqual(['Educațional', 'Gala']);
    // Only Toamnă labels a Task: a one-option level is not drawn.
    expect(screen.queryByRole('combobox', { name: 'Campanie' })).toBeNull();
  });

  it('asks for a valid range while the dates are inverted', () => {
    renderList('?de_la=2026-09-20&pana_la=2026-09-01');
    expect(
      screen.getByText('Corectează perioada din filtre ca să vezi taskurile.'),
    ).toBeVisible();
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('never scrolls sideways at 360 px: no table, no horizontal overflow, every row wraps', () => {
    window.innerWidth = 360;
    const { container } = renderList();
    expect(screen.queryByRole('table')).toBeNull();
    expect(container.querySelector('.overflow-x-auto')).toBeNull();
    // Only the short status badges and the points keep their words
    // together; they wrap as whole items.
    expect(
      list().querySelector(
        '.whitespace-nowrap:not([data-slot="badge"]):not([data-slot="list-row-value"])',
      ),
    ).toBeNull();
    expect(container.querySelector('[data-slot="task-row-list"]')).toHaveClass(
      'min-w-0',
    );
    for (const row of within(list()).getAllByRole('article')) {
      expect(row).toHaveClass('min-w-0');
      // The title has the row's whole width and wraps by word (layout T1,
      // #846); the meta line under it wraps as whole items.
      const heading = row.querySelector('h2');
      expect(heading).toHaveClass('wrap-break-word');
      expect(heading).not.toHaveClass('text-balance');
      expect(row.querySelector('[data-slot="list-row-value"]')).toBeNull();
      const meta = row.querySelector('[data-slot="task-row-meta"]');
      expect(meta).toHaveClass('flex-wrap', 'min-w-0');
    }
  });

  it('shows the Group, status badges, deadline, Executor and points on each row', () => {
    renderList();
    const overdue = screen.getByRole('article', { name: 'Z urgent' });
    expect(overdue).toHaveAttribute('data-overdue');
    expect(
      within(overdue).getByText('Departament · Educațional'),
    ).toBeVisible();
    expect(within(overdue).getByText('În lucru')).toBeVisible();
    expect(within(overdue).getByText('Termen depășit')).toBeVisible();
    expect(within(overdue).getByText('Modificări cerute')).toBeVisible();
    expect(within(overdue).getByText(/Executor/)).toBeVisible();
    expect(
      within(screen.getByRole('article', { name: 'Bilanț vechi' })).getByText(
        'Finalizat cu întârziere',
      ),
    ).toBeVisible();
  });

  it('opens the details sheet from a row by pointer and by keyboard', async () => {
    const user = userEvent.setup();
    const { onOpenTask } = renderList();
    await user.click(screen.getByRole('button', { name: 'Z urgent' }));
    expect(onOpenTask).toHaveBeenLastCalledWith(2);
    screen.getByRole('button', { name: 'Afișe pentru gală' }).focus();
    await user.keyboard('{Enter}');
    expect(onOpenTask).toHaveBeenLastCalledWith(4);
  });

  it('has no axe violations', async () => {
    const { container } = renderList();
    expect(
      (
        await axe.run(container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });
});

describe('compareManagedTasks', () => {
  it('orders overdue, then deadline (undated last), then title, then id', () => {
    const tasks = [
      taskRow({ id: 9, title: 'B', deadline: null }),
      taskRow({ id: 8, title: 'A', deadline: null }),
      taskRow({ id: 7, title: 'A', deadline: null }),
      taskRow({ id: 6, title: 'C', deadline: '2026-09-20T00:00:00Z' }),
      taskRow({ id: 5, title: 'D', deadline: '2026-09-01T00:00:00Z' }),
    ].map((row) => toTaskPresentation(row, now));
    expect(
      [...tasks].sort(compareManagedTasks('deadline')).map((task) => task.id),
    ).toEqual([5, 6, 7, 8, 9]);
    expect(
      [...tasks].sort(compareManagedTasks('title')).map((task) => task.id),
    ).toEqual([5, 7, 8, 9, 6]);
  });
});

describe('ManagerTaskList under Grupuri preferate (R43)', () => {
  const mentorat = { ...edu, name: 'Mentorat', category: 'team', path: [1, 2] };
  const gala = { ...edu, name: 'Gala', path: [30] };
  const preferredRows = [
    taskRow({ id: 61, title: 'Din Educațional', assignments: [], group: edu }),
    taskRow({
      id: 62,
      title: 'Din Gala',
      group_id: 30,
      assignments: [],
      group: gala,
    }),
    taskRow({
      id: 63,
      title: 'Din Gala, al meu',
      group_id: 30,
      assignments: [{ id: 9, member_id: 'me', ended_at: null }],
      group: gala,
    }),
    taskRow({
      id: 64,
      title: 'Din Mentorat',
      group_id: 2,
      assignments: [],
      group: mentorat,
    }),
  ];
  function renderPreferred(search = '') {
    return render(
      <MemoryRouter initialEntries={[`/tracker${search}`]}>
        <PreferredGroupsScope>
          <ManagerTaskList rows={preferredRows} now={now} />
        </PreferredGroupsScope>
      </MemoryRouter>,
    );
  }

  it('leaves out the unselected Groups -- a subgroup alone too -- but never a Task the member executes', () => {
    preferences.muted = new Set([30, 2]);
    renderPreferred();
    expect(titles().sort()).toEqual(['Din Educațional', 'Din Gala, al meu']);
    preferences.muted = new Set();
  });

  it('shows everything after Arată tot', async () => {
    preferences.muted = new Set([30, 2]);
    const user = userEvent.setup();
    renderPreferred();
    await user.click(
      screen.getByRole('button', { name: 'Doar grupurile preferate' }),
    );
    expect(titles()).toHaveLength(4);
    preferences.muted = new Set();
  });

  it('changes nothing outside a page that follows the preference', () => {
    preferences.muted = new Set([30, 2]);
    renderList('', vi.fn(), preferredRows);
    expect(titles()).toHaveLength(4);
    preferences.muted = new Set();
  });
});

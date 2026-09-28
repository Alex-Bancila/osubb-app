import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
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
import { taskRow } from '../../test/task-fixtures';
import { ManagerTaskList } from './ManagerTaskList';
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

/** Six Tasks: the list controls (Stare, Caută, Ordonează) appear. */
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
    await user.selectOptions(screen.getByLabelText('Ordonează după'), 'title');
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
    const stare = screen.getByLabelText('Stare');
    expect(
      within(stare)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Toate stările',
      'De făcut',
      'În lucru',
      'Finalizat',
      'Termen depășit',
      'Modificări cerute',
      'Finalizat cu întârziere',
    ]);
    await user.selectOptions(stare, 'feedback');
    expect(titles()).toEqual(['Z urgent']);
    await user.selectOptions(stare, 'late');
    expect(titles()).toEqual(['Bilanț vechi']);
    await user.selectOptions(stare, 'todo');
    expect(titles()).toEqual([
      'Afișe pentru gală',
      'Ședință de mentorat',
      'Cerere sală',
      'Viitor fără termen',
    ]);
    expect(within(list()).getByRole('status')).toHaveTextContent('4 taskuri');
  });

  it('searches titles without case or diacritics, after a short pause', async () => {
    const user = userEvent.setup();
    renderList('', vi.fn(), sixRows);
    await user.type(
      screen.getByRole('searchbox', { name: 'Caută după titlu' }),
      'SEDINTA',
    );
    await waitFor(() => expect(titles()).toEqual(['Ședință de mentorat']));
    // The phone's Filtre button counts the applied search.
    expect(
      screen.getByRole('button', { name: 'Filtre (1)' }),
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Stare'), 'completed');
    expect(
      screen.getByText('Niciun task nu corespunde filtrelor.'),
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

  it('puts Stare and the order inside the one Filtre panel, on the #842 select', () => {
    const { container } = renderList('', vi.fn(), sixRows);
    expect(screen.queryByLabelText('Origine')).toBeNull();
    // The only native selects left are Stare and the order.
    const selects = container.querySelectorAll('select');
    expect(selects).toHaveLength(2);
    expect(screen.getByLabelText('Stare')).toBe(selects[0]);
    expect(screen.getByLabelText('Ordonează după')).toBe(selects[1]);
    const filter = screen.getByRole('region', { name: 'Filtre taskuri' });
    // One filter band (layout T4): the list controls sit on the panel's grid.
    const grid = filter.querySelector('[data-slot=work-filter-grid]');
    expect(grid).toContainElement(screen.getByLabelText('Stare'));
    expect(grid).toContainElement(
      screen.getByRole('searchbox', { name: 'Caută după titlu' }),
    );
    expect(screen.getByLabelText('Stare')).toHaveAttribute(
      'data-slot',
      'native-select',
    );
    expect(
      within(filter).getByRole('combobox', { name: 'Grup principal' }),
    ).toBeVisible();
    expect(
      within(filter).getByRole('combobox', { name: 'Campanie' }),
    ).toBeVisible();
  });

  it('shows Stare, Caută and Ordonează only from six Tasks', () => {
    renderList();
    expect(screen.queryByLabelText('Stare')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByLabelText('Ordonează după')).toBeNull();
  });

  it('offers only the Groups and Campaigns of the managed Tasks (Rule W)', async () => {
    const user = userEvent.setup();
    renderList();
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
    // Only the short status badges keep their words together; they wrap as
    // whole items.
    expect(
      list().querySelector('.whitespace-nowrap:not([data-slot="badge"])'),
    ).toBeNull();
    expect(container.querySelector('[data-slot="task-row-list"]')).toHaveClass(
      'min-w-0',
    );
    for (const row of within(list()).getAllByRole('article')) {
      expect(row).toHaveClass('min-w-0');
      // One line when there is room; below `sm` the title takes its own line.
      const line = row.querySelector(':scope > div');
      expect(line).toHaveClass('flex-wrap', 'min-w-0');
      const heading = row.querySelector('h2');
      expect(heading).toHaveClass('basis-full', 'sm:basis-0', 'wrap-anywhere');
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

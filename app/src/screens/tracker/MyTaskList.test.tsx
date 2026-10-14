import { render, screen, waitFor, within } from '@testing-library/react';
import { useMemo, type ComponentProps } from 'react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}));
// R43: Grupuri preferate, read by the page's scope; it must never narrow
// the Member's own list.
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
        { id: 30, name: 'Gala', path: [30], status: 'active' },
        // Readable, but owns no Task of the Member's (Rule W).
        { id: 40, name: 'Adunarea Generală', path: [40], status: 'active' },
      ],
      campaigns: [
        { id: 7, name: 'Toamnă', group_id: 1 },
        { id: 8, name: 'Primăvară', group_id: 30 },
      ],
    },
  }),
}));
vi.mock('../../queries/task-progress', () => ({
  useTaskProgress: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../queries/task-queue', () => ({
  useTaskQueue: () => ({ data: undefined, isPending: true, isError: false }),
}));
vi.mock('../../queries/task-give-up', () => ({
  useGiveUpTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../queries/task-withdrawal', () => ({
  useWithdrawTaskInterest: () => ({ mutateAsync: vi.fn() }),
}));
// R55: the finished Tasks and what the list holds come from the server.
const lists = vi.hoisted(() => ({ finished: vi.fn(), summary: vi.fn() }));
vi.mock('../../queries/task-lists', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries/task-lists')>()),
  useFinishedTasks: (...args: unknown[]) => lists.finished(...args),
  useTaskListSummary: (...args: unknown[]) => lists.summary(...args),
}));
import type {
  FinishedTasks,
  TaskListSummaryRow,
} from '../../queries/task-lists';
import { openFilters } from '../../test/filters';
import { taskRow } from '../../test/task-fixtures';
import { PreferredGroupsScope } from '../../components/preferred-groups/PreferredGroupsScope';
import { MyTaskList as SearchedMyTaskList } from './MyTaskList';
import { useTitleSearch } from './use-title-search';
import type { TaskPresentationRow } from './task-presentation';

/** The finished part as the list reads it; nothing unless a test says so. */
function finishedRead(overrides: Partial<FinishedTasks> = {}): FinishedTasks {
  return {
    rows: [],
    total: 0,
    isPending: false,
    isError: false,
    error: null,
    hasMore: false,
    isLoadingMore: false,
    isFetching: false,
    moreFailed: false,
    loadMore: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}
function summaryRow(
  overrides: Partial<TaskListSummaryRow>,
): TaskListSummaryRow {
  return {
    group_id: 1,
    campaign_id: null,
    status: 'completed',
    late: false,
    dated: true,
    tasks: 1,
    ...overrides,
  };
}
beforeEach(() => {
  lists.finished.mockReset();
  lists.finished.mockReturnValue(finishedRead());
  lists.summary.mockReset();
  lists.summary.mockReturnValue({ data: [] });
  preferences.muted = new Set();
});

const now = new Date('2026-09-15T12:00:00Z');
const edu = {
  name: 'Educațional',
  short: 'EDU',
  color: '#0a7d4f',
  category: 'department',
  path: [1],
  is_organization: false,
};
const gala = {
  name: 'Gala',
  short: null,
  color: null,
  category: 'project',
  path: [30],
  is_organization: false,
};
const mine = [{ id: 1, member_id: 'me', ended_at: null }];
/** The Member's open Tasks. */
const rows = [
  taskRow({
    id: 1,
    title: 'Pregătește materialele',
    deadline: '2026-09-18T10:00:00Z',
    group: edu,
    assignments: mine,
  }),
  taskRow({
    id: 2,
    title: 'Ședință de mentorat',
    deadline: '2026-09-20T10:00:00Z',
    status: 'in_progress',
    group: edu,
    assignments: mine,
  }),
];
/** Finished Tasks of the Member, as the server's first page sends them. */
const done = [
  taskRow({
    id: 71,
    title: 'Raport de martie',
    status: 'completed',
    deadline: '2026-03-31T10:00:00Z',
    completed_at: '2026-03-30T10:00:00Z',
    group: edu,
    assignments: [{ id: 3, member_id: 'me', ended_at: '2026-03-30T10:00:00Z' }],
  }),
  taskRow({
    id: 72,
    title: 'Afiș vechi',
    status: 'cancelled',
    deadline: '2026-02-10T10:00:00Z',
    group_id: 30,
    group: gala,
    assignments: [],
  }),
];
/** What the server says the list holds beside the open rows. */
const held = [
  summaryRow({ group_id: 1, status: 'todo', tasks: 1 }),
  summaryRow({ group_id: 1, status: 'in_progress', tasks: 1 }),
  summaryRow({ group_id: 1, status: 'completed', tasks: 1 }),
  summaryRow({ group_id: 30, campaign_id: 8, status: 'cancelled', tasks: 1 }),
];

type ListProps = ComponentProps<typeof SearchedMyTaskList>;
const NO_ROWS: readonly TaskPresentationRow[] = [];

/**
 * The list with the search the page hands it. `rows` are its open Tasks,
 * already read, unless `open` says how that read stands.
 */
function MyTaskList({
  rows: openRows = NO_ROWS,
  open,
  ...props
}: Partial<Omit<ListProps, 'open' | 'search'>> & {
  rows?: readonly TaskPresentationRow[];
  open?: ListProps['open'];
}) {
  const search = useTitleSearch();
  const read = useMemo(
    () => ({
      data: [...openRows],
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }),
    [openRows],
  );
  return (
    <SearchedMyTaskList
      now={now}
      onOpenTask={vi.fn()}
      {...props}
      open={open ?? read}
      search={search}
    />
  );
}

function renderList(
  url = '/tracker',
  props: Parameters<typeof MyTaskList>[0] = {},
) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <MyTaskList rows={rows} {...props} />
    </MemoryRouter>,
  );
}

const titles = () =>
  screen
    .queryAllByRole('article')
    .map(
      (row) =>
        document.getElementById(row.getAttribute('aria-labelledby') ?? '')
          ?.textContent,
    );
const lastFinishedCall = () => lists.finished.mock.calls.at(-1) ?? [];
const searchbox = () =>
  screen.getByRole('searchbox', { name: 'Caută după titlu' });

describe('MyTaskList, the finished Tasks (ruling R55)', () => {
  // Fails if Taskurile mele asks for its finished part only once its open
  // Tasks have landed, or draws anything above their loading state.
  it('asks for them while the open Tasks are on their way, and draws neither part until those land', () => {
    lists.finished.mockReturnValue(finishedRead({ rows: done, total: 2 }));
    lists.summary.mockReturnValue({ data: held });
    const loading = {
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
    const view = renderList('/tracker', { open: loading });
    expect(lastFinishedCall()).toEqual(['mine', {}, true]);
    expect(lists.summary).toHaveBeenLastCalledWith('mine', true);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Se încarcă taskurile…',
    );
    expect(
      screen.queryByRole('region', { name: 'Taskuri încheiate' }),
    ).toBeNull();
    view.rerender(
      <MemoryRouter initialEntries={['/tracker']}>
        <MyTaskList rows={rows} />
      </MemoryRouter>,
    );
    expect(titles()).toHaveLength(rows.length + done.length);
  });

  // Fails if the finished Tasks are mixed into the open ones by deadline
  // (R10, before R55), or drawn without their heading and count.
  it('draws them after the open Tasks, newest first under their heading, and counts both', () => {
    lists.finished.mockReturnValue(finishedRead({ rows: done, total: 2 }));
    lists.summary.mockReturnValue({ data: held });
    renderList();
    expect(titles()).toEqual([
      'Pregătește materialele',
      'Ședință de mentorat',
      'Raport de martie',
      'Afiș vechi',
    ]);
    const finished = screen.getByRole('region', { name: 'Taskuri încheiate' });
    expect(
      within(finished)
        .getAllByRole('article')
        .map((row) => row.querySelector('h3')?.textContent),
    ).toEqual(['Raport de martie', 'Afiș vechi']);
    expect(within(finished).getByText('2 taskuri')).toBeVisible();
    expect(searchbox()).toHaveAttribute('placeholder', 'Caută în 4 taskuri');
  });

  // Fails if the server is not told the Work Filter and the search, or is
  // told a state, an order or Grupuri preferate: R43 never narrows a
  // Member's own list, and it has no Stare nor Ordonează.
  it('sends the Work Filter and the search to the server, never Grupuri preferate', async () => {
    const user = userEvent.setup();
    preferences.muted = new Set([30]);
    lists.summary.mockReturnValue({ data: held });
    render(
      <MemoryRouter
        initialEntries={['/tracker?grup=1&de_la=2026-09-14&pana_la=2026-09-18']}
      >
        <PreferredGroupsScope>
          <MyTaskList rows={rows} />
        </PreferredGroupsScope>
      </MemoryRouter>,
    );
    expect(lastFinishedCall()).toEqual([
      'mine',
      {
        p_group_id: 1,
        p_from: '2026-09-13T21:00:00.000Z',
        p_to: '2026-09-18T21:00:00.000Z',
      },
      true,
    ]);
    await user.type(searchbox(), 'RAPORT ');
    await waitFor(() =>
      expect(lastFinishedCall()[1]).toEqual({
        p_group_id: 1,
        p_from: '2026-09-13T21:00:00.000Z',
        p_to: '2026-09-18T21:00:00.000Z',
        p_search: 'raport',
      }),
    );
    // Neither Stare nor Ordonează: the sheet holds the Work Filter alone.
    const sheet = await openFilters(user);
    expect(within(sheet).queryByLabelText('Stare')).toBeNull();
    expect(
      within(sheet).queryByRole('radiogroup', { name: 'Ordonează după' }),
    ).toBeNull();
  });

  it('asks nothing while the dates are inverted', () => {
    renderList('/tracker?de_la=2026-09-20&pana_la=2026-09-01');
    expect(lastFinishedCall()[1]).toBeNull();
    expect(
      screen.getByText('Corectează perioada din filtre ca să vezi taskurile.'),
    ).toBeVisible();
  });

  // Fails if Rule W offers only the open rows' Groups and Campaigns: Gala
  // and Primăvară label a finished Task alone.
  it('offers the Groups and Campaigns of the finished Tasks too (Rule W)', async () => {
    const user = userEvent.setup();
    lists.summary.mockReturnValue({ data: held });
    renderList();
    await openFilters(user);
    await user.click(screen.getByRole('combobox', { name: 'Grup principal' }));
    expect(
      (await screen.findAllByRole('option')).map((o) => o.textContent),
    ).toEqual(['Educațional', 'Gala']);
  });

  // Fails if a failed summary read is silent: the Work Filter would offer
  // only what the open rows hold, as if that were everything.
  it('offers a retry where the choices would be when what the list holds cannot be read', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    lists.summary.mockReturnValue({
      data: undefined,
      isError: true,
      error: new Error('boom'),
      refetch,
    });
    renderList();
    expect(titles()).toHaveLength(rows.length);
    expect(searchbox()).toBeEnabled();
    const sheet = await openFilters(user);
    expect(
      within(sheet).queryByRole('combobox', { name: 'Grup principal' }),
    ).toBeNull();
    const alert = within(sheet).getByRole('alert');
    expect(alert).toHaveTextContent('Nu am putut încărca filtrele.');
    await user.click(
      within(alert).getByRole('button', { name: 'Încearcă din nou' }),
    );
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('holds the place of the choices while what the list holds is first read', async () => {
    const user = userEvent.setup();
    lists.summary.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
      errorUpdateCount: 0,
      refetch: vi.fn(),
    });
    renderList();
    const sheet = await openFilters(user);
    expect(within(sheet).getByRole('status')).toHaveTextContent(
      'Se încarcă filtrele…',
    );
    expect(
      within(sheet).queryByRole('combobox', { name: 'Grup principal' }),
    ).toBeNull();
  });

  it('loads the next page from the button', async () => {
    const user = userEvent.setup();
    const loadMore = vi.fn();
    lists.finished.mockReturnValue(
      finishedRead({ rows: done, total: 120, hasMore: true, loadMore }),
    );
    renderList();
    await user.click(screen.getByRole('button', { name: 'Încarcă mai multe' }));
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  // Fails if the end of the list is watched while the first page is read
  // again after a change: coming into view, it would ask for page 2 on top
  // of the old one.
  it('loads the next page when the end comes into view, watching it only while nothing is read', () => {
    let watching = 0;
    let enter: (entries: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: typeof enter) {
          enter = callback;
        }
        observe() {
          watching += 1;
        }
        disconnect() {
          watching -= 1;
        }
      },
    );
    const loadMore = vi.fn();
    const page = (overrides: Partial<FinishedTasks>) =>
      finishedRead({
        rows: done,
        total: 120,
        hasMore: true,
        loadMore,
        ...overrides,
      });
    lists.finished.mockReturnValue(page({ isFetching: true }));
    const view = renderList();
    expect(watching).toBe(0);
    lists.finished.mockReturnValue(page({}));
    view.rerender(
      <MemoryRouter initialEntries={['/tracker']}>
        <MyTaskList rows={rows} />
      </MemoryRouter>,
    );
    expect(watching).toBe(1);
    enter([{ isIntersecting: true }]);
    expect(loadMore).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('keeps what is loaded and offers a retry when a later page fails', async () => {
    const user = userEvent.setup();
    const loadMore = vi.fn();
    lists.finished.mockReturnValue(
      finishedRead({
        rows: done,
        total: 120,
        hasMore: true,
        moreFailed: true,
        loadMore,
      }),
    );
    renderList();
    expect(titles()).toContain('Raport de martie');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Nu am putut încărca mai multe taskuri.');
    await user.click(
      within(alert).getByRole('button', { name: 'Încearcă din nou' }),
    );
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('shows the open Tasks and a retry when the finished ones cannot be read', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    lists.finished.mockReturnValue(
      finishedRead({ isError: true, error: new Error('boom'), refetch }),
    );
    renderList();
    expect(titles()).toHaveLength(rows.length);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Nu am putut încărca taskurile încheiate.');
    await user.click(
      within(alert).getByRole('button', { name: 'Încearcă din nou' }),
    );
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  // Fails if the list calls itself empty while its finished part is on its
  // way: a Member with only finished Tasks would read "Nu ai niciun task".
  it('holds the place of the finished Tasks while the first page is on its way, and never calls that empty', () => {
    lists.finished.mockReturnValue(
      finishedRead({ isPending: true, total: undefined }),
    );
    renderList('/tracker', { rows: [] });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Se încarcă taskurile încheiate…',
    );
    expect(screen.queryByText('Nu ai niciun task atribuit încă.')).toBeNull();
    expect(searchbox()).toHaveAttribute('placeholder', 'Caută după titlu');
  });

  it('never draws a Task twice while the open read still holds one that just finished', () => {
    lists.finished.mockReturnValue(
      finishedRead({
        rows: [taskRow({ ...rows[0], status: 'completed' }), ...done],
        total: 3,
      }),
    );
    renderList();
    expect(
      titles().filter((title) => title === 'Pregătește materialele'),
    ).toHaveLength(1);
  });

  it('opens the details sheet from a finished row', async () => {
    const user = userEvent.setup();
    const onOpenTask = vi.fn();
    lists.finished.mockReturnValue(finishedRead({ rows: done, total: 2 }));
    renderList('/tracker', { onOpenTask });
    await user.click(screen.getByRole('button', { name: 'Raport de martie' }));
    expect(onOpenTask).toHaveBeenLastCalledWith(71);
  });

  it('keeps the linked open Task whatever the search, and highlights it', async () => {
    const user = userEvent.setup();
    renderList('/tracker', { linkedId: 2, highlightedId: 2 });
    await user.type(searchbox(), 'materialele');
    // The search has settled: the server is asked with it.
    await waitFor(() =>
      expect(lastFinishedCall()[1]).toEqual({ p_search: 'materialele' }),
    );
    expect(titles()).toEqual(['Pregătește materialele', 'Ședință de mentorat']);
    expect(
      screen.getByRole('article', { name: 'Ședință de mentorat' }),
    ).toHaveAttribute('data-highlighted');
  });

  it('has no axe violations with both parts drawn', async () => {
    lists.finished.mockReturnValue(
      finishedRead({ rows: done, total: 120, hasMore: true }),
    );
    lists.summary.mockReturnValue({ data: held });
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

describe('MyTaskList, its empty states', () => {
  // Fails if "Nu ai niciun task" is said of a Member whose Tasks are all
  // finished, or whose summary holds work the filters leave out.
  it('says the Member has no Task only when neither the open rows nor the summary hold one', () => {
    renderList('/tracker', { rows: [] });
    expect(screen.getByText('Nu ai niciun task atribuit încă.')).toBeVisible();
  });

  it('says the filters match nothing when the summary holds Tasks they leave out', () => {
    lists.summary.mockReturnValue({ data: held });
    renderList('/tracker?grup=40', { rows: [] });
    expect(
      screen.getByText('Niciun task nu corespunde filtrelor.'),
    ).toBeVisible();
    expect(screen.queryByText('Nu ai niciun task atribuit încă.')).toBeNull();
  });

  it('tells a search that matches nothing from a list with no Task, with a way out', async () => {
    const user = userEvent.setup();
    lists.summary.mockReturnValue({ data: held });
    renderList();
    await user.type(searchbox(), 'nimic de găsit');
    expect(
      await screen.findByText('Niciun task nu corespunde căutării.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Șterge căutarea' }));
    expect(titles()).toHaveLength(rows.length);
  });

  it('says the Member has no Task when the summary cannot be read but nothing narrows an empty list', () => {
    lists.summary.mockReturnValue({
      data: undefined,
      isError: true,
      error: new Error('boom'),
      refetch: vi.fn(),
    });
    renderList('/tracker', { rows: [] });
    expect(screen.getByText('Nu ai niciun task atribuit încă.')).toBeVisible();
  });
});

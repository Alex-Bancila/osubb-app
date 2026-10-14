import { act, render, screen, waitFor, within } from '@testing-library/react';
import { swipe } from '../../test/swipe';
import type { ReactNode } from 'react';
import { Link, MemoryRouter, useLocation, useNavigate } from 'react-router';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// R43: Grupuri preferate. Nothing is unselected unless a test says so.
const preferences = vi.hoisted(() => ({
  muted: new Set<number>() as ReadonlySet<number>,
  memberId: undefined as string | undefined,
  /** The member's preference is still being read. */
  pending: false,
}));
vi.mock('../../queries/group-preferences', () => ({
  usePreferredGroupsData: () => ({
    muted: preferences.muted,
    memberId: preferences.memberId,
  }),
  useGroupPreferences: () => ({ isPending: preferences.pending }),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import { taskRow } from '../../test/task-fixtures';
import { orderOpportunities } from '../../queries/task-opportunities';

const hooks = vi.hoisted(() => ({
  useMyTasks: vi.fn(),
  useTaskProgress: vi.fn(),
  useTaskOpportunities: vi.fn(),
  useTaskManagement: vi.fn(),
  useTaskLeadership: vi.fn(),
  useManagedTasks: vi.fn(),
  useAllTasks: vi.fn(),
  useMyPoints: vi.fn(),
  useTaskQueue: vi.fn(),
  usePendingDecisions: vi.fn(),
  join: vi.fn(),
  level: 1,
  seeLeadership: false,
}));
vi.mock('../../queries/request-decisions', () => ({
  usePendingDecisions: hooks.usePendingDecisions,
}));
// The Requests have their own suite (RequestsView.test.tsx); here the view is
// only told apart from the Task lists.
vi.mock('../requests/RequestsView', () => ({
  RequestsView: () => <h2>Cereri view</h2>,
}));
vi.mock('../../lib/capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/capabilities')>()),
  useCapability: (capability: string) => ({
    data: capability === 'seeLeadership' ? hooks.seeLeadership : false,
  }),
}));
vi.mock('../../queries/task-queue', () => ({
  useTaskQueue: hooks.useTaskQueue,
}));
vi.mock('../../queries/task-interest', () => ({
  useExpressTaskInterest: () => ({ mutateAsync: hooks.join }),
  TaskInterestError: Error,
}));
vi.mock('../../queries/task-withdrawal', () => ({
  useWithdrawTaskInterest: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../../queries/work-filter-options', () => ({
  useWorkFilterOptions: () => ({
    isPending: false,
    isError: false,
    data: {
      groups: [
        {
          id: 5,
          name: 'Organizația',
          path: [5],
          status: 'active',
          is_organization: true,
        },
        { id: 10, name: 'Educațional', path: [10], status: 'active' },
        { id: 20, name: 'Resurse Umane', path: [20], status: 'active' },
        { id: 21, name: 'Recrutare', path: [20, 21], status: 'active' },
      ],
      campaigns: [{ id: 7, name: 'Recrutări de toamnă', group_id: 20 }],
    },
  }),
}));
vi.mock('../../queries/points', () => ({ useMyPoints: hooks.useMyPoints }));
vi.mock('../../queries/profile', () => ({
  useMyProfile: () => ({ data: { role: 'vot' } }),
}));
vi.mock('../../queries/reference', () => ({
  useRoles: () => ({
    data: new Map([
      ['vot', { id: 'vot', name: 'Membru cu Drept de Vot', level: 2 }],
    ]),
  }),
  // The score's Role label (#963): no board row, no Board Title.
  useMyGroups: () => ({ membershipRows: [] }),
  boardTitleFrom: () => null,
}));
vi.mock('../../queries/org-settings', () => ({
  useOrgSettings: () => ({ data: undefined }),
}));
vi.mock('../../queries/task-opportunities', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../queries/task-opportunities')
  >()),
  useTaskOpportunities: hooks.useTaskOpportunities,
}));
vi.mock('../../queries/task-tabs', () => ({
  useTaskManagement: hooks.useTaskManagement,
  useTaskLeadership: hooks.useTaskLeadership,
  useManagedTasks: hooks.useManagedTasks,
  useAllTasks: hooks.useAllTasks,
}));
// #1053, R55: the finished part of a list, what the list holds, and the
// three one-Task questions a link asks. Nothing unless a test says so.
const listReads = vi.hoisted(() => ({
  finished: vi.fn(),
  prefetch: vi.fn(),
  summary: vi.fn(),
  capability: vi.fn(),
  readable: vi.fn(),
  isMine: vi.fn(),
}));
vi.mock('../../queries/task-lists', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries/task-lists')>()),
  useFinishedTasks: (...args: unknown[]) => listReads.finished(...args),
  usePrefetchFinishedTasks: (...args: unknown[]) => listReads.prefetch(...args),
  useTaskListSummary: (...args: unknown[]) => listReads.summary(...args),
  useTaskManageCapability: (...args: unknown[]) =>
    listReads.capability(...args),
  useTaskReadable: (...args: unknown[]) => listReads.readable(...args),
  useTaskIsMine: (...args: unknown[]) => listReads.isMine(...args),
}));
vi.mock('../../queries/tasks', () => ({ useMyTasks: hooks.useMyTasks }));
vi.mock('../../queries/task-progress', () => ({
  useTaskProgress: hooks.useTaskProgress,
}));
vi.mock('../../queries/task-give-up', () => ({
  useGiveUpTask: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
}));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    session: { user: { id: 'member' } },
    claims: { member_level: hooks.level },
  }),
}));
// "Task nou" has its own suite; here it only reports a created Task.
vi.mock('./NewTaskControl', () => ({
  NewTaskControl: ({
    onCreated,
  }: {
    onCreated: (created: { ids: number[] }) => void;
  }) => (
    <button type="button" onClick={() => onCreated({ ids: [42] })}>
      Task nou
    </button>
  ),
}));
// "Adaugă task finalizat" has its own suite too (#915).
vi.mock('./AddCompletedTaskControl', () => ({
  AddCompletedTaskControl: ({
    onAdded,
  }: {
    onAdded: (added: { ids: number[]; title: string }) => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() => onAdded({ ids: [43], title: 'Stand la târg' })}
      >
        Adaugă task finalizat
      </button>
      <button
        type="button"
        onClick={() => onAdded({ ids: [43, 44, 45], title: 'Stand la târg' })}
      >
        Adaugă 3 taskuri finalizate
      </button>
    </>
  ),
}));
vi.mock('./TaskDetailsSheet', () => ({
  TaskDetailsSheet: ({
    taskId,
    managedTaskIds,
    askManage,
    notice,
    onClose,
    onDeleted,
  }: {
    taskId: number | null;
    managedTaskIds?: ReadonlySet<number>;
    askManage?: boolean;
    notice?: string | null;
    onClose: () => void;
    onDeleted?: (receipt: string) => void;
  }) =>
    taskId === null ? null : (
      <div role="dialog" aria-label="Detalii task">
        <p>Task #{taskId}</p>
        <p>
          gestionate:{' '}
          {[...(managedTaskIds ?? [])].sort((a, b) => a - b).join(',')}
        </p>
        <p>întreabă: {askManage ? 'da' : 'nu'}</p>
        {notice && <p role="status">{notice}</p>}
        <button type="button" onClick={onClose}>
          Închide detaliile
        </button>
        <button
          type="button"
          onClick={() => onDeleted?.('Taskul a fost șters definitiv.')}
        >
          Șterge taskul din detalii
        </button>
      </div>
    ),
}));
import TrackerScreen from './TrackerScreen';

/** The finished part with nothing in it. */
function noFinished() {
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
  };
}
beforeEach(() => {
  listReads.finished.mockReset();
  listReads.finished.mockReturnValue(noFinished());
  listReads.prefetch.mockReset();
  listReads.summary.mockReset();
  listReads.summary.mockReturnValue({ data: [], isError: false });
  listReads.capability.mockReset();
  listReads.capability.mockReturnValue({ data: false, isError: false });
  listReads.readable.mockReset();
  listReads.readable.mockReturnValue({ data: false, isError: false });
  listReads.isMine.mockReset();
  listReads.isMine.mockReturnValue({ data: false, isError: false });
});

function Router({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/tracker']}>{children}</MemoryRouter>;
}

function tree(url: string) {
  return (
    <MemoryRouter initialEntries={[url]}>
      <Link to="/tracker?task=2">Deschide taskul 2</Link>
      <Link to="/tracker?task=99">Deschide taskul 99</Link>
      <TrackerScreen />
    </MemoryRouter>
  );
}

function renderAt(url: string) {
  return render(tree(url));
}

function query(overrides: Record<string, unknown> = {}) {
  const refetch = vi.fn();
  hooks.useMyTasks.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    isSuccess: !overrides.isPending && !overrides.isError,
    refetch,
    ...overrides,
  });
  return refetch;
}

describe('My tasks screen', () => {
  beforeEach(() => {
    hooks.level = 1;
    hooks.seeLeadership = false;
    hooks.useTaskOpportunities.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
    });
    hooks.useTaskManagement.mockReturnValue({
      data: false,
      isPending: false,
      isError: false,
    });
    hooks.useManagedTasks.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
    });
    hooks.useTaskLeadership.mockReturnValue({
      data: false,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    hooks.useAllTasks.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
    });
    hooks.useTaskProgress.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    });
    hooks.useMyPoints.mockReturnValue({
      data: 12,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    hooks.usePendingDecisions.mockReturnValue({ data: [], isError: false });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows loading and then an informative empty state', () => {
    query({ isPending: true, data: undefined });
    const { rerender } = render(<TrackerScreen />, { wrapper: Router });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Se încarcă taskurile',
    );
    query();
    rerender(<TrackerScreen />);
    expect(
      screen.getByText('Nu ai niciun task atribuit încă.'),
    ).toBeInTheDocument();
  });

  /* Audit D-3: the given-up Task leaves Taskurile mele on the refetch, so the
     receipt lives on the list, not on the card that disappears. */
  it('keeps the give-up receipt after the card leaves the list', async () => {
    const user = userEvent.setup();
    hooks.useTaskQueue.mockReturnValue({
      data: { status: null, position: null },
      isPending: false,
      isError: false,
    });
    query({
      data: [
        taskRow({
          id: 8,
          title: 'Stand la târg',
          status: 'todo',
          visibleExecutor: { memberId: 'member', fullName: 'Membru' },
        }),
      ],
    });
    const { rerender } = render(<TrackerScreen />, { wrapper: Router });

    await user.click(screen.getByRole('button', { name: 'Renunță la task' }));
    await user.type(screen.getByLabelText('Motivul renunțării'), 'Examen');
    // The refetch after the command no longer lists the Task.
    query({ data: [] });
    await user.click(
      screen.getByRole('button', { name: 'Confirmă renunțarea' }),
    );
    rerender(<TrackerScreen />);

    expect(screen.queryByText('Stand la târg')).toBeNull();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Ai renunțat la task.',
    );
  });

  it('retries errors without showing private server text', async () => {
    const user = userEvent.setup();
    const refetch = query({
      isError: true,
      error: new Error('private details'),
    });
    render(<TrackerScreen />, { wrapper: Router });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nu am putut încărca taskurile.',
    );
    expect(screen.queryByText('private details')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('renders the authorized cards and sends the chosen action to the mutation', async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    hooks.useTaskProgress.mockReturnValue({ mutateAsync, isPending: false });
    query({ data: [taskRow()] });
    render(<TrackerScreen />, { wrapper: Router });
    await user.click(screen.getByRole('button', { name: 'Începe taskul' }));
    expect(mutateAsync).toHaveBeenCalledWith({ taskId: 1, action: 'start' });
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('leaves scrolling to the shell and lists Taskurile mele as one column of Task rows', () => {
    query({ data: [taskRow(), taskRow({ id: 2, title: 'Al doilea task' })] });

    const { container } = render(<TrackerScreen />, { wrapper: Router });

    expect(screen.getByRole('region', { name: 'Taskuri' })).not.toHaveClass(
      'h-full',
      'overflow-y-auto',
    );
    // One Task item everywhere (2026-10-11): the row De gestionat draws, in
    // one column — no card grid, no equal heights.
    expect(container.querySelector('[data-grid="task-cards"]')).toBeNull();
    expect(container.querySelector('[data-slot="page-grid"]')).toBeNull();
    expect(container.querySelector('[data-slot="card"]')).toBeNull();
    const lists = container.querySelectorAll('[data-slot="task-row-list"]');
    expect(lists).toHaveLength(1);
    const list = lists[0] as HTMLElement;
    expect(list.tagName).toBe('UL');
    expect(list).toHaveClass('flex', 'flex-col', 'gap-2', 'min-w-0');
    expect(list.className).not.toMatch(/grid-cols-/);
    const rows = screen.getAllByRole('article');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toHaveAttribute('data-slot', 'task-row');
      expect(row.parentElement?.parentElement).toBe(list);
      expect(row).toHaveClass('min-w-0');
      expect(row).not.toHaveClass('h-full');
      // The status is on the meta line, never beside the title.
      const meta = row.querySelector('[data-slot="task-row-meta"]');
      expect(within(meta as HTMLElement).getByText('De făcut')).toBeVisible();
      expect(
        row.querySelector('[data-slot="list-row-body"]'),
      ).not.toHaveTextContent('De făcut');
      // The Executor's action sits in the row, at its end.
      expect(
        row.querySelector('[data-slot="task-row-actions"]'),
      ).toContainElement(
        within(row).getByRole('button', { name: 'Începe taskul' }),
      );
    }
  });

  it('shows only authorized tabs and keyboard navigation opens Available', async () => {
    const user = userEvent.setup();
    query();
    render(<TrackerScreen />, { wrapper: Router });
    expect(
      screen.queryByRole('tab', { name: 'De gestionat' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'Toate' }),
    ).not.toBeInTheDocument();
    screen.getByRole('tab', { name: 'Taskurile mele' }).focus();
    await user.keyboard('{ArrowRight}{Enter}');
    expect(
      screen.getByText('Nu sunt oportunități deschise pentru tine.'),
    ).toBeVisible();
  });

  it('lets a local manager open the authorized management query without global access', async () => {
    const user = userEvent.setup();
    query();
    hooks.useTaskManagement.mockReturnValue({ data: true, isError: false });
    render(<TrackerScreen />, { wrapper: Router });
    await user.click(screen.getByRole('tab', { name: 'De gestionat' }));
    expect(screen.getByText('Nu ai taskuri de gestionat acum.')).toBeVisible();
    expect(
      screen.queryByRole('tab', { name: 'Toate' }),
    ).not.toBeInTheDocument();
    expect(hooks.useManagedTasks).toHaveBeenCalledWith(true);
  });

  it.each([
    ['De gestionat', 'useManagedTasks', 'useTaskManagement'],
    ['Toate', 'useAllTasks', 'useTaskLeadership'],
  ] as const)(
    'shows %s as dense rows under the toolbar — no table, no Stare under six Tasks',
    async (tab, list, capability) => {
      const user = userEvent.setup();
      query();
      hooks[capability].mockReturnValue({
        data: true,
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      });
      hooks[list].mockReturnValue({
        data: [
          taskRow({ id: 7, title: 'Viitor', deadline: '2099-01-01T00:00:00Z' }),
          taskRow({
            id: 8,
            title: 'Întârziat',
            deadline: '2020-01-01T00:00:00Z',
          }),
        ],
        isPending: false,
        isError: false,
      });
      render(<TrackerScreen />, { wrapper: Router });
      await user.click(screen.getByRole('tab', { name: tab }));
      const rows = within(
        screen.getByRole('region', { name: 'Lista taskurilor' }),
      ).getAllByRole('article');
      expect(rows.map((row) => row.getAttribute('data-slot'))).toEqual([
        'task-row',
        'task-row',
      ]);
      // Overdue pinned first.
      expect(rows[0]).toHaveAccessibleName('Întârziat');
      expect(screen.queryByRole('table')).toBeNull();
      // Two Tasks fit on one screen: Stare and Ordonează wait for six.
      expect(screen.queryByLabelText('Stare')).toBeNull();
      // The toolbar sits under the nav: the search first, saying how many
      // Tasks the list shows, then Filtrează (#903).
      const toolbar = screen.getByRole('group', { name: 'Filtre taskuri' });
      const searchbox = within(toolbar).getByRole('searchbox', {
        name: 'Caută după titlu',
      });
      expect(searchbox).toHaveAttribute('placeholder', 'Caută în 2 taskuri');
      expect(toolbar.firstElementChild).toBe(searchbox.closest('label'));
      expect(
        within(toolbar).getByRole('button', { name: 'Filtrează' }),
      ).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Viitor' }));
      expect(
        screen.getByRole('dialog', { name: 'Detalii task' }),
      ).toHaveTextContent('Task #7');
    },
  );

  it('opens a newly created Task with a confirmation, once', async () => {
    const user = userEvent.setup();
    query();
    render(<TrackerScreen />, { wrapper: Router });
    await user.click(screen.getByRole('button', { name: 'Task nou' }));
    const details = screen.getByRole('dialog', { name: 'Detalii task' });
    expect(details).toHaveTextContent('Task #42');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Taskul a fost creat.',
    );
    await user.click(screen.getByRole('button', { name: 'Închide detaliile' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // #1017: the sheet closes with a deleted Task; the list keeps the receipt.
  it('closes the details of a Task deleted for good and says so on the list', async () => {
    const user = userEvent.setup();
    query();
    render(<TrackerScreen />, { wrapper: Router });
    await user.click(screen.getByRole('button', { name: 'Task nou' }));
    await user.click(
      screen.getByRole('button', { name: 'Șterge taskul din detalii' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    const receipt = screen.getByRole('status');
    expect(receipt).toHaveTextContent('Taskul a fost șters definitiv.');
    expect(receipt).toHaveFocus();
  });

  it('opens a Task added as completed, saying the points were given (#915)', async () => {
    const user = userEvent.setup();
    query();
    render(<TrackerScreen />, { wrapper: Router });
    // Beside "Task nou", in the page's actions.
    const add = screen.getByRole('button', { name: 'Adaugă task finalizat' });
    expect(add.closest('[data-slot="page-actions"]')).toContainElement(
      screen.getByRole('button', { name: 'Task nou' }),
    );
    await user.click(add);
    expect(
      screen.getByRole('dialog', { name: 'Detalii task' }),
    ).toHaveTextContent('Task #43');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Taskul finalizat a fost adăugat. Punctele au fost acordate.',
    );
  });

  it('reports several finished Tasks added at once and opens no details (Part E)', async () => {
    const user = userEvent.setup();
    query();
    render(<TrackerScreen />, { wrapper: Router });
    await user.click(
      screen.getByRole('button', { name: 'Adaugă 3 taskuri finalizate' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      '3 taskuri finalizate adăugate. Punctele au fost acordate.',
    );
    expect(screen.queryByRole('dialog', { name: 'Detalii task' })).toBeNull();
  });

  it('uses live server capability to show All despite stale advisory claims', async () => {
    const user = userEvent.setup();
    query();
    hooks.level = 1;
    hooks.useTaskLeadership.mockReturnValue({
      data: true,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<TrackerScreen />, { wrapper: Router });
    await user.click(screen.getByRole('tab', { name: 'Toate' }));
    expect(screen.getByText('Nu există taskuri vizibile.')).toBeVisible();
    expect(hooks.useAllTasks).toHaveBeenCalledWith(true);
  });

  it('keeps All hidden when stale JWT claims say BCE but the live server denies it', () => {
    query();
    hooks.level = 5;
    render(<TrackerScreen />, { wrapper: Router });
    expect(
      screen.queryByRole('tab', { name: 'Toate' }),
    ).not.toBeInTheDocument();
    expect(hooks.useAllTasks).toHaveBeenCalledWith(false);
  });

  it('checks the leadership capability silently, and offers a retry when it fails', async () => {
    const user = userEvent.setup();
    query();
    const refetch = vi.fn();
    hooks.useTaskLeadership.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch,
    });
    const { rerender } = render(<TrackerScreen />, { wrapper: Router });
    // Pending says nothing: no line that pushes the lists down as it leaves.
    expect(screen.queryByText(/Se verifică accesul/)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    hooks.useTaskLeadership.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch,
    });
    rerender(<TrackerScreen />);
    await user.click(
      screen.getByRole('button', { name: 'Reîncarcă accesul complet' }),
    );
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('updates overdue while the screen stays open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T09:59:59Z'));
    query({ data: [taskRow()] });
    const { unmount } = render(<TrackerScreen />, { wrapper: Router });
    expect(screen.queryByText('Termen depășit')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('Termen depășit')).toBeInTheDocument();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('opens Taskurile mele on the Personal Score, with no rank', () => {
    query({ data: [taskRow()] });
    render(<TrackerScreen />, { wrapper: Router });
    const score = screen.getByRole('region', { name: 'Punctajul meu' });
    expect(score).toHaveTextContent('12puncte');
    expect(score).toHaveTextContent('Membru cu Drept de Vot');
    expect(score).not.toHaveTextContent(/#|din d|clasament/i);
    // Above the list, inside the Taskurile mele panel.
    expect(
      score.compareDocumentPosition(screen.getByRole('article')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows the Personal Score loading and retry states', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    query({ data: [taskRow()] });
    hooks.useMyPoints.mockReturnValue({ isPending: true, isError: false });
    const { rerender } = render(<TrackerScreen />, { wrapper: Router });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Se încarcă punctajul',
    );
    hooks.useMyPoints.mockReturnValue({
      isPending: false,
      isError: true,
      refetch,
    });
    rerender(<TrackerScreen />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nu am putut încărca punctajul.',
    );
    await user.click(
      screen.getByRole('button', { name: 'Reîncarcă punctajul' }),
    );
    expect(refetch).toHaveBeenCalledOnce();
  });

  describe('Disponibile (ruling R26)', () => {
    const group = (
      name: string,
      path: number[],
      extra: Partial<NonNullable<ReturnType<typeof taskRow>['group']>> = {},
    ) => ({
      name,
      short: null,
      color: '#1f6feb',
      category: 'department',
      path,
      is_organization: false,
      ...extra,
    });
    const publicTask = (overrides: Partial<ReturnType<typeof taskRow>>) =>
      taskRow({ assignment_mode: 'public', assignments: [], ...overrides });
    // A Member of Educațional (10), and of the Organization (5) by Automatic
    // Membership; Resurse Umane (20) and its Recrutare (21) are not theirs.
    // The rows go through the real classifier, as the query does.
    const rows = orderOpportunities(
      [
        publicTask({
          id: 11,
          title: 'Afișe pentru atelier',
          group_id: 10,
          group: group('Educațional', [10], { color: '#0a7d4f' }),
          deadline: '2026-10-05T09:00:00Z',
        }),
        publicTask({
          id: 12,
          title: 'Voluntari la Balul Bobocilor',
          group_id: 5,
          audience: 'org',
          group: group('Organizația', [5], {
            category: 'organization',
            is_organization: true,
          }),
          deadline: '2026-10-01T09:00:00Z',
        }),
        // Another Group's local Task, readable only through leadership
        // (R1/R3): it belongs to the management tabs, never to Disponibile.
        publicTask({
          id: 13,
          title: 'Interviuri de recrutare',
          group_id: 21,
          group: group('Recrutare', [20, 21], { category: 'team' }),
          campaign_id: 7,
          deadline: '2026-10-02T09:00:00Z',
        }),
        // Another Group's org Opportunity: joinable by every Member.
        publicTask({
          id: 14,
          title: 'Sondaj pentru membri',
          group_id: 20,
          audience: 'org',
          group: group('Resurse Umane', [20], { color: '#b8412c' }),
          deadline: '2026-10-03T09:00:00Z',
        }),
        // Another Group's local Task the Member is still queued on.
        publicTask({
          id: 15,
          title: 'Arhivă de interviuri',
          group_id: 21,
          group: group('Recrutare', [20, 21], { category: 'team' }),
          campaign_id: 7,
          deadline: '2026-10-04T09:00:00Z',
        }),
      ],
      new Set([5, 10]),
      { pending: new Set([15]) },
    );
    beforeEach(() => {
      query();
      hooks.join.mockReset();
      hooks.useTaskQueue.mockReturnValue({
        data: { status: null, position: null },
        isPending: false,
        isError: false,
      });
      hooks.useTaskOpportunities.mockReturnValue({
        data: rows,
        isPending: false,
        isError: false,
      });
    });
    async function openAvailable(url = '/tracker') {
      const user = userEvent.setup();
      const view = renderAt(url);
      await user.click(screen.getByRole('tab', { name: 'Disponibile' }));
      return { user, ...view };
    }
    const band = () =>
      screen.getByRole('region', { name: 'Oportunități deschise' });
    const titles = (region: HTMLElement) =>
      within(region)
        .queryAllByRole('article')
        .map(
          (card) =>
            document.getElementById(card.getAttribute('aria-labelledby') ?? '')
              ?.textContent,
        );

    it('shows one band in deadline order, each card in its Group colour, the Organization in OSUBB red', async () => {
      const { container } = await openAvailable();
      expect(titles(band())).toEqual([
        'Voluntari la Balul Bobocilor',
        'Sondaj pentru membri',
        'Arhivă de interviuri',
        'Afișe pentru atelier',
      ]);
      expect(
        screen.queryByRole('region', { name: 'Alte oportunități OSUBB' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/Din grupurile în care nu ești/)).toBeNull();
      expect(container.querySelector('[data-band]')).toBeNull();
      const stripe = (title: string) =>
        (
          screen.getByRole('article', { name: title }) as HTMLElement
        ).style.getPropertyValue('--task-stripe');
      expect(stripe('Voluntari la Balul Bobocilor')).toBe('var(--scope-org)');
      expect(stripe('Afișe pentru atelier')).toBe('#0a7d4f');
      // Another Group's org Opportunity keeps its own colour, never grey.
      expect(stripe('Sondaj pentru membri')).toBe('#b8412c');
      for (const row of within(band()).getAllByRole('article')) {
        expect(row).toHaveAttribute('data-slot', 'task-row');
        expect(row).not.toHaveClass('bg-muted', 'border-dashed');
      }
      // The heading sits above the row titles.
      expect(
        within(band()).getByRole('heading', {
          level: 3,
          name: 'Afișe pentru atelier',
        }),
      ).toBeVisible();
    });

    it('lists another Group’s org Opportunity with its Group chip and a join button', async () => {
      await openAvailable();
      const org = screen.getByRole('article', {
        name: 'Sondaj pentru membri',
      });
      expect(
        within(org).getByText('Departament · Resurse Umane'),
      ).toBeVisible();
      // The row names the Group by its chip alone; the Audience is said in
      // the details sheet ("Toți membrii OSUBB").
      expect(within(org).queryByText('OSUBB')).toBeNull();
      const join = within(org).getByRole('button', {
        name: 'Vreau să particip',
      });
      expect(join).toBeEnabled();
      // The join button is the row's action, at its end.
      expect(
        org.querySelector('[data-slot="task-row-actions"]'),
      ).toContainElement(join);
      expect(
        within(org).queryByText('Doar pentru membrii grupului'),
      ).not.toBeInTheDocument();
    });

    it('does not list a row leadership can read but not join (R1/R3)', async () => {
      await openAvailable();
      expect(
        screen.queryByRole('article', { name: 'Interviuri de recrutare' }),
      ).not.toBeInTheDocument();
    });

    it('keeps another Group’s local row the Member is queued on, so they can withdraw', async () => {
      hooks.useTaskQueue.mockImplementation((taskId: number) => ({
        data:
          taskId === 15
            ? { status: 'pending', position: 2 }
            : { status: null, position: null },
        isPending: false,
        isError: false,
      }));
      await openAvailable();
      const local = screen.getByRole('article', {
        name: 'Arhivă de interviuri',
      });
      expect(
        within(local).getByRole('button', { name: 'Retrage înscrierea' }),
      ).toBeVisible();
    });

    it('confirms a join with the queue place, never an Executor selection', async () => {
      hooks.join.mockResolvedValue({ position: 4 });
      const { user } = await openAvailable();
      const org = screen.getByRole('article', {
        name: 'Sondaj pentru membri',
      });
      await user.click(
        within(org).getByRole('button', { name: 'Vreau să particip' }),
      );
      expect(hooks.join).toHaveBeenCalledWith(14);
      expect(
        within(org).getByText(
          'Te-ai înscris pe locul 4 în lista de așteptare.',
        ),
      ).toBeVisible();
      expect(screen.queryByText('Ai fost selectat ca Executor.')).toBeNull();
    });

    it('keeps a pending Candidature on another Group’s org row, with its place', async () => {
      hooks.useTaskQueue.mockImplementation((taskId: number) => ({
        data:
          taskId === 14
            ? { status: 'pending', position: 3 }
            : { status: null, position: null },
        isPending: false,
        isError: false,
      }));
      await openAvailable();
      const org = within(band()).getByRole('article', {
        name: 'Sondaj pentru membri',
      });
      // One queue sentence (B21): the stage line names the place.
      expect(
        within(org).getByText('Ești pe locul 3 în lista de așteptare.'),
      ).toBeVisible();
      expect(within(org).queryByText('Te-ai înscris pe locul 3.')).toBeNull();
      expect(
        within(org).getByRole('button', { name: 'Retrage înscrierea' }),
      ).toBeVisible();
    });

    it('says so when nothing is open for the Member', async () => {
      hooks.useTaskOpportunities.mockReturnValue({
        data: [],
        isPending: false,
        isError: false,
      });
      await openAvailable();
      expect(
        within(band()).getByText('Nu sunt oportunități deschise pentru tine.'),
      ).toBeVisible();
    });

    it.each([
      // A Group means it and everything below it: Resurse Umane covers
      // Recrutare, and brings in its org Opportunity.
      ['?grup=20', ['Sondaj pentru membri', 'Arhivă de interviuri']],
      ['?grup=20&subgrup=21', ['Arhivă de interviuri']],
      ['?grup=20&campanie=7', ['Arhivă de interviuri']],
      // Deadline range, Bucharest days, both ends inclusive.
      [
        '?de_la=2026-10-01&pana_la=2026-10-03',
        ['Voluntari la Balul Bobocilor', 'Sondaj pentru membri'],
      ],
      ['?grup=5', ['Voluntari la Balul Bobocilor']],
      ['?de_la=2026-11-01&pana_la=2026-11-02', []],
    ])('narrows the band from the URL (%s)', async (search, expected) => {
      await openAvailable(`/tracker${search}`);
      expect(titles(band())).toEqual(expected);
      if (!expected.length)
        expect(band()).toHaveTextContent(
          'Nicio oportunitate nu corespunde filtrelor.',
        );
    });

    it('asks for a valid range instead of listing when the dates are inverted', async () => {
      await openAvailable('/tracker?de_la=2026-10-05&pana_la=2026-10-01');
      expect(
        screen.getByText(
          'Corectează perioada din filtre ca să vezi taskurile.',
        ),
      ).toBeVisible();
      expect(screen.queryByRole('article')).toBeNull();
    });

    it('has no axe violations', async () => {
      const { container } = await openAvailable();
      const panel = container.querySelector(
        '[role="tabpanel"]:not([hidden])',
      ) as HTMLElement;
      expect(
        (
          await axe.run(panel, {
            // jsdom computes no colours.
            rules: { 'color-contrast': { enabled: false } },
          })
        ).violations,
      ).toEqual([]);
    });

    describe('Grupuri preferate (R43)', () => {
      beforeEach(() => {
        preferences.muted = new Set([20, 21]);
      });
      afterEach(() => {
        preferences.muted = new Set();
      });

      it('opens on the preferred Groups, with the chip in the toolbar', async () => {
        await openAvailable();
        expect(titles(band())).toEqual([
          'Voluntari la Balul Bobocilor',
          'Afișe pentru atelier',
        ]);
        expect(
          screen.getByRole('button', { name: 'Doar grupurile preferate' }),
        ).toHaveAttribute('aria-pressed', 'true');
      });

      it('shows every Opportunity after Arată tot', async () => {
        const { user } = await openAvailable();
        await user.click(
          screen.getByRole('button', { name: 'Doar grupurile preferate' }),
        );
        expect(titles(band())).toEqual([
          'Voluntari la Balul Bobocilor',
          'Sondaj pentru membri',
          'Arhivă de interviuri',
          'Afișe pentru atelier',
        ]);
      });

      it('lets a Group chosen in the Work Filter win, with no chip', async () => {
        await openAvailable('/tracker?grup=20');
        expect(titles(band())).toEqual([
          'Sondaj pentru membri',
          'Arhivă de interviuri',
        ]);
        expect(
          screen.queryByRole('button', { name: 'Doar grupurile preferate' }),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe('the ?task=<id> deep link', () => {
    const scrollIntoView = vi.fn();
    beforeEach(() => {
      scrollIntoView.mockReset();
      Element.prototype.scrollIntoView = scrollIntoView;
      query({
        data: [taskRow(), taskRow({ id: 2, title: 'Al doilea task' })],
      });
    });

    it('selects Taskurile mele, scrolls to the card, highlights it and focuses its title', async () => {
      const user = userEvent.setup();
      renderAt('/tracker');
      await user.click(screen.getByRole('tab', { name: 'Disponibile' }));
      expect(scrollIntoView).not.toHaveBeenCalled();

      await user.click(screen.getByRole('link', { name: 'Deschide taskul 2' }));

      expect(
        screen.getByRole('tab', { name: 'Taskurile mele' }),
      ).toHaveAttribute('aria-selected', 'true');
      const card = screen.getByRole('article', { name: 'Al doilea task' });
      expect(card).toHaveAttribute('id', 'task-2');
      expect(scrollIntoView).toHaveBeenCalledOnce();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
      expect(scrollIntoView.mock.contexts[0]).toBe(card);
      expect(card).toHaveAttribute('data-highlighted');
      expect(
        screen.getByRole('article', { name: 'Pregătește materialele' }),
      ).not.toHaveAttribute('data-highlighted');
      expect(
        within(card).getByRole('heading', { name: 'Al doilea task' }),
      ).toContainElement(document.activeElement as HTMLElement);
    });

    it('clears the highlight after a few seconds and never scrolls again on a refetch', () => {
      vi.useFakeTimers();
      const { rerender } = renderAt('/tracker?task=2');
      const card = screen.getByRole('article', { name: 'Al doilea task' });
      expect(card).toHaveAttribute('data-highlighted');
      act(() => {
        vi.advanceTimersByTime(4_000);
      });
      expect(card).not.toHaveAttribute('data-highlighted');
      query({
        data: [taskRow(), taskRow({ id: 2, title: 'Al doilea task' })],
      });
      rerender(tree('/tracker?task=2'));
      expect(scrollIntoView).toHaveBeenCalledOnce();
    });

    it('waits for the list before landing on the card', () => {
      query({ isPending: true, data: undefined });
      const { rerender } = renderAt('/tracker?task=2');
      expect(scrollIntoView).not.toHaveBeenCalled();
      query({
        data: [taskRow(), taskRow({ id: 2, title: 'Al doilea task' })],
      });
      rerender(tree('/tracker?task=2'));
      expect(scrollIntoView).toHaveBeenCalledOnce();
    });

    it('lands again when a later link returns to the same card', async () => {
      const user = userEvent.setup();
      renderAt('/tracker?task=2');
      expect(scrollIntoView).toHaveBeenCalledOnce();
      await user.click(
        screen.getByRole('link', { name: 'Deschide taskul 99' }),
      );
      await user.click(screen.getByRole('link', { name: 'Deschide taskul 2' }));
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
    });

    it('opens De gestionat and the details sheet for a managed Task that is not mine (#822)', async () => {
      const user = userEvent.setup();
      hooks.useTaskManagement.mockReturnValue({
        data: true,
        isPending: false,
        isError: false,
      });
      hooks.useManagedTasks.mockReturnValue({
        data: [
          taskRow({
            id: 7,
            title: 'De evaluat',
            status: 'in_review',
            assignments: [{ id: 9, member_id: 'other', ended_at: null }],
          }),
        ],
        isPending: false,
        isError: false,
      });
      renderAt('/tracker?task=7');

      expect(screen.getByRole('tab', { name: 'De gestionat' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(
        screen.getByRole('dialog', { name: 'Detalii task' }),
      ).toHaveTextContent('Task #7');
      expect(scrollIntoView).not.toHaveBeenCalled();

      // Closed once, it stays closed: a later render never reopens it.
      await user.click(
        screen.getByRole('button', { name: 'Închide detaliile' }),
      );
      expect(screen.queryByRole('dialog')).toBeNull();
      await user.click(screen.getByRole('tab', { name: 'Taskurile mele' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('never opens De gestionat while Taskurile mele failed to load', () => {
      query({ isError: true, data: undefined, error: new Error('boom') });
      hooks.useTaskManagement.mockReturnValue({
        data: true,
        isPending: false,
        isError: false,
      });
      hooks.useManagedTasks.mockReturnValue({
        data: [taskRow({ id: 2, title: 'Al doilea task' })],
        isPending: false,
        isError: false,
      });
      renderAt('/tracker?task=2');
      expect(
        screen.getByRole('tab', { name: 'Taskurile mele' }),
      ).toHaveAttribute('aria-selected', 'true');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('prefers Taskurile mele when the linked Task is also managed', () => {
      hooks.useTaskManagement.mockReturnValue({
        data: true,
        isPending: false,
        isError: false,
      });
      hooks.useManagedTasks.mockReturnValue({
        data: [taskRow({ id: 2, title: 'Al doilea task' })],
        isPending: false,
        isError: false,
      });
      renderAt('/tracker?task=2');
      expect(
        screen.getByRole('tab', { name: 'Taskurile mele' }),
      ).toHaveAttribute('aria-selected', 'true');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(scrollIntoView).toHaveBeenCalledOnce();
    });

    it('shows the plain list for a malformed id', () => {
      renderAt('/tracker?task=abc');
      expect(screen.getAllByRole('article')).toHaveLength(2);
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
      for (const card of screen.getAllByRole('article'))
        expect(card).not.toHaveAttribute('data-highlighted');
    });

    it('opens the details sheet — its unavailable state — for an id no list holds (D2)', () => {
      renderAt('/tracker?task=99');
      expect(
        screen.getByRole('dialog', { name: 'Detalii task' }),
      ).toHaveTextContent('Task #99');
      expect(
        screen.getByRole('tab', { name: 'Taskurile mele' }),
      ).toHaveAttribute('aria-selected', 'true');
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('opens Toate with the sheet for a Task only BCE reads there (D2)', () => {
      hooks.level = 5;
      hooks.useTaskLeadership.mockReturnValue({
        data: true,
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      });
      hooks.useAllTasks.mockReturnValue({
        data: [taskRow({ id: 4, title: 'Al altui grup' })],
        isPending: false,
        isError: false,
      });
      renderAt('/tracker?task=4');
      expect(screen.getByRole('tab', { name: 'Toate' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(
        screen.getByRole('dialog', { name: 'Detalii task' }),
      ).toHaveTextContent('Task #4');
    });

    it('opens Disponibile with the sheet for an Opportunity (D2, D-5)', () => {
      hooks.useTaskOpportunities.mockReturnValue({
        data: orderOpportunities(
          [
            taskRow({
              id: 15,
              title: 'Distribuie story-ul',
              assignment_mode: 'public',
              assignments: [],
            }),
          ],
          new Set([1]),
        ),
        isPending: false,
        isError: false,
      });
      renderAt('/tracker?task=15');
      expect(screen.getByRole('tab', { name: 'Disponibile' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(
        screen.getByRole('dialog', { name: 'Detalii task' }),
      ).toHaveTextContent('Task #15');
    });

    it('waits for every list before opening a Task that is not mine', () => {
      hooks.useTaskOpportunities.mockReturnValue({
        data: undefined,
        isPending: true,
        isError: false,
      });
      const { rerender } = renderAt('/tracker?task=15');
      expect(screen.queryByRole('dialog')).toBeNull();
      hooks.useTaskOpportunities.mockReturnValue({
        data: [taskRow({ id: 15, assignments: [] })],
        isPending: false,
        isError: false,
      });
      rerender(tree('/tracker?task=15'));
      expect(
        screen.getByRole('dialog', { name: 'Detalii task' }),
      ).toHaveTextContent('Task #15');
    });

    it('lets ?task= win over ?lista=', () => {
      renderAt('/tracker?lista=disponibile&task=2');
      expect(
        screen.getByRole('tab', { name: 'Taskurile mele' }),
      ).toHaveAttribute('aria-selected', 'true');
      expect(scrollIntoView).toHaveBeenCalledOnce();
    });
  });

  describe('the opening tab', () => {
    const manager = (rows: ReturnType<typeof taskRow>[]) => {
      hooks.useTaskManagement.mockReturnValue({
        data: true,
        isPending: false,
        isError: false,
      });
      hooks.useManagedTasks.mockReturnValue({
        data: rows,
        isPending: false,
        isError: false,
      });
    };
    const selected = () =>
      screen
        .getAllByRole('tab')
        .find((tab) => tab.getAttribute('aria-selected') === 'true')
        ?.textContent;

    it.each([
      ['gestionat', 'De gestionat'],
      ['disponibile', 'Disponibile'],
    ])('opens ?lista=%s on its tab (D9)', (lista, name) => {
      query({ data: [taskRow()] });
      manager([]);
      renderAt('/tracker?lista=' + lista);
      expect(selected()).toBe(name);
    });

    it('opens a Group’s unfinished Tasks from its page on De gestionat, filtered to that Group (#853)', () => {
      query({ data: [taskRow()] });
      const inGroup = (id: number, title: string, path: number[]) =>
        taskRow({
          id,
          title,
          group_id: path[path.length - 1],
          group: {
            name: title,
            short: null,
            color: '#1f6feb',
            category: 'team',
            path,
            is_organization: false,
          },
          deadline: '2099-01-01T00:00:00Z',
        });
      manager([
        inGroup(31, 'Interviuri', [20, 21]),
        inGroup(32, 'Buget', [20]),
        inGroup(33, 'Afișe', [10]),
      ]);
      renderAt('/tracker?lista=gestionat&grup=20&subgrup=21');
      expect(selected()).toBe('De gestionat');
      const listed = within(
        screen.getByRole('region', { name: 'Lista taskurilor' }),
      ).getAllByRole('article');
      expect(listed).toHaveLength(1);
      expect(listed[0]).toHaveAccessibleName('Interviuri');
    });

    it('opens Acasă’s Următorul task link on Disponibile (#859)', () => {
      query({ data: [taskRow()] });
      hooks.useTaskOpportunities.mockReturnValue({
        data: orderOpportunities(
          [
            taskRow({
              id: 40,
              title: 'Deschis pentru toți',
              assignment_mode: 'public',
              audience: 'org',
              assignments: [],
            }),
          ],
          new Set([1]),
        ),
        isPending: false,
        isError: false,
      });
      renderAt('/tracker?lista=disponibile');
      expect(selected()).toBe('Disponibile');
      expect(
        within(
          screen.getByRole('region', { name: 'Oportunități deschise' }),
        ).getByRole('article', { name: 'Deschis pentru toți' }),
      ).toBeVisible();
    });

    it('ignores ?lista= for a tab the viewer does not have', () => {
      query({ data: [taskRow()] });
      renderAt('/tracker?lista=gestionat');
      expect(selected()).toBe('Taskurile mele');
      expect(screen.queryByRole('tab', { name: 'De gestionat' })).toBeNull();
    });

    it('ignores ?lista=toate for BC, who has no Toate tab', () => {
      query({ data: [taskRow()] });
      hooks.level = 6;
      hooks.useTaskLeadership.mockReturnValue({
        data: true,
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      });
      manager([taskRow({ id: 3, title: 'Al grupului' })]);
      renderAt('/tracker?lista=toate');
      expect(selected()).toBe('Taskurile mele');
    });

    it('waits for the access check before honouring ?lista=gestionat', () => {
      query({ data: [taskRow()] });
      hooks.useTaskManagement.mockReturnValue({
        data: undefined,
        isPending: true,
        isError: false,
      });
      const { rerender } = renderAt('/tracker?lista=gestionat');
      manager([]);
      rerender(tree('/tracker?lista=gestionat'));
      expect(selected()).toBe('De gestionat');
    });

    it('opens Taskurile mele when it has work', () => {
      query({ data: [taskRow()] });
      manager([taskRow({ id: 3, title: 'Al grupului' })]);
      renderAt('/tracker');
      expect(selected()).toBe('Taskurile mele');
    });

    it('opens De gestionat when Taskurile mele is empty and it has work (B17)', () => {
      query();
      manager([taskRow({ id: 3, title: 'Al grupului' })]);
      hooks.useTaskOpportunities.mockReturnValue({
        data: [taskRow({ id: 4, assignments: [] })],
        isPending: false,
        isError: false,
      });
      renderAt('/tracker');
      expect(selected()).toBe('De gestionat');
    });

    it('opens Disponibile when neither own list has work', () => {
      query();
      manager([]);
      hooks.useTaskOpportunities.mockReturnValue({
        data: [taskRow({ id: 4, assignments: [] })],
        isPending: false,
        isError: false,
      });
      renderAt('/tracker');
      expect(selected()).toBe('Disponibile');
    });

    it('stays on Taskurile mele when every list is empty, and on the tab chosen once it loads', async () => {
      const user = userEvent.setup();
      query();
      const { rerender } = renderAt('/tracker');
      expect(selected()).toBe('Taskurile mele');
      await user.click(screen.getByRole('tab', { name: 'Disponibile' }));
      query({ data: [taskRow()] });
      rerender(tree('/tracker'));
      expect(selected()).toBe('Disponibile');
    });
  });

  describe('leadership (R27, B15, B16)', () => {
    it('shows no Personal Score to BCE, BC and the Moderator', () => {
      query({ data: [taskRow()] });
      hooks.seeLeadership = true;
      render(<TrackerScreen />, { wrapper: Router });
      expect(
        screen.queryByRole('region', { name: 'Punctajul meu' }),
      ).toBeNull();
      expect(screen.getByRole('article')).toBeVisible();
    });

    it.each([6, 7])(
      'shows no Toate at level %i, where De gestionat already holds every Task',
      (level) => {
        query();
        hooks.level = level;
        hooks.useTaskLeadership.mockReturnValue({
          data: true,
          isPending: false,
          isError: false,
          refetch: vi.fn(),
        });
        render(<TrackerScreen />, { wrapper: Router });
        expect(screen.queryByRole('tab', { name: 'Toate' })).toBeNull();
        expect(hooks.useAllTasks).toHaveBeenLastCalledWith(false);
      },
    );
  });

  describe('the one navigation (Taskuri and Cereri)', () => {
    const tabNames = () =>
      within(screen.getByRole('tablist', { name: 'Taskuri și cereri' }))
        .getAllByRole('tab')
        .map((tab) => tab.textContent);

    it('lists the Task lists the viewer has, then Cereri, as one tablist', () => {
      query();
      hooks.level = 5;
      hooks.useTaskManagement.mockReturnValue({
        data: true,
        isPending: false,
        isError: false,
      });
      hooks.useTaskLeadership.mockReturnValue({
        data: true,
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      });
      renderAt('/tracker');
      expect(tabNames()).toEqual([
        'Taskurile mele',
        'Disponibile',
        'De gestionat',
        'Toate',
        'Cereri',
      ]);
      // The header is the title and the create actions: no second switch.
      expect(screen.queryByRole('group', { name: 'Secțiune' })).toBeNull();
      expect(screen.getAllByRole('tablist')).toHaveLength(1);
    });

    it('draws the pill switch: a track, 36 px segments with a 44 px hit area, the chosen one inked', () => {
      query();
      renderAt('/tracker');
      const list = screen.getByRole('tablist');
      expect(list).toHaveClass(
        'w-full',
        'rounded-lg',
        'border',
        'bg-(--surface-3)',
        'p-[3px]',
      );
      // The track scrolls sideways only when its tabs overflow (Part C,
      // spec 2026-10-11); there is no fade and no visible scrollbar.
      expect(list).toHaveClass('overflow-x-auto', '[scrollbar-width:none]');
      const mine = screen.getByRole('tab', { name: 'Taskurile mele' });
      for (const tab of screen.getAllByRole('tab'))
        expect(tab).toHaveClass(
          'min-h-[36px]',
          'min-w-11',
          'after:-inset-y-1',
          // Inked by itself where the thumb has not measured (jsdom).
          'aria-selected:bg-(--text)',
          'aria-selected:text-(--surface)',
        );
      expect(mine).toHaveAttribute('aria-selected', 'true');
      // On a phone only the chosen tab spells its name; the others keep
      // theirs for a screen reader. The name is never cut short: when the
      // tabs do not fit, the track scrolls (Part C, spec 2026-10-11).
      const mineLabel = within(mine).getByText('Taskurile mele');
      expect(mineLabel).toHaveClass(
        'max-sm:in-[[aria-selected=false]]:sr-only',
      );
      expect(mineLabel).not.toHaveClass('truncate');
      expect(mine).toHaveClass('shrink-0', 'max-sm:aria-selected:grow');
      // `flex-auto` would set flex-shrink back to 1 and let the tab shrink.
      expect(mine.className).not.toMatch(/:flex-auto/);
      expect(mine).not.toHaveClass('max-sm:aria-selected:flex-1');
      expect(screen.getByRole('tab', { name: 'Cereri' })).toHaveClass(
        'max-sm:flex-none',
      );
      // The thumb slides, and stands still for reduced motion.
      expect(list.querySelector('[data-slot="tracker-nav-thumb"]')).toHaveClass(
        'transition-[translate,width]',
        'motion-reduce:transition-none',
      );
    });

    it('moves between the tabs with the arrow keys, Cereri included', async () => {
      const user = userEvent.setup();
      query();
      renderAt('/tracker');
      screen.getByRole('tab', { name: 'Taskurile mele' }).focus();
      await user.keyboard('{ArrowRight}{ArrowRight}');
      expect(screen.getByRole('tab', { name: 'Cereri' })).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(
        screen.getByRole('heading', { name: 'Cereri view' }),
      ).toBeVisible();
    });
  });

  describe('the toolbar on every Task list', () => {
    const toolbar = () =>
      screen.queryByRole('group', { name: 'Filtre taskuri' });
    const searchbox = () =>
      screen.getByRole('searchbox', { name: 'Caută după titlu' });
    const cardTitles = () =>
      screen
        .queryAllByRole('article')
        .map(
          (card) =>
            document.getElementById(card.getAttribute('aria-labelledby') ?? '')
              ?.textContent,
        );
    const everyTab = () => {
      hooks.level = 5;
      hooks.useTaskManagement.mockReturnValue({
        data: true,
        isPending: false,
        isError: false,
      });
      hooks.useTaskLeadership.mockReturnValue({
        data: true,
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      });
    };
    const publicTask = (id: number, title: string) =>
      taskRow({ id, title, assignment_mode: 'public', assignments: [] });
    beforeEach(() => {
      hooks.useTaskQueue.mockReturnValue({
        data: { status: null, position: null },
        isPending: false,
        isError: false,
      });
    });

    it('is the same row on all four lists — search, then Filtrează — and absent on Cereri', async () => {
      const user = userEvent.setup();
      query();
      everyTab();
      renderAt('/tracker');
      for (const name of [
        'Taskurile mele',
        'Disponibile',
        'De gestionat',
        'Toate',
      ]) {
        await user.click(screen.getByRole('tab', { name }));
        const row = toolbar() as HTMLElement;
        // Directly under the nav: the first thing in the tab's panel.
        expect(screen.getByRole('tabpanel').firstElementChild).toContainElement(
          row,
        );
        expect(
          [...row.children]
            .filter((child) => !child.matches('.sr-only'))
            .map((child) => child.getAttribute('data-slot') ?? child.tagName),
        ).toEqual(['LABEL', 'filter-button']);
        expect(row.firstElementChild).toBe(searchbox().closest('label'));
        expect(searchbox()).toBeEnabled();
      }
      await user.click(screen.getByRole('tab', { name: 'Cereri' }));
      expect(toolbar()).toBeNull();
      expect(screen.queryByRole('searchbox')).toBeNull();
    });

    it('keeps its row, the search disabled, while a list loads and when it failed', () => {
      query({ isPending: true, data: undefined });
      const { rerender } = renderAt('/tracker');
      expect(searchbox()).toBeDisabled();
      // Above the Personal Score and the placeholder rows.
      expect(
        screen.getByRole('tabpanel').firstElementChild?.firstElementChild,
      ).toBe(toolbar());
      expect(
        screen.getByRole('region', { name: 'Punctajul meu' }),
      ).toBeVisible();
      query({ isError: true, error: new Error('boom') });
      rerender(tree('/tracker'));
      expect(searchbox()).toBeDisabled();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Nu am putut încărca taskurile.',
      );
    });

    it('puts the toolbar above the Personal Score on Taskurile mele', () => {
      query({ data: [taskRow()] });
      renderAt('/tracker');
      expect(
        (toolbar() as HTMLElement).compareDocumentPosition(
          screen.getByRole('region', { name: 'Punctajul meu' }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(searchbox()).toHaveAttribute('placeholder', 'Caută în 1 task');
    });

    it('narrows Taskurile mele by the title search, without case or diacritics, with a way out', async () => {
      const user = userEvent.setup();
      query({
        data: [
          taskRow({ id: 1, title: 'Ședință de mentorat' }),
          taskRow({ id: 2, title: 'Afișe pentru gală' }),
        ],
      });
      renderAt('/tracker');
      await user.type(searchbox(), 'SEDINTA');
      await waitFor(() =>
        expect(cardTitles()).toEqual(['Ședință de mentorat']),
      );
      await user.clear(searchbox());
      await user.type(searchbox(), 'zzz');
      expect(
        await screen.findByText('Niciun task nu corespunde căutării.'),
      ).toBeVisible();
      // Not the text of a member with no Task at all.
      expect(screen.queryByText('Nu ai niciun task atribuit încă.')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Șterge căutarea' }));
      expect(searchbox()).toHaveValue('');
      expect(cardTitles()).toHaveLength(2);
    });

    it('narrows Taskurile mele by the Work Filter in the URL (Rule W over the member’s own Tasks)', () => {
      const inGroup = (id: number, title: string, groupId: number) =>
        taskRow({
          id,
          title,
          group_id: groupId,
          group: {
            name: title,
            short: null,
            color: '#1f6feb',
            category: 'department',
            path: [groupId],
            is_organization: false,
          },
        });
      query({
        data: [inGroup(1, 'Al Educaționalului', 10), inGroup(2, 'Al RU', 20)],
      });
      const { unmount } = renderAt('/tracker?grup=20');
      expect(cardTitles()).toEqual(['Al RU']);
      unmount();
      renderAt('/tracker?de_la=2030-01-01&pana_la=2030-01-02');
      expect(
        screen.getByText('Niciun task nu corespunde filtrelor.'),
      ).toBeVisible();
    });

    it('narrows Disponibile by the title search, telling it from an empty band', async () => {
      const user = userEvent.setup();
      query();
      hooks.useTaskOpportunities.mockReturnValue({
        data: orderOpportunities(
          [publicTask(11, 'Afișe pentru atelier'), publicTask(12, 'Sondaj')],
          new Set([1]),
        ),
        isPending: false,
        isError: false,
      });
      renderAt('/tracker?lista=disponibile');
      expect(searchbox()).toHaveAttribute('placeholder', 'Caută în 2 taskuri');
      await user.type(searchbox(), 'afise');
      await waitFor(() =>
        expect(cardTitles()).toEqual(['Afișe pentru atelier']),
      );
      await user.type(searchbox(), 'zzz');
      expect(
        await screen.findByText('Nicio oportunitate nu corespunde căutării.'),
      ).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Șterge căutarea' }));
      expect(cardTitles()).toHaveLength(2);
    });

    it('keeps what was typed when the tab changes, and narrows the next list by it', async () => {
      const user = userEvent.setup();
      query({
        data: [
          taskRow({ id: 1, title: 'Afișe pentru gală' }),
          taskRow({ id: 2, title: 'Buget' }),
        ],
      });
      everyTab();
      hooks.useManagedTasks.mockReturnValue({
        data: [
          taskRow({ id: 7, title: 'Afișe de recrutare' }),
          taskRow({ id: 8, title: 'Interviuri' }),
        ],
        isPending: false,
        isError: false,
      });
      renderAt('/tracker');
      await user.type(searchbox(), 'afise');
      await waitFor(() => expect(cardTitles()).toEqual(['Afișe pentru gală']));

      await user.click(screen.getByRole('tab', { name: 'De gestionat' }));
      expect(searchbox()).toHaveValue('afise');
      expect(cardTitles()).toEqual(['Afișe de recrutare']);

      // Through Cereri, which has no search, and back.
      await user.click(screen.getByRole('tab', { name: 'Cereri' }));
      await user.click(screen.getByRole('tab', { name: 'Taskurile mele' }));
      expect(searchbox()).toHaveValue('afise');
      expect(cardTitles()).toEqual(['Afișe pentru gală']);
    });

    describe('Grupuri preferate (R43)', () => {
      beforeEach(() => {
        preferences.muted = new Set([20, 21]);
      });
      afterEach(() => {
        preferences.muted = new Set();
      });

      it('draws no star on Taskurile mele, whose Tasks the preference never hides', async () => {
        const user = userEvent.setup();
        query({
          data: [
            taskRow({ id: 1, title: 'Al Educaționalului', group_id: 10 }),
            taskRow({ id: 2, title: 'Al RU', group_id: 20 }),
          ],
        });
        renderAt('/tracker');
        expect(
          screen.queryByRole('button', { name: 'Doar grupurile preferate' }),
        ).toBeNull();
        expect(cardTitles()).toEqual(['Al Educaționalului', 'Al RU']);
        // The other lists keep it, between the search and Filtrează.
        await user.click(screen.getByRole('tab', { name: 'Disponibile' }));
        const star = screen.getByRole('button', {
          name: 'Doar grupurile preferate',
        });
        expect(star).toHaveAttribute('aria-pressed', 'true');
        expect(
          [...(toolbar() as HTMLElement).children]
            .filter((child) => !child.matches('.sr-only'))
            .map((child) => child.getAttribute('data-slot') ?? child.tagName),
        ).toEqual(['LABEL', 'preferred-groups-chip', 'filter-button']);
      });
    });

    describe('with a ?task= link', () => {
      const scrollIntoView = vi.fn();
      beforeEach(() => {
        scrollIntoView.mockReset();
        Element.prototype.scrollIntoView = scrollIntoView;
        query({
          data: [taskRow(), taskRow({ id: 2, title: 'Al doilea task' })],
        });
      });

      it('lands on the linked card whatever was typed in the search before', async () => {
        const user = userEvent.setup();
        renderAt('/tracker');
        await user.type(searchbox(), 'materialele');
        await waitFor(() =>
          expect(cardTitles()).toEqual(['Pregătește materialele']),
        );

        await user.click(
          screen.getByRole('link', { name: 'Deschide taskul 2' }),
        );

        // The link wins: its card is listed beside what the search matches.
        const card = screen.getByRole('article', { name: 'Al doilea task' });
        expect(card).toHaveAttribute('data-highlighted');
        expect(scrollIntoView).toHaveBeenCalledOnce();
        expect(scrollIntoView.mock.contexts[0]).toBe(card);
        expect(searchbox()).toHaveValue('materialele');
        expect(cardTitles()).toEqual([
          'Pregătește materialele',
          'Al doilea task',
        ]);
      });

      it('lands on the linked card whatever the Work Filter says', () => {
        renderAt('/tracker?task=2&de_la=2030-01-01&pana_la=2030-01-02');
        expect(cardTitles()).toEqual(['Al doilea task']);
        expect(scrollIntoView).toHaveBeenCalledOnce();
      });
    });
  });

  describe('the Cereri tab (#973)', () => {
    const decision = (id: number) => ({
      id,
      description: `Activitatea ${id}`,
      requester_id: `member-${id}`,
      requester_name: `Membru ${id}`,
      group_id: 10,
      group_name: 'Educațional',
      created_at: '2026-09-30T10:00:00Z',
    });
    const tab = (name: string) => screen.getByRole('tab', { name });
    const requestsView = () =>
      screen.queryByRole('heading', { name: 'Cereri view' });
    const taskToolbar = () =>
      screen.queryByRole('group', { name: 'Filtre taskuri' });

    /** The router's address and its Back button, beside the page. */
    function Probe() {
      const location = useLocation();
      const navigate = useNavigate();
      return (
        <>
          <output aria-label="Adresa">
            {location.pathname + location.search}
          </output>
          <button type="button" onClick={() => void navigate(-1)}>
            Înapoi
          </button>
        </>
      );
    }
    function renderWithProbe(url: string) {
      return render(
        <MemoryRouter initialEntries={[url]}>
          <TrackerScreen />
          <Probe />
        </MemoryRouter>,
      );
    }
    const address = () =>
      screen.getByRole('status', { name: 'Adresa' }).textContent;

    it('offers a Member who files Requests Cereri as the last tab, beside the Task lists', () => {
      query();
      renderAt('/tracker');

      const tabs = screen.getAllByRole('tab');
      expect(tabs[tabs.length - 1]).toBe(tab('Cereri'));
      expect(tab('Taskurile mele')).toHaveAttribute('aria-selected', 'true');
      expect(tab('Cereri')).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByRole('button', { name: 'Task nou' })).toBeVisible();
      expect(requestsView()).toBeNull();
      expect(taskToolbar()).toBeVisible();
    });

    it('shows the Requests in the Cereri tab’s panel at ?vedere=cereri, without the Task actions', () => {
      query();
      renderAt('/tracker?vedere=cereri');

      expect(
        screen.getByRole('heading', { level: 1, name: 'Taskuri' }),
      ).toBeVisible();
      expect(requestsView()).toBeVisible();
      expect(tab('Cereri')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel', { name: 'Cereri' })).toContainElement(
        requestsView(),
      );
      // The Task lists stay one tap away.
      expect(tab('Taskurile mele')).toHaveAttribute('aria-selected', 'false');
      expect(
        screen.queryByText('Lucrul tău și oportunitățile din OSUBB.'),
      ).toBeNull();
      expect(screen.queryByRole('button', { name: 'Task nou' })).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Adaugă task finalizat' }),
      ).toBeNull();
      expect(taskToolbar()).toBeNull();
    });

    it('sets and clears ?vedere, keeping the other parameters', async () => {
      const user = userEvent.setup();
      query();
      renderWithProbe('/tracker?lista=disponibile');

      await user.click(tab('Cereri'));
      expect(address()).toBe('/tracker?lista=disponibile&vedere=cereri');
      expect(requestsView()).toBeVisible();

      await user.click(tab('Taskurile mele'));
      expect(address()).toBe('/tracker?lista=disponibile');
      expect(requestsView()).toBeNull();
      expect(tab('Taskurile mele')).toHaveAttribute('aria-selected', 'true');
      expect(taskToolbar()).toBeVisible();
    });

    it('leaves the address alone when one Task list follows another', async () => {
      const user = userEvent.setup();
      query();
      renderWithProbe('/tracker');

      await user.click(tab('Disponibile'));
      expect(address()).toBe('/tracker');
      expect(tab('Disponibile')).toHaveAttribute('aria-selected', 'true');
    });

    it('returns to the Task list it left on Back', async () => {
      const user = userEvent.setup();
      query();
      renderWithProbe('/tracker');

      await user.click(tab('Disponibile'));
      await user.click(tab('Cereri'));
      expect(address()).toBe('/tracker?vedere=cereri');
      await user.click(screen.getByRole('button', { name: 'Înapoi' }));
      expect(address()).toBe('/tracker');
      expect(requestsView()).toBeNull();
      expect(tab('Disponibile')).toHaveAttribute('aria-selected', 'true');
    });

    it('offers a BC member with nothing to decide the tab too, and honours ?vedere=cereri (#979)', () => {
      query();
      hooks.level = 6;
      renderAt('/tracker?vedere=cereri');

      expect(tab('Cereri')).toHaveAttribute('aria-selected', 'true');
      expect(requestsView()).toBeVisible();
      expect(taskToolbar()).toBeNull();
    });

    it('counts the Requests a BC member has to decide on the Cereri tab', async () => {
      const user = userEvent.setup();
      query();
      hooks.level = 6;
      hooks.usePendingDecisions.mockReturnValue({
        data: [decision(1), decision(2)],
        isError: false,
      });
      renderAt('/tracker');

      const cereri = tab('Cereri, 2 cereri de decis');
      expect(within(cereri).getByText('2')).toHaveAttribute(
        'aria-hidden',
        'true',
      );
      await user.click(cereri);
      expect(requestsView()).toBeVisible();
    });

    it.each([
      [1, 'Cereri, 1 cerere de decis'],
      [20, 'Cereri, 20 de cereri de decis'],
    ])('names %i Requests to decide in Romanian', (count, name) => {
      query();
      hooks.usePendingDecisions.mockReturnValue({
        data: Array.from({ length: count }, (_, index) => decision(index + 1)),
        isError: false,
      });
      renderAt('/tracker');
      expect(tab(name)).toBeVisible();
    });

    it('keeps the tab when the queue cannot be read, so its retry is reachable', () => {
      query();
      hooks.level = 6;
      hooks.usePendingDecisions.mockReturnValue({ isError: true });
      renderAt('/tracker?vedere=cereri');

      expect(tab('Cereri')).toHaveAttribute('aria-selected', 'true');
      expect(requestsView()).toBeVisible();
    });

    it('stays on the Cereri tab when the last decision empties the queue', () => {
      query();
      hooks.level = 6;
      hooks.usePendingDecisions.mockReturnValue({
        data: [decision(1)],
        isError: false,
      });
      const view = renderAt('/tracker?vedere=cereri');
      expect(requestsView()).toBeVisible();

      hooks.usePendingDecisions.mockReturnValue({ data: [], isError: false });
      view.rerender(tree('/tracker?vedere=cereri'));
      expect(requestsView()).toBeVisible();
      expect(tab('Cereri')).toHaveAttribute('aria-selected', 'true');
    });

    it('shows Cereri at once while the queue loads, and keeps it when the queue comes back empty (#979)', () => {
      query();
      hooks.level = 6;
      hooks.usePendingDecisions.mockReturnValue({
        isPending: true,
        isError: false,
      });
      const view = renderAt('/tracker?vedere=cereri');
      expect(requestsView()).toBeVisible();
      expect(tab('Cereri')).toHaveAttribute('aria-selected', 'true');

      hooks.usePendingDecisions.mockReturnValue({
        data: [],
        isPending: false,
        isError: false,
      });
      view.rerender(tree('/tracker?vedere=cereri'));
      expect(requestsView()).toBeVisible();
      expect(taskToolbar()).toBeNull();
    });
  });
});

it('moves between tabs with a finger swipe over the panel (2026-10-11)', () => {
  query();
  render(<TrackerScreen />, { wrapper: Router });
  swipe(screen.getByRole('tabpanel'), 'left');
  expect(screen.getByRole('tab', { name: 'Disponibile' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  swipe(screen.getByRole('tabpanel'), 'right');
  expect(screen.getByRole('tab', { name: 'Taskurile mele' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

describe('Taskuri over the paged lists (#1053)', () => {
  const selected = () =>
    screen
      .getAllByRole('tab')
      .find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent;
  const settled = { isPending: false, isError: false };
  function manages(open: ReturnType<typeof taskRow>[] = []) {
    hooks.useTaskManagement.mockReturnValue({ data: true, ...settled });
    hooks.useManagedTasks.mockReturnValue({ data: open, ...settled });
  }
  const finished = taskRow({
    id: 77,
    title: 'Raport încheiat',
    status: 'completed',
    completed_at: '2026-03-30T10:00:00Z',
    assignments: [],
  });
  /** Three finished Tasks, as a list's summary counts them. */
  const finishedSummary = [
    {
      group_id: 10,
      campaign_id: null,
      status: 'completed',
      late: false,
      dated: true,
      tasks: 3,
    },
  ];
  /** What `list` holds by the server's summary; every other list, nothing. */
  function holding(list: string, rows: unknown[] = finishedSummary) {
    listReads.summary.mockImplementation((name: string) => ({
      data: name === list ? rows : [],
      isError: false,
    }));
  }

  beforeEach(() => {
    hooks.level = 1;
    hooks.seeLeadership = false;
    hooks.useMyTasks.mockReturnValue({ data: [], ...settled });
    hooks.useTaskOpportunities.mockReturnValue({ data: [], ...settled });
    hooks.useTaskManagement.mockReturnValue({ data: false, ...settled });
    hooks.useManagedTasks.mockReturnValue({ data: [], ...settled });
    hooks.useTaskLeadership.mockReturnValue({
      data: false,
      ...settled,
      refetch: vi.fn(),
    });
    hooks.useAllTasks.mockReturnValue({ data: [], ...settled });
    hooks.useTaskProgress.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    });
    hooks.useMyPoints.mockReturnValue({ data: 12, ...settled });
    hooks.usePendingDecisions.mockReturnValue({ data: [], ...settled });
  });

  it('lands a link to a finished managed Task on De gestionat by asking the server about that one Task', () => {
    manages();
    listReads.capability.mockImplementation((taskId: number | null) => ({
      data: taskId === 77 ? true : undefined,
      isError: false,
    }));
    renderAt('/tracker?task=77');
    expect(selected()).toBe('De gestionat');
    expect(
      screen.getByRole('dialog', { name: 'Detalii task' }),
    ).toHaveTextContent('Task #77');
    expect(listReads.capability).toHaveBeenCalledWith(77, true);
  });

  it('asks nothing when the open managed Tasks already hold the linked one', () => {
    manages([taskRow({ id: 7, title: 'De evaluat', status: 'in_review' })]);
    renderAt('/tracker?task=7');
    expect(selected()).toBe('De gestionat');
    expect(listReads.capability).toHaveBeenLastCalledWith(7, false);
  });

  it('waits for the server before it lands a link no open list holds', () => {
    manages();
    listReads.capability.mockReturnValue({ data: undefined, isError: false });
    renderAt('/tracker?task=77');
    expect(screen.queryByRole('dialog', { name: 'Detalii task' })).toBeNull();
  });

  it('lands the link on the opening tab, sheet open, when the Task is not managed', () => {
    manages();
    listReads.capability.mockReturnValue({ data: false, isError: false });
    renderAt('/tracker?task=77');
    expect(
      screen.getByRole('dialog', { name: 'Detalii task' }),
    ).toHaveTextContent('Task #77');
    expect(selected()).toBe('Taskurile mele');
  });

  it('lands a link to a finished Task a BCE reads on Toate', () => {
    hooks.level = 5;
    hooks.useTaskLeadership.mockReturnValue({
      data: true,
      ...settled,
      refetch: vi.fn(),
    });
    listReads.readable.mockImplementation((taskId: number | null) => ({
      data: taskId === 77 ? true : undefined,
      isError: false,
    }));
    renderAt('/tracker?task=77');
    expect(selected()).toBe('Toate');
    expect(
      screen.getByRole('dialog', { name: 'Detalii task' }),
    ).toHaveTextContent('Task #77');
    expect(listReads.readable).toHaveBeenCalledWith(77, true);
  });

  it('opens on De gestionat when the Member manages only finished Tasks (B17)', () => {
    manages();
    holding('managed');
    hooks.useTaskOpportunities.mockReturnValue({
      data: [taskRow({ id: 4, assignments: [] })],
      ...settled,
    });
    renderAt('/tracker');
    expect(selected()).toBe('De gestionat');
    expect(listReads.summary).toHaveBeenCalledWith('managed', true);
  });

  it('waits for what the managed list holds before choosing the opening tab', () => {
    manages();
    listReads.summary.mockReturnValue({ data: undefined, isError: false });
    hooks.useTaskOpportunities.mockReturnValue({
      data: [taskRow({ id: 4, assignments: [] })],
      ...settled,
    });
    const { rerender } = renderAt('/tracker');
    listReads.summary.mockReturnValue({ data: [], isError: false });
    rerender(tree('/tracker'));
    expect(selected()).toBe('Disponibile');
  });

  it('asks for no summary from a Member who manages nothing', () => {
    renderAt('/tracker');
    expect(listReads.summary).toHaveBeenCalledWith('managed', false);
  });

  // Fails if De gestionat draws its list, and so asks for its finished
  // part, only once its open Tasks have arrived.
  it('asks for De gestionat’s finished Tasks beside its open ones, not after them', () => {
    manages();
    hooks.useManagedTasks.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });
    renderAt('/tracker?lista=gestionat');
    expect(selected()).toBe('De gestionat');
    expect(listReads.finished).toHaveBeenCalledWith('managed', {}, true);
    // The open Tasks hold the list's place meanwhile, and nothing finished
    // is drawn above them.
    expect(screen.getByRole('status')).toHaveTextContent(
      'Se încarcă taskurile…',
    );
    expect(
      screen.getByRole('searchbox', { name: 'Caută după titlu' }),
    ).toBeDisabled();
  });

  // The same for Toate, whose summary is asked only by its list.
  it('asks for Toate’s finished Tasks and summary beside its open ones', () => {
    hooks.level = 5;
    hooks.useTaskLeadership.mockReturnValue({
      data: true,
      ...settled,
      refetch: vi.fn(),
    });
    hooks.useAllTasks.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });
    renderAt('/tracker?lista=toate');
    expect(selected()).toBe('Toate');
    expect(listReads.finished).toHaveBeenCalledWith('all', {}, true);
    expect(listReads.summary).toHaveBeenCalledWith('all', true);
  });

  it('offers the retry of De gestionat’s open Tasks while its finished part is read', async () => {
    const user = userEvent.setup();
    manages();
    const refetch = vi.fn();
    hooks.useManagedTasks.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('boom'),
      refetch,
    });
    renderAt('/tracker?lista=gestionat');
    expect(listReads.finished).toHaveBeenCalledWith('managed', {}, true);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Nu am putut încărca taskurile.');
    await user.click(
      within(alert).getByRole('button', { name: 'Încearcă din nou' }),
    );
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  describe('a leader landing on Taskuri with nothing of their own', () => {
    const askedEarly = () =>
      listReads.prefetch.mock.calls.filter(([, , enabled]) => enabled);
    /** De gestionat holds finished Tasks only, so it opens once known. */
    function holdsFinished() {
      holding('managed');
    }
    afterEach(() => {
      preferences.pending = false;
      preferences.muted = new Set();
    });

    // Fails if the page leaves De gestionat's finished read to the list: on
    // a plain /tracker the list is drawn only once the open Tasks have
    // landed and chosen the tab, so that read would start after them.
    it('asks for De gestionat’s first finished page before its open Tasks land, as the list will', () => {
      manages();
      holdsFinished();
      hooks.useManagedTasks.mockReturnValue({
        data: undefined,
        isPending: true,
        isError: false,
      });
      const { rerender } = renderAt('/tracker');
      // The tab waits for the open Tasks; the list is not drawn yet.
      expect(selected()).toBe('Taskurile mele');
      expect(listReads.finished).not.toHaveBeenCalledWith(
        'managed',
        expect.anything(),
        true,
      );
      expect(askedEarly()).toContainEqual(['managed', {}, true]);
      // They land: De gestionat opens, and its list asks for the very read
      // already asked for, so it finds that page read.
      hooks.useManagedTasks.mockReturnValue({ data: [], ...settled });
      rerender(tree('/tracker'));
      expect(selected()).toBe('De gestionat');
      expect(listReads.finished).toHaveBeenLastCalledWith(
        'managed',
        askedEarly().at(-1)?.[1],
        true,
      );
    });

    it('waits for Grupuri preferate, so it asks what the list will ask', () => {
      manages();
      holdsFinished();
      preferences.pending = true;
      const { rerender } = renderAt('/tracker');
      expect(askedEarly()).toEqual([]);
      // Known: a BC member who unselected a Group opens on the others.
      preferences.pending = false;
      preferences.muted = new Set([20]);
      rerender(tree('/tracker'));
      expect(askedEarly().at(-1)).toEqual([
        'managed',
        { p_preferred: true },
        true,
      ]);
      expect(selected()).toBe('De gestionat');
      expect(listReads.finished).toHaveBeenLastCalledWith(
        'managed',
        { p_preferred: true },
        true,
      );
    });

    it('asks nothing early of a Member who manages nothing', () => {
      renderAt('/tracker');
      expect(askedEarly()).toEqual([]);
    });
  });

  describe('Taskurile mele by the page (ruling R55)', () => {
    const highlighted = () =>
      document.querySelectorAll('article[data-highlighted]');
    beforeEach(() => {
      Element.prototype.scrollIntoView = vi.fn();
      hooks.useMyTasks.mockReturnValue({
        data: [taskRow({ id: 2, title: 'Al doilea task' })],
        ...settled,
      });
    });

    // Fails if a link to a finished Task of the Member's goes elsewhere: its
    // open rows no longer hold it, and De gestionat would claim it first.
    it('lands a link to a finished Task of mine on Taskurile mele, its details sheet open', () => {
      manages();
      listReads.capability.mockReturnValue({ data: true, isError: false });
      listReads.isMine.mockImplementation((taskId: number | null) => ({
        data: taskId === 55 ? true : undefined,
        isError: false,
      }));
      renderAt('/tracker?task=55');
      expect(selected()).toBe('Taskurile mele');
      expect(
        screen.getByRole('dialog', { name: 'Detalii task' }),
      ).toHaveTextContent('Task #55');
      expect(listReads.isMine).toHaveBeenCalledWith(55, true);
      expect(highlighted()).toHaveLength(0);
    });

    it('asks nothing when its open rows hold the linked Task, which lands highlighted', () => {
      renderAt('/tracker?task=2');
      expect(selected()).toBe('Taskurile mele');
      expect(listReads.isMine).toHaveBeenLastCalledWith(2, false);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(
        screen.getByRole('article', { name: 'Al doilea task' }),
      ).toHaveAttribute('data-highlighted');
    });

    it('waits for the server before it lands a link its open rows do not hold', () => {
      manages();
      listReads.capability.mockReturnValue({ data: true, isError: false });
      listReads.isMine.mockReturnValue({ data: undefined, isError: false });
      renderAt('/tracker?task=55');
      expect(screen.queryByRole('dialog', { name: 'Detalii task' })).toBeNull();
      expect(selected()).toBe('Taskurile mele');
    });

    it('routes the link as before when the Task is not the Member’s, or that cannot be told', () => {
      manages();
      listReads.capability.mockReturnValue({ data: true, isError: false });
      listReads.isMine.mockReturnValue({
        data: undefined,
        isError: true,
        error: new Error('offline'),
      });
      renderAt('/tracker?task=55');
      expect(selected()).toBe('De gestionat');
      expect(
        screen.getByRole('dialog', { name: 'Detalii task' }),
      ).toHaveTextContent('Task #55');
    });

    // Fails if the opening tab reads only the open rows: a Member whose own
    // Tasks are all finished would open on De gestionat or Disponibile.
    it('opens on Taskurile mele when it holds only finished Tasks', () => {
      hooks.useMyTasks.mockReturnValue({ data: [], ...settled });
      manages([taskRow({ id: 3, title: 'Al grupului' })]);
      holding('mine');
      renderAt('/tracker');
      expect(selected()).toBe('Taskurile mele');
      expect(listReads.summary).toHaveBeenCalledWith('mine', true);
    });

    // Fails if the page chooses while the summary is on its way: it would
    // open on De gestionat and stay there.
    it('waits for what Taskurile mele holds before choosing the opening tab', () => {
      hooks.useMyTasks.mockReturnValue({ data: [], ...settled });
      manages([taskRow({ id: 3, title: 'Al grupului' })]);
      listReads.summary.mockImplementation((name: string) => ({
        data: name === 'mine' ? undefined : [],
        isError: false,
      }));
      const { rerender } = renderAt('/tracker');
      holding('mine');
      rerender(tree('/tracker'));
      expect(selected()).toBe('Taskurile mele');
    });

    it('moves on when what Taskurile mele holds cannot be read', () => {
      hooks.useMyTasks.mockReturnValue({ data: [], ...settled });
      manages([taskRow({ id: 3, title: 'Al grupului' })]);
      listReads.summary.mockImplementation((name: string) => ({
        data: name === 'mine' ? undefined : [],
        isError: name === 'mine',
      }));
      renderAt('/tracker');
      expect(selected()).toBe('De gestionat');
    });

    // Fails if the list is drawn only once the open Tasks land: the finished
    // read would wait for them.
    it('asks for Taskurile mele’s finished Tasks beside its open ones', () => {
      hooks.useMyTasks.mockReturnValue({
        data: undefined,
        isPending: true,
        isError: false,
      });
      renderAt('/tracker');
      expect(listReads.finished).toHaveBeenCalledWith('mine', {}, true);
      expect(screen.getByRole('status')).toHaveTextContent(
        'Se încarcă taskurile…',
      );
    });
  });

  it('tells the sheet a Task opened from De gestionat is managed, and to ask about any other', async () => {
    const user = userEvent.setup();
    manages([taskRow({ id: 3, title: 'Deschis', assignments: [] })]);
    listReads.finished.mockReturnValue({
      ...noFinished(),
      rows: [finished],
      total: 1,
    });
    renderAt('/tracker?lista=gestionat');
    await user.click(screen.getByRole('button', { name: 'Raport încheiat' }));
    const sheet = screen.getByRole('dialog', { name: 'Detalii task' });
    expect(sheet).toHaveTextContent('Task #77');
    // The open Tasks and the one just opened from the list are known.
    expect(sheet).toHaveTextContent('gestionate: 3,77');
    expect(sheet).toHaveTextContent('întreabă: da');
    // Known for as long as that sheet is open, no longer: the next Task
    // opened is asked about afresh.
    await user.click(screen.getByRole('button', { name: 'Închide detaliile' }));
    await user.click(screen.getByRole('link', { name: 'Deschide taskul 99' }));
    const next = await screen.findByRole('dialog', { name: 'Detalii task' });
    expect(next).toHaveTextContent('Task #99');
    expect(next).toHaveTextContent('gestionate: 3');
    expect(next).not.toHaveTextContent('77');
  });
});

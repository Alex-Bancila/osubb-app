import { act, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Link, MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  join: vi.fn(),
  level: 1,
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
  NewTaskControl: ({ onCreated }: { onCreated: (id: number) => void }) => (
    <button type="button" onClick={() => onCreated(42)}>
      Task nou
    </button>
  ),
}));
vi.mock('./TaskDetailsSheet', () => ({
  TaskDetailsSheet: ({
    taskId,
    notice,
    onClose,
  }: {
    taskId: number | null;
    notice?: string | null;
    onClose: () => void;
  }) =>
    taskId === null ? null : (
      <div role="dialog" aria-label="Detalii task">
        <p>Task #{taskId}</p>
        {notice && <p role="status">{notice}</p>}
        <button type="button" onClick={onClose}>
          Închide detaliile
        </button>
      </div>
    ),
}));
import TrackerScreen from './TrackerScreen';

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
    refetch,
    ...overrides,
  });
  return refetch;
}

describe('My tasks screen', () => {
  beforeEach(() => {
    hooks.level = 1;
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

  it('leaves scrolling to the shell and lays out one task per row', () => {
    query({ data: [taskRow(), taskRow({ id: 2, title: 'Al doilea task' })] });

    const { container } = render(<TrackerScreen />, { wrapper: Router });

    expect(screen.getByRole('region', { name: 'Taskuri' })).not.toHaveClass(
      'h-full',
      'overflow-y-auto',
    );
    expect(container.querySelector('[data-slot="task-card-grid"]')).toHaveClass(
      'grid-cols-1',
      'items-stretch',
    );
    expect(
      container.querySelector('[data-slot="task-card-grid"]'),
    ).not.toHaveClass('md:grid-cols-2');
    expect(
      container.querySelectorAll('[data-slot="task-card-row"]'),
    ).toHaveLength(2);
    for (const row of container.querySelectorAll(
      '[data-slot="task-card-row"]',
    )) {
      expect(row).toHaveClass('h-full', 'min-w-0');
    }
    for (const card of screen.getAllByRole('article')) {
      expect(card).toHaveClass('h-full', 'min-w-0');
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
    'shows %s as dense rows with Stare, search and the Work Filter — no table',
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
      expect(screen.getByLabelText('Stare')).toBeVisible();
      expect(
        screen.getByRole('searchbox', { name: 'Caută după titlu' }),
      ).toBeVisible();
      expect(
        screen.getByRole('region', { name: 'Filtre taskuri' }),
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

  it('shows leadership capability loading and retry states', async () => {
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
    expect(screen.getByRole('status')).toHaveTextContent(
      'Se verifică accesul la toate taskurile',
    );
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
        // Another Group's local Task the Member once took part in.
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
      { participated: new Set([15]) },
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
          screen
            .getByRole('article', { name: title })
            .querySelector('[data-slot="card"]') as HTMLElement
        ).style.getPropertyValue('--task-stripe');
      expect(stripe('Voluntari la Balul Bobocilor')).toBe('var(--scope-org)');
      expect(stripe('Afișe pentru atelier')).toBe('#0a7d4f');
      // Another Group's org Opportunity keeps its own colour, never grey.
      expect(stripe('Sondaj pentru membri')).toBe('#b8412c');
      for (const card of within(band()).getAllByRole('article'))
        expect(card.querySelector('[data-slot="card"]')).not.toHaveClass(
          'bg-muted',
          'border-dashed',
        );
      // The heading sits above the card titles.
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
      expect(within(org).getByText('OSUBB')).toBeVisible();
      expect(
        within(org).getByRole('button', { name: 'Vreau să particip' }),
      ).toBeEnabled();
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

    it('keeps a local row the Member took part in, without a join button', async () => {
      await openAvailable();
      const local = screen.getByRole('article', {
        name: 'Arhivă de interviuri',
      });
      expect(
        within(local).getByText('Doar pentru membrii grupului'),
      ).toBeVisible();
      expect(within(local).queryByRole('button', { name: /particip/ })).toBe(
        null,
      );
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
      expect(within(org).getByText('Te-ai înscris pe locul 3.')).toBeVisible();
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

    it.each(['/tracker?task=99', '/tracker?task=abc'])(
      'shows the plain list for %s',
      (url) => {
        renderAt(url);
        expect(screen.getAllByRole('article')).toHaveLength(2);
        expect(scrollIntoView).not.toHaveBeenCalled();
        for (const card of screen.getAllByRole('article'))
          expect(card).not.toHaveAttribute('data-highlighted');
      },
    );
  });
});

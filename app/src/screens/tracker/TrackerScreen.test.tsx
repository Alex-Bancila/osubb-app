import { act, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Link, MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import { taskRow } from '../../test/task-fixtures';

const hooks = vi.hoisted(() => ({
  useMyTasks: vi.fn(),
  useTaskProgress: vi.fn(),
  useTaskOpportunities: vi.fn(),
  useTaskManagement: vi.fn(),
  useTaskLeadership: vi.fn(),
  useManagedTasks: vi.fn(),
  useAllTasks: vi.fn(),
  useMyPoints: vi.fn(),
  level: 1,
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
vi.mock('../../queries/task-opportunities', () => ({
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
      screen.getByText('Nu sunt oportunități disponibile acum.'),
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

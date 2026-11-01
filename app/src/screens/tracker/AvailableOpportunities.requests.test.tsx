import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postgrest, type FakeRequest } from '../../test/postgrest-fake';
import { taskRow } from '../../test/task-fixtures';

/*
 * #1133: Disponibile asks nothing per row. Each Opportunity's own state
 * comes from the `task_list('available')` row the page already read (here,
 * the rows handed in), the places in the queue of the rows the Member waits
 * on come in one request, and nothing is asked again on a timer. The rows,
 * their interest controls and the queue reads run for real, through a fake
 * that answers as PostgREST does.
 */

vi.mock('../../lib/supabase', async () => ({
  supabase: (await import('../../test/postgrest-fake')).postgrest.client,
}));
const MEMBER = 'c0000000-0000-0000-0000-000000000001';
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    session: { user: { id: MEMBER } },
    claims: { member_level: 1 },
  }),
}));
vi.mock('../../lib/capabilities', () => ({
  useCapability: () => ({ data: false }),
}));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
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
      ],
      campaigns: [],
    },
  }),
}));

import {
  orderOpportunities,
  type Opportunity,
  type OwnCandidature,
} from '../../queries/task-opportunities';
import { AvailableOpportunities } from './AvailableOpportunities';

/** Where the Member waits on a queue, by Task: the rest they never joined. */
const CANDIDATURES = new Map<number, OwnCandidature>([
  [2, 'pending'],
  [3, 'withdrawn'],
]);
/** Task 2's place in its queue, as `task_queue_summary` answers it. */
const PLACE = 4;

function opportunities(count: number): Opportunity[] {
  const rows = Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    return {
      ...taskRow({
        id,
        title: `Oportunitate ${id}`,
        group_id: 5,
        audience: 'org',
        assignment_mode: 'public',
        assignments: [],
        group: {
          name: 'Organizația',
          short: null,
          color: null,
          category: 'organization',
          path: [5],
          is_organization: true,
        },
      }),
      // What `task_list('available')` says of the Member's own Candidature.
      candidature: CANDIDATURES.get(id) ?? null,
    };
  });
  return orderOpportunities(rows, new Set([5]), {
    pending: new Set([2]),
    memberId: MEMBER,
  });
}

/** The ids a request asked for by `task_id`, by `.eq` or `.in`. */
function taskIdsOf(request: FakeRequest): number[] {
  const eq = postgrest
    .argsOf(request, 'eq')
    .find(([column]) => column === 'task_id');
  if (eq) return [eq[1] as number];
  const inList = postgrest
    .argsOf(request, 'in')
    .find(([column]) => column === 'task_id');
  return (inList?.[1] as number[] | undefined) ?? [];
}

function serve() {
  // Nobody here is an Executor of an Opportunity.
  postgrest.serve('task_assignments', []);
  postgrest.serve('task_candidates', (request) =>
    taskIdsOf(request).flatMap((taskId) => {
      const status = CANDIDATURES.get(taskId);
      return status
        ? [{ id: taskId, status, joined_at: '2026-09-01T09:00:00Z' }]
        : [];
    }),
  );
  postgrest.serve('task_queue_summary', (request) =>
    taskIdsOf(request).map((taskId) => ({
      task_id: taskId,
      pending_count: 6,
      my_position: CANDIDATURES.get(taskId) === 'pending' ? PLACE : null,
    })),
  );
}

function showAvailable(count: number) {
  serve();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/tracker']}>
        <AvailableOpportunities
          opportunities={opportunities(count)}
          now={new Date('2026-09-01T10:00:00Z')}
          search={{ text: '', needle: '', setText: vi.fn(), clear: vi.fn() }}
          onOpenTask={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Every row's place is drawn and the reads have settled. */
async function settled() {
  await waitFor(() =>
    expect(screen.queryAllByText('Se încarcă înscrierea…')).toHaveLength(0),
  );
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
}

/** Every request a row of Disponibile could make about its own queue. */
const queueReads = () =>
  ['task_assignments', 'task_candidates', 'task_queue_summary'].flatMap(
    (name) => postgrest.requestsTo(name),
  );

beforeEach(() => postgrest.reset());
afterEach(() => vi.useRealTimers());

describe('Disponibile’s queue reads (#1133)', () => {
  // Fails if each row reads its own Assignment, Candidature and place: 40
  // Opportunities would be 80–120 requests on open.
  it('reads the queue in the same number of requests for 3 rows as for 12', async () => {
    const few = showAvailable(3);
    await settled();
    const forFew = queueReads().length;
    few.unmount();

    postgrest.reset();
    showAvailable(12);
    await settled();
    const forMany = queueReads().length;

    expect(forMany).toBe(forFew);
    expect(forFew).toBe(1);
    expect(postgrest.requestsTo('task_queue_summary')).toHaveLength(1);
    const [summary] = postgrest.requestsTo('task_queue_summary');
    expect(summary && taskIdsOf(summary)).toEqual([2]);
  });

  it('shows each row the Member’s own state and the place the queue summary gives', async () => {
    showAvailable(4);
    await settled();

    const row = (id: number) =>
      screen.getByRole('article', { name: `Oportunitate ${id}` });
    expect(
      within(row(2)).getByText(`Ești pe locul ${PLACE} în lista de așteptare.`),
    ).toBeVisible();
    expect(
      within(row(2)).getByRole('button', { name: 'Retrage înscrierea' }),
    ).toBeVisible();
    expect(
      within(row(3)).getByRole('button', { name: 'Înscrie-te din nou' }),
    ).toBeVisible();
    expect(
      within(row(1)).getByRole('button', { name: 'Vreau să particip' }),
    ).toBeVisible();
  });

  // Fails on the 15-second poll: every task_list change already refreshes
  // the list (ADR-0011), so nothing is asked on a timer.
  it('asks nothing again while the page stays open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    showAvailable(3);
    await settled();
    const before = queueReads().length;

    await act(() => vi.advanceTimersByTimeAsync(61_000));

    expect(queueReads().length).toBe(before);
  });
});

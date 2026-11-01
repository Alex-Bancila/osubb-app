import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * #1147: a Tracker list re-renders only what changed. Every row draws its
 * Group chip once, so the chip's renders count the row's; every detailed
 * row strips its description once, so the stripper's calls count those.
 */

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'member' } } }),
}));
const progress = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('../../queries/task-progress', () => ({
  useTaskProgress: () => ({
    isPending: false,
    variables: undefined,
    mutateAsync: progress.mutateAsync,
  }),
}));
vi.mock('../../queries/task-give-up', () => ({
  useGiveUpTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
vi.mock('../../lib/capabilities', () => ({
  useCapability: () => ({ data: false }),
}));
const counts = vi.hoisted(() => ({ chips: 0, stripped: 0 }));
vi.mock('./TaskParts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./TaskParts')>();
  return {
    ...actual,
    TaskGroupChip: (props: Parameters<typeof actual.TaskGroupChip>[0]) => {
      counts.chips += 1;
      return actual.TaskGroupChip(props);
    },
  };
});
vi.mock('../../lib/formatted-text/plain', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/formatted-text/plain')>();
  return {
    ...actual,
    toPlainText: (text: string) => {
      counts.stripped += 1;
      return actual.toPlainText(text);
    },
  };
});

import { taskRow } from '../../test/task-fixtures';
import type { TaskPresentationRow } from './task-presentation';
import { TaskRowList } from './TaskRowList';

const NOW = new Date('2026-10-01T10:00:00.000Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

const far = taskRow({
  id: 1,
  title: 'Afișe',
  description: '**Afișe** pentru gală',
  deadline: '2026-12-01T10:00:00.000Z',
});
// Overdue ten seconds from now: a 30-second tick changes what it says.
const due = taskRow({
  id: 2,
  title: 'Bilanț',
  description: 'Bilanțul _lunii_',
  deadline: later(10_000).toISOString(),
});
const done = taskRow({
  id: 3,
  title: 'Gală',
  description: 'Gala de toamnă',
  status: 'completed',
  completed_at: '2026-09-20T10:00:00.000Z',
  deadline: '2026-09-21T10:00:00.000Z',
});
const ROWS: readonly TaskPresentationRow[] = [far, due, done];
const onOpenTask = vi.fn();

function list(rows: readonly TaskPresentationRow[], now: Date) {
  return <TaskRowList rows={rows} now={now} onOpenTask={onOpenTask} />;
}

beforeEach(() => {
  counts.chips = 0;
  counts.stripped = 0;
});

describe('TaskRowList renders (#1147)', () => {
  // Fails if a row re-renders whenever its list does: a keystroke in the
  // search re-renders the list, and 2 000 rows with it.
  it('re-renders no row when its list re-renders with the same rows', () => {
    const { rerender } = render(list(ROWS, NOW));
    expect(counts.chips).toBe(3);
    counts.chips = 0;

    rerender(list(ROWS, NOW));

    expect(counts.chips).toBe(0);
  });

  // Fails if every row is presented again on every tick: a finished row has
  // no clock, and an open row whose words did not change stays as it was.
  it('re-renders on a tick only the open row whose deadline now reads differently', () => {
    const { rerender } = render(list(ROWS, NOW));
    counts.chips = 0;

    rerender(list(ROWS, later(30_000)));

    expect(counts.chips).toBe(1);
  });

  // Fails if a description is stripped again on every render.
  it('strips each description once, and again only for the row that changed', () => {
    const { rerender } = render(list(ROWS, NOW));
    expect(counts.stripped).toBe(3);
    counts.stripped = 0;

    rerender(list(ROWS, NOW));
    rerender(list(ROWS, later(5_000)));
    // The open row turns overdue and renders again: its text is the same.
    rerender(list(ROWS, later(30_000)));
    expect(counts.stripped).toBe(0);

    const edited = { ...far, description: 'Afișe noi' };
    rerender(list([edited, due, done], later(30_000)));
    expect(counts.stripped).toBe(1);
  });

  // A finished deadline drops its year while it is this year's; on New
  // Year's night that row must say its year, though nothing else moved.
  it('presents a finished row again once the year turns, with its year', () => {
    const lastNight = new Date('2026-12-31T21:00:00.000Z');
    const { container, rerender } = render(list([done], lastNight));
    const deadline = () => container.querySelector('time')?.textContent ?? '';
    expect(deadline()).not.toContain('2026');
    counts.chips = 0;

    rerender(list([done], new Date('2027-01-01T08:00:00.000Z')));

    expect(counts.chips).toBe(1);
    expect(deadline()).toContain('2026');
  });
});

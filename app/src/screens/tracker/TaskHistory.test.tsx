import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../queries/task-history', () => ({ useTaskHistory: vi.fn() }));
import { TaskTimeline } from './TaskHistory';
import type { TaskActivity } from '../../queries/task-history';
const activity = (overrides: Partial<TaskActivity> = {}): TaskActivity => ({
  id: 1,
  task_id: 1,
  actor_id: 'member',
  actorName: null,
  assignment_id: null,
  kind: 'content_updated',
  note: 'Motiv',
  created_at: '2026-09-15T00:00:00Z',
  occurred_at: '2026-09-15T00:00:00Z',
  from_status: null,
  to_status: null,
  details: {},
  ...overrides,
});
describe('Authorized Task timeline', () => {
  it('sorts authorized events chronologically, using safe missing-actor labels', () => {
    render(
      <TaskTimeline
        activity={[
          activity({
            id: 2,
            note: 'Mai târziu',
            occurred_at: '2026-09-16T00:00:00Z',
          }),
          activity({ note: 'Mai devreme' }),
        ]}
      />,
    );
    const rows = screen.getAllByRole('listitem');
    if (!rows[0]) throw new Error('Expected a history item');
    expect(within(rows[0]).getByText('Mai devreme')).toBeVisible();
    expect(screen.queryByText('member')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Membru indisponibil/)).toHaveLength(2);
  });
  it('renders supplied before/after context without dumping raw metadata', () => {
    render(
      <TaskTimeline
        activity={[
          activity({
            actorName: 'Mara',
            details: {
              before: { title: 'Vechi', member_id: 'internal-id' },
              after: { title: 'Nou' },
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText('Titlu: Vechi')).toBeVisible();
    expect(screen.getByText('Titlu: Nou')).toBeVisible();
    expect(screen.queryByText(/internal-id/)).not.toBeInTheDocument();
  });
  it('explains empty or partial legacy history', () => {
    render(<TaskTimeline activity={[]} />);
    expect(
      screen.getByText(/Istoricul vechi poate fi incomplet/),
    ).toBeVisible();
  });
});

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
  it('renders actual conversion from/to payloads and campaign changes', () => {
    render(
      <TaskTimeline
        activity={[
          activity({
            details: {
              from: { audience: 'local', assignment_mode: 'direct' },
              to: { audience: 'org', assignment_mode: 'public' },
            },
          }),
          activity({
            id: 2,
            details: {
              before: { campaign_id: null },
              after: { campaign_id: 7 },
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText('Audiență: Locală')).toBeVisible();
    expect(screen.getByText('Audiență: OSUBB')).toBeVisible();
    expect(screen.getByText('Atribuire: Directă')).toBeVisible();
    expect(screen.getByText('Atribuire: Publică')).toBeVisible();
    expect(screen.getByText('Campanie: #7')).toBeVisible();
  });
  it('labels a task_updated row with the changed fields and its consequences (#626, #646)', () => {
    render(
      <TaskTimeline
        activity={[
          activity({
            kind: 'task_updated',
            note: null,
            details: {
              changed: ['title', 'deadline'],
              before: { title: 'Vechi', deadline: '2026-09-10T10:00:00Z' },
              after: { title: 'Nou', deadline: '2026-09-20T10:00:00Z' },
              consequences: [
                { consequence: 'executor_removed', member_id: 'exec-1' },
                { consequence: 'candidate_removed', member_id: 'cand-1' },
                { consequence: 'candidate_removed', member_id: 'cand-2' },
                { consequence: 'candidate_promoted', member_id: 'cand-3' },
              ],
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText('Task actualizat: titlu, termen')).toBeVisible();
    expect(screen.getByText('executorul a fost eliminat')).toBeVisible();
    expect(screen.getByText('2 candidaturi au fost închise')).toBeVisible();
    expect(screen.getByText('un candidat a fost promovat')).toBeVisible();
    // The generic before/after diff still renders underneath the sentence.
    expect(screen.getByText('Titlu: Vechi')).toBeVisible();
    expect(screen.getByText('Titlu: Nou')).toBeVisible();
  });
  it('falls back to the bare task_updated label when there is nothing to list', () => {
    render(
      <TaskTimeline
        activity={[activity({ kind: 'task_updated', note: null, details: {} })]}
      />,
    );
    expect(screen.getByText('Task actualizat')).toBeVisible();
  });
  it('explains empty or partial legacy history', () => {
    render(<TaskTimeline activity={[]} />);
    expect(
      screen.getByText(/Istoricul vechi poate fi incomplet/),
    ).toBeVisible();
  });
});

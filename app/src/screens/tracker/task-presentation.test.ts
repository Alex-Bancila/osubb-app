import { describe, expect, it } from 'vitest';
import {
  toTaskPresentation,
  type TaskPresentationRow,
  type TaskStatus,
} from './task-presentation';

const now = new Date('2026-09-15T12:00:00Z');
function taskRow(
  overrides: Partial<TaskPresentationRow> = {},
): TaskPresentationRow {
  return {
    id: 1,
    title: 'Pregătește materialele',
    description: null,
    status: 'todo',
    deadline: '2026-09-15T10:00:00Z',
    completed_at: null,
    review_round: 0,
    dept_id: 'edu',
    team_id: null,
    project_id: null,
    assignment_mode: 'direct',
    audience: 'local',
    kind: 'task',
    parent_task_id: null,
    campaign_id: null,
    duplicated_from_task_id: null,
    queue_closed_at: null,
    department: { name: 'Educațional', color: 'var(--dept-edu)' },
    ...overrides,
  };
}

describe('TaskPresentation', () => {
  it('carries whether a public queue is closed for participation controls', () => {
    expect(
      toTaskPresentation(
        taskRow({ queue_closed_at: '2026-09-15T11:00:00Z' }),
        now,
      ).queueClosed,
    ).toBe(true);
  });

  it.each<[TaskStatus, string, boolean]>([
    ['todo', 'De făcut', true],
    ['in_progress', 'În lucru', true],
    ['in_review', 'În verificare', true],
    ['completed', 'Finalizat', false],
    ['unfulfilled', 'Nerealizat', false],
    ['cancelled', 'Anulat', false],
  ])(
    'maps %s and derives overdue only for unfinished work',
    (status, label, overdue) => {
      expect(toTaskPresentation(taskRow({ status }), now)).toMatchObject({
        status,
        statusLabel: label,
        overdue,
      });
    },
  );

  it('compares exact instants, including offsets and the deadline boundary', () => {
    expect(
      toTaskPresentation(
        taskRow({ deadline: '2026-09-15T15:00:00+03:00' }),
        now,
      ).overdue,
    ).toBe(false);
    expect(
      toTaskPresentation(
        taskRow({ deadline: '2026-09-15T14:59:59+03:00' }),
        now,
      ).overdue,
    ).toBe(true);
  });

  it.each([
    ['2026-01-15T22:30:00Z', 'vineri, 16 ianuarie 2026, 00:30'],
    ['2026-07-15T22:30:00Z', 'joi, 16 iulie 2026, 01:30'],
  ])(
    'formats %s in Bucharest, including winter and summer offsets',
    (deadline, deadlineLabel) => {
      expect(toTaskPresentation(taskRow({ deadline }), now).deadlineLabel).toBe(
        deadlineLabel,
      );
    },
  );

  it.each([null, 'invalid'])(
    'handles a missing or invalid deadline: %s',
    (deadline) => {
      expect(toTaskPresentation(taskRow({ deadline }), now)).toMatchObject({
        deadline: null,
        deadlineLabel: 'Fără termen',
        overdue: false,
        completedLate: false,
      });
    },
  );

  it('distinguishes feedback pending and late completion from statuses', () => {
    expect(
      toTaskPresentation(
        taskRow({ status: 'in_progress', review_round: 1 }),
        now,
      ).feedbackPending,
    ).toBe(true);
    expect(
      toTaskPresentation(taskRow({ status: 'in_review', review_round: 1 }), now)
        .feedbackPending,
    ).toBe(false);
    expect(
      toTaskPresentation(
        taskRow({ status: 'completed', completed_at: '2026-09-15T10:00:01Z' }),
        now,
      ).completedLate,
    ).toBe(true);
    expect(
      toTaskPresentation(
        taskRow({ status: 'completed', completed_at: '2026-09-15T10:00:00Z' }),
        now,
      ).completedLate,
    ).toBe(false);
    expect(
      toTaskPresentation(
        taskRow({ status: 'cancelled', completed_at: '2026-09-16T10:00:00Z' }),
        now,
      ).completedLate,
    ).toBe(false);
  });

  it('names every Origin without inferring authority or leaking hidden names', () => {
    expect(toTaskPresentation(taskRow(), now).origin).toMatchObject({
      kind: 'department',
      id: 'edu',
      label: 'Departament · Educațional',
    });
    expect(
      toTaskPresentation(
        taskRow({
          dept_id: null,
          team_id: 'it',
          team: { name: 'IT', dept_id: 'diverse' },
        }),
        now,
      ).origin,
    ).toMatchObject({ kind: 'team', id: 'it', label: 'Echipă · IT' });
    expect(
      toTaskPresentation(
        taskRow({
          dept_id: null,
          team_id: 'independent',
          team: { name: 'Independentă', dept_id: null },
        }),
        now,
      ).origin.kind,
    ).toBe('team');
    expect(
      toTaskPresentation(
        taskRow({ dept_id: null, project_id: 2, project: { name: 'Gala' } }),
        now,
      ).origin.label,
    ).toBe('Proiect · Gala');
    expect(
      toTaskPresentation(taskRow({ department: null }), now).origin.label,
    ).toBe('Departament · Nume indisponibil');
    expect(
      toTaskPresentation(taskRow({ dept_id: null }), now).origin.label,
    ).toBe('Origine indisponibilă');
  });

  it('preserves authorized current Executor and server-supplied own candidature', () => {
    const candidature = { status: 'pending', position: 7 } as const;
    const model = toTaskPresentation(
      taskRow({
        assignments: [
          { id: 1, member_id: 'former', ended_at: '2026-09-14T00:00:00Z' },
          { id: 2, member_id: 'current', ended_at: null },
        ],
        visibleExecutor: { memberId: 'current', fullName: 'Ioana Pop' },
      }),
      now,
      candidature,
    );
    expect(model.executor).toEqual({
      assignmentId: 2,
      memberId: 'current',
      name: 'Ioana Pop',
    });
    expect(model.candidature).toEqual(candidature);
    expect(
      toTaskPresentation(
        taskRow({ assignments: [], visibleExecutor: null }),
        now,
      ).executor,
    ).toBeNull();
  });

  it('preserves a visible Executor when Assignment details or the name are unavailable', () => {
    expect(
      toTaskPresentation(
        taskRow({
          assignments: [],
          visibleExecutor: { memberId: 'current', fullName: null },
        }),
        now,
      ).executor,
    ).toEqual({ assignmentId: null, memberId: 'current', name: null });
  });

  it('uses only the current evaluation points, including zero and negative values', () => {
    for (const points of [0, -6, 12]) {
      expect(
        toTaskPresentation(
          taskRow({
            status: 'unfulfilled',
            evaluations: [
              { id: 3, difficulty: 3, rating: 1, points, reversed_at: null },
              {
                id: 2,
                difficulty: 5,
                rating: 5,
                points: 100,
                reversed_at: '2026-09-14T00:00:00Z',
              },
            ],
          }),
          now,
        ),
      ).toMatchObject({ difficulty: 3, rating: 1, points });
    }
    expect(
      toTaskPresentation(taskRow({ status: 'completed' }), now).points,
    ).toBeNull();
    expect(
      toTaskPresentation(
        taskRow({
          status: 'in_progress',
          evaluations: [
            { id: 1, difficulty: 5, rating: 5, points: 100, reversed_at: null },
          ],
        }),
        now,
      ).points,
    ).toBeNull();
  });

  it('carries Campaign, parent and duplication references with deterministic fallbacks', () => {
    expect(
      toTaskPresentation(
        taskRow({
          title: ' ',
          parent_task_id: 5,
          campaign_id: 2,
          duplicated_from_task_id: 8,
        }),
        now,
      ),
    ).toMatchObject({
      title: 'Task fără titlu',
      parent: { id: 5, title: 'Task-umbrelă' },
      campaign: { id: 2, name: 'Campanie' },
      duplicatedFromTaskId: 8,
    });
    expect(
      toTaskPresentation(
        taskRow({
          parent_task_id: 5,
          parent: { title: 'Recrutare' },
          campaign_id: 2,
          campaign: { name: 'Toamnă' },
        }),
        now,
      ),
    ).toMatchObject({
      parent: { id: 5, title: 'Recrutare' },
      campaign: { id: 2, name: 'Toamnă' },
    });
  });

  it('counts authorized terminal Subtasks and keeps Umbrellas free of Executor and points', () => {
    const model = toTaskPresentation(
      taskRow({
        kind: 'umbrella',
        subtasks: [
          { id: 2, status: 'completed' },
          { id: 3, status: 'unfulfilled' },
          { id: 4, status: 'cancelled' },
          { id: 5, status: 'todo' },
        ],
        assignments: [{ id: 1, member_id: 'member', ended_at: null }],
        visibleExecutor: { memberId: 'member', fullName: 'Executor Umbrelă' },
      }),
      now,
      { status: 'pending', position: 1 },
    );
    expect(model).toMatchObject({
      kind: 'umbrella',
      executor: null,
      candidature: null,
      points: null,
      subtaskProgress: { terminal: 3, total: 4 },
    });
    expect(
      toTaskPresentation(taskRow({ kind: 'umbrella' }), now).subtaskProgress,
    ).toBeNull();
    expect(
      toTaskPresentation(taskRow({ kind: 'umbrella', subtasks: [] }), now)
        .subtaskProgress,
    ).toEqual({ terminal: 0, total: 0 });
  });
});

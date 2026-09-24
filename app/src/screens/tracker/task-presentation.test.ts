import { describe, expect, it } from 'vitest';
import {
  taskOrigin,
  toTaskPresentation,
  type TaskPresentationRow,
  type TaskStatus,
} from './task-presentation';
import { taskRow as sharedTaskRow } from '../../test/task-fixtures';

const now = new Date('2026-09-15T12:00:00Z');
function taskRow(
  overrides: Partial<TaskPresentationRow> = {},
): TaskPresentationRow {
  return sharedTaskRow({
    deadline: '2026-09-15T10:00:00Z',
    assignments: undefined,
    ...overrides,
  });
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

  it('labels the Origin from the Task’s Group embed', () => {
    expect(toTaskPresentation(taskRow(), now).origin).toEqual({
      id: 1,
      label: 'Departament · Educațional',
      color: 'var(--dept-edu)',
    });
    expect(
      taskOrigin({
        group_id: 21,
        group: {
          name: 'IT',
          short: null,
          color: null,
          category: 'team',
          path: [4, 21],
          is_organization: false,
        },
      }),
    ).toEqual({ id: 21, label: 'Echipă · IT', color: null });
    expect(
      taskOrigin({
        group_id: 30,
        group: {
          name: 'Gala',
          short: null,
          color: null,
          category: 'project',
          path: [30],
          is_organization: false,
        },
      }).label,
    ).toBe('Proiect · Gala');
    // A category the app has no noun for shows the Group's own name, and the
    // Organization Group is OSUBB red whatever colour its row stores (R10).
    expect(
      taskOrigin({
        group_id: 5,
        group: {
          name: 'OSUBB',
          short: 'OSUBB',
          color: '#c8102e',
          category: 'organization',
          path: [5],
          is_organization: true,
        },
      }),
    ).toEqual({ id: 5, label: 'OSUBB', color: 'var(--scope-org)' });
  });

  it('never leaks an id when RLS withholds the Origin Group', () => {
    expect(toTaskPresentation(taskRow({ group: null }), now).origin).toEqual({
      id: 1,
      label: 'Origine indisponibilă',
      color: null,
    });
    expect(
      taskOrigin({
        group_id: 9,
        group: {
          name: '  ',
          short: null,
          color: '#000000',
          category: 'team',
          path: [9],
          is_organization: false,
        },
      }).label,
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
        visibleExecutor: {
          memberId: 'current',
          fullName: 'Ioana Pop',
          nickname: ' Ioana ',
        },
      }),
      now,
      candidature,
    );
    expect(model.executor).toEqual({
      assignmentId: 2,
      memberId: 'current',
      name: 'Ioana Pop',
      nickname: 'Ioana',
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
    ).toEqual({
      assignmentId: null,
      memberId: 'current',
      name: null,
      nickname: null,
    });
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

  it('carries the Attached Link and the latest Submission Note', () => {
    const row = taskRow({
      link_label: '  Brief ',
      link_url: 'https://drive.example/brief',
      submission: [
        {
          id: 4,
          kind: 'submitted',
          note: 'Veche',
          details: {},
          occurred_at: '2026-09-14T10:00:00Z',
        },
        {
          id: 8,
          kind: 'submitted',
          note: '  ',
          details: { link_label: 'Surse', link_url: 'https://x.example' },
          occurred_at: '2026-09-15T10:00:00Z',
        },
      ],
    });
    const task = toTaskPresentation(row, now);
    expect(task.link).toEqual({
      label: 'Brief',
      url: 'https://drive.example/brief',
    });
    expect(task.submission).toEqual({
      note: null,
      link: { label: 'Surse', url: 'https://x.example' },
      submittedAt: '2026-09-15T10:00:00Z',
    });
  });

  it('shows no Submission Note when none exists or the last one is empty', () => {
    expect(toTaskPresentation(taskRow(), now).submission).toBeNull();
    expect(
      toTaskPresentation(taskRow({ submission: [] }), now).submission,
    ).toBeNull();
    expect(
      toTaskPresentation(
        taskRow({
          submission: [
            {
              id: 1,
              kind: 'submitted',
              note: null,
              details: {},
              occurred_at: '2026-09-15T10:00:00Z',
            },
          ],
        }),
        now,
      ).submission,
    ).toBeNull();
    // A half link is no link.
    expect(
      toTaskPresentation(taskRow({ link_label: 'Brief', link_url: null }), now)
        .link,
    ).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { summarizeTaskStage, type TaskStage } from './task-stage';

function stage(overrides: Partial<TaskStage> = {}): TaskStage {
  return {
    status: 'todo',
    executor: null,
    candidature: null,
    overdue: false,
    feedbackPending: false,
    completedLate: false,
    kind: 'task',
    subtaskProgress: null,
    ...overrides,
  };
}

describe('Romanian current-stage summary', () => {
  it.each<[Partial<TaskStage>, string]>([
    [{}, 'Taskul este de făcut.'],
    [
      { executor: { memberId: 'member', assignmentId: 2 } },
      'Taskul este atribuit și așteaptă să fie început.',
    ],
    [{ status: 'in_progress' }, 'Lucrul la task a început.'],
    [
      { status: 'in_review' },
      'Lucrarea a fost trimisă și așteaptă verificarea.',
    ],
    [
      { status: 'in_progress', feedbackPending: true },
      'Lucrarea a fost returnată pentru modificări.',
    ],
    [{ status: 'completed' }, 'Taskul a fost finalizat.'],
    [
      { status: 'completed', completedLate: true },
      'Taskul a fost finalizat cu întârziere.',
    ],
    [{ status: 'unfulfilled' }, 'Taskul a fost evaluat ca nerealizat.'],
    [{ status: 'cancelled' }, 'Taskul a fost anulat.'],
    [
      { candidature: { status: 'pending', position: 3 } },
      'Ești pe locul 3 în lista de așteptare.',
    ],
    [
      { candidature: { status: 'pending', position: null } },
      'Ești pe lista de așteptare.',
    ],
    [
      {
        candidature: { status: 'selected', position: null },
        executor: { memberId: 'member', assignmentId: 2 },
      },
      'Taskul este atribuit și așteaptă să fie început.',
    ],
    [
      { kind: 'umbrella', subtaskProgress: { terminal: 2, total: 3 } },
      '2 din 3 subtaskuri sunt încheiate.',
    ],
    [{ kind: 'umbrella' }, 'Taskul grupează subtaskuri.'],
  ])('summarizes %j', (input, expected) => {
    expect(summarizeTaskStage(stage(input))).toBe(expected);
  });

  it('keeps overdue and feedback pending visible together', () => {
    expect(
      summarizeTaskStage(
        stage({ status: 'in_progress', feedbackPending: true, overdue: true }),
      ),
    ).toBe(
      'Lucrarea a fost returnată pentru modificări. Termenul a fost depășit.',
    );
  });

  it('puts terminal outcomes before a leftover queue state', () => {
    expect(
      summarizeTaskStage(
        stage({
          status: 'cancelled',
          candidature: { status: 'pending', position: 2 },
        }),
      ),
    ).toBe('Taskul a fost anulat.');
  });
});

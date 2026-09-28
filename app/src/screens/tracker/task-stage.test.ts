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

const executor = {
  memberId: 'member',
  assignmentId: 2,
  name: null,
  nickname: null,
};

describe('Romanian current-stage summary', () => {
  it.each<[Partial<TaskStage>, string]>([
    [{ executor }, 'Taskul este atribuit și așteaptă să fie început.'],
    [
      { candidature: { status: 'pending', position: 3 } },
      'Ești pe locul 3 în lista de așteptare.',
    ],
    [
      { candidature: { status: 'pending', position: null } },
      'Ești pe lista de așteptare.',
    ],
    [
      { candidature: { status: 'selected', position: null }, executor },
      'Taskul este atribuit și așteaptă să fie început.',
    ],
    [
      { kind: 'umbrella', subtaskProgress: { terminal: 2, total: 3 } },
      '2 din 3 subtaskuri sunt încheiate.',
    ],
    [{ kind: 'umbrella' }, 'Taskul grupează subtaskuri.'],
  ])('says what the badges do not: %j', (input, expected) => {
    expect(summarizeTaskStage(stage(input))).toBe(expected);
  });

  // Relevance B9: the status badge (De făcut, În lucru, În verificare,
  // Finalizat, Nerealizat, Anulat) and the Termen depășit, Modificări cerute
  // and Finalizat cu întârziere badges already say these.
  it.each<Partial<TaskStage>>([
    {},
    { status: 'in_progress', executor },
    { status: 'in_review', executor },
    { status: 'in_progress', feedbackPending: true, executor },
    { status: 'in_progress', feedbackPending: true, overdue: true, executor },
    { status: 'todo', overdue: true },
    { status: 'completed' },
    { status: 'completed', completedLate: true },
    { status: 'unfulfilled' },
    { status: 'cancelled' },
  ])('says nothing the badges already say: %j', (input) => {
    expect(summarizeTaskStage(stage(input))).toBeNull();
  });

  it('keeps the overdue badge alone: no appended "Termenul a fost depășit"', () => {
    expect(summarizeTaskStage(stage({ executor, overdue: true }))).toBe(
      'Taskul este atribuit și așteaptă să fie început.',
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
    ).toBeNull();
    expect(
      summarizeTaskStage(
        stage({
          status: 'completed',
          kind: 'umbrella',
          subtaskProgress: { terminal: 3, total: 3 },
        }),
      ),
    ).toBeNull();
  });
});

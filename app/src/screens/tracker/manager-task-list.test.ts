import { describe, expect, it } from 'vitest';
import {
  finishedStateCounts,
  isFinishedState,
  isOpenState,
  searchableTitle,
} from './manager-task-list';

describe('searchableTitle', () => {
  // The same strings and keys as private.fold_search in
  // supabase/tests/task_list.test.sql: the page narrows the open Tasks and
  // the server the finished ones, and a title must not match one and not
  // the other.
  it.each([
    ['Ședință', 'sedinta'],
    ['ŞEDINŢĂ', 'sedinta'],
    ['  Înscrieri la Târg ', '  inscrieri la targ '],
    ['Afiș · v2^', 'afis  v2'],
    ['a`b¨c¯d´e¸f', 'abcdef'],
    ['Ziua 100% _liberă_', 'ziua 100% _libera_'],
  ])('folds %j to %j, as the server does', (title, key) => {
    expect(searchableTitle(title)).toBe(key);
  });
});

describe('the finished states', () => {
  it('tells a state only a finished Task has from one only an open Task has', () => {
    for (const state of ['completed', 'unfulfilled', 'cancelled', 'late']) {
      expect(isFinishedState(state)).toBe(true);
      expect(isOpenState(state)).toBe(false);
    }
    for (const state of [
      'todo',
      'in_progress',
      'in_review',
      'overdue',
      'feedback',
    ]) {
      expect(isFinishedState(state)).toBe(false);
      expect(isOpenState(state)).toBe(true);
    }
    // No state chosen is neither.
    expect(isFinishedState('')).toBe(false);
    expect(isOpenState('')).toBe(false);
  });

  it('counts a list’s finished Tasks by state from its summary, late among the completed', () => {
    expect(
      finishedStateCounts([
        { status: 'completed', late: false, tasks: 40 },
        { status: 'completed', late: true, tasks: 3 },
        { status: 'unfulfilled', late: false, tasks: 2 },
        { status: 'cancelled', late: false, tasks: 1 },
        // An open Task is not the summary's to count here.
        { status: 'in_progress', late: false, tasks: 9 },
      ]),
    ).toEqual({
      completed: 43,
      late: 3,
      unfulfilled: 2,
      cancelled: 1,
      total: 46,
    });
    expect(finishedStateCounts([]).total).toBe(0);
  });
});

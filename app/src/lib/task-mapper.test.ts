import { describe, it, expect } from 'vitest';
import { mapTask, type DatabaseTask } from './task-mapper';

describe('task-mapper', () => {
  it('maps a full task correctly', () => {
    const dbTask: DatabaseTask = {
      id: 1,
      title: 'Scrie un articol',
      status: 'progress',
      type: 'remote',
      difficulty: 3,
      rating: null,
      points: null,
      deadline: '2026-09-15',
      dept_id: 'pr',
      team_id: null,
    } as any;

    const result = mapTask(dbTask);
    
    expect(result.id).toBe(1);
    expect(result.title).toBe('Scrie un articol');
    expect(result.statusLabel).toBe('În lucru');
    expect(result.pointsLabel).toBe('-');
    // ro-RO uses abbreviations like "15 sept. 2026" or "15 sep. 2026" depending on the environment
    expect(result.deadlineLabel).toMatch(/15 sep[t]?\.? 2026/);
  });

  it('handles null values and missing dates', () => {
    const dbTask: DatabaseTask = {
      id: 2,
      title: '', // empty title fallback
      status: 'todo',
      type: 'physical',
      difficulty: 1,
      rating: 5,
      points: 15,
      deadline: null,
      dept_id: null,
      team_id: null,
    } as any;

    const result = mapTask(dbTask);
    
    expect(result.title).toBe('Fără titlu');
    expect(result.statusLabel).toBe('De făcut');
    expect(result.pointsLabel).toBe('15 pct');
    expect(result.deadlineLabel).toBe('Fără termen');
  });

  it('interprets dates as local calendar dates, ignoring UTC offset shifts', () => {
    // A timestamp that would shift to previous day if parsed as UTC in a negative timezone
    const dbTask: DatabaseTask = {
      id: 3,
      title: 'Test date',
      status: 'done',
      type: 'remote',
      difficulty: 2,
      rating: null,
      points: null,
      deadline: '2026-10-01T01:00:00Z', 
      dept_id: null,
      team_id: null,
    } as any;

    const result = mapTask(dbTask);
    
    // Should extract 2026-10-01 and render as 1 oct 2026
    expect(result.deadlineLabel).toMatch(/0?1 oct\.? 2026/);
  });
});

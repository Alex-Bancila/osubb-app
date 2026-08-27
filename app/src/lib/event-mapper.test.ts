import { describe, it, expect } from 'vitest';
import { mapEvent, groupEventsByDay, type DatabaseEvent } from './event-mapper';

describe('event-mapper', () => {
  it('maps an event correctly', () => {
    const dbEvent: DatabaseEvent = {
      id: 1,
      title: 'Ședință PR',
      type: 'sedinta',
      scope: 'dept',
      capacity: null,
      description: null,
      location: 'Sediul OSUBB',
      starts_at: '2026-09-15T18:00:00Z',
      ends_at: '2026-09-15T20:00:00Z',
      dept_id: 'pr',
      team_id: null,
      created_by: null,
      has_qr: false,
    } as any;

    const result = mapEvent(dbEvent);
    
    expect(result.id).toBe(1);
    expect(result.title).toBe('Ședință PR');
    expect(result.typeLabel).toBe('Ședință');
    expect(result.scopeLabel).toBe('Departament');
    // time formats depend on timezone of vitest run, but typically XX:XX
    expect(result.timeRangeLabel).toMatch(/\d{2}:\d{2} - \d{2}:\d{2}/);
  });

  it('groups events by day correctly', () => {
    const ev1 = mapEvent({
      id: 1, title: 'Event 1', type: 'activitate', scope: 'org', starts_at: '2026-09-15T10:00:00Z'
    } as any);
    const ev2 = mapEvent({
      id: 2, title: 'Event 2', type: 'activitate', scope: 'org', starts_at: '2026-09-15T12:00:00Z'
    } as any);
    const ev3 = mapEvent({
      id: 3, title: 'Event 3', type: 'activitate', scope: 'org', starts_at: '2026-09-16T10:00:00Z'
    } as any);

    const groups = groupEventsByDay([ev1, ev2, ev3]);
    
    expect(groups).toHaveLength(2);
    expect(groups[0].events).toHaveLength(2); // Both on the 15th
    expect(groups[1].events).toHaveLength(1); // On the 16th
    expect(groups[0].events[0].id).toBe(1);
    expect(groups[0].events[1].id).toBe(2);
    expect(groups[1].events[0].id).toBe(3);
  });
});

import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { calendarWorkItems } from './work-filter-options';

describe('calendarWorkItems', () => {
  it('keeps every Event and each Task with a deadline — an undated Task draws no chip', () => {
    const events = [
      { group_id: 1, campaign_id: null },
      { group_id: 2, campaign_id: 7 },
    ];
    const mine = [
      { group_id: 3, campaign_id: null, deadline: '2026-10-01T10:00:00Z' },
      { group_id: 4, campaign_id: 8, deadline: null },
    ];
    const candidatures = [
      { group_id: 5, campaign_id: 9, deadline: '2026-10-02T10:00:00Z' },
    ];
    expect(
      calendarWorkItems({ events, tasks: [mine, candidatures, undefined] }),
    ).toEqual([
      { group_id: 1, campaign_id: null },
      { group_id: 2, campaign_id: 7 },
      { group_id: 3, campaign_id: null, deadline: '2026-10-01T10:00:00Z' },
      { group_id: 5, campaign_id: 9, deadline: '2026-10-02T10:00:00Z' },
    ]);
  });
});

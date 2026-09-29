import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: { from: api.from } }));

import { fetchEventAttendance } from './event-attendance';

describe('fetchEventAttendance (#934)', () => {
  beforeEach(() => {
    api.from.mockReset().mockReturnValue({ select: api.select });
    api.select.mockReset().mockReturnValue({ eq: api.eq });
    api.eq.mockReset();
  });

  it('reads every answer on the one Event and splits them Particip / Nu particip', async () => {
    api.eq.mockResolvedValue({
      data: [
        { member_id: 'a', status: 'going' },
        { member_id: 'b', status: 'declined' },
        { member_id: 'c', status: 'going' },
      ],
      error: null,
    });

    await expect(fetchEventAttendance(31)).resolves.toEqual({
      going: ['a', 'c'],
      declined: ['b'],
    });
    expect(api.from).toHaveBeenCalledWith('event_attendance');
    expect(api.select).toHaveBeenCalledWith('member_id, status');
    // No member filter: the manager asks for the whole Event, RLS decides.
    expect(api.eq).toHaveBeenCalledTimes(1);
    expect(api.eq).toHaveBeenCalledWith('event_id', 31);
  });

  it('answers an Event nobody answered with two empty groups', async () => {
    api.eq.mockResolvedValue({ data: [], error: null });
    await expect(fetchEventAttendance(31)).resolves.toEqual({
      going: [],
      declined: [],
    });
  });

  it('surfaces a read failure', async () => {
    const failure = { code: '42501', message: 'denied' };
    api.eq.mockResolvedValue({ data: null, error: failure });
    await expect(fetchEventAttendance(31)).rejects.toBe(failure);
  });
});

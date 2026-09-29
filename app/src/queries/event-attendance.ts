import { skipToken, useQuery } from '@tanstack/react-query';

import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/** Every answer on one Event, split the way **Cine participă** shows it. */
export type EventAttendance = {
  going: string[];
  declined: string[];
};

/**
 * Every RSVP on this Event (#934). `event_attendance_read` answers every row
 * only to the Event's managers (`private.can_manage_event`); anyone else gets
 * their own answer at most, which is why the screen asks only for a manager.
 */
export async function fetchEventAttendance(
  eventId: number,
): Promise<EventAttendance> {
  const { data, error } = await supabase
    .from('event_attendance')
    .select('member_id, status')
    .eq('event_id', eventId);
  if (error) throw error;
  const attendance: EventAttendance = { going: [], declined: [] };
  for (const row of data ?? []) {
    if (row.status === 'going') attendance.going.push(row.member_id);
    else if (row.status === 'declined') attendance.declined.push(row.member_id);
  }
  return attendance;
}

/** Read only while `enabled` — the card asks for it once it knows a manager. */
export function useEventAttendance(eventId: number, enabled: boolean) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.events.attendance(eventId, memberId),
    queryFn:
      enabled && memberId ? () => fetchEventAttendance(eventId) : skipToken,
  });
}

/** "12 participă · 3 nu" — the words the tally bar only illustrates. */
export function attendanceTally({ going, declined }: EventAttendance): string {
  return `${going.length} participă · ${declined.length} nu`;
}

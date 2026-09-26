import { useCallback, useState } from 'react';

/** Where this device remembers the Calendar's view (the `theme.ts` pattern). */
export const CALENDAR_VIEW_STORAGE_KEY = 'osubb-calendar-view';

/** **Lună** (the month grid) or **Agendă** (the list by day). */
export type CalendarView = 'month' | 'agenda';

/**
 * The remembered view, **Agendă** when nothing (or nothing valid) is stored.
 * Ruling R14 names no default; the agenda is what the Calendar was before.
 * Storage may be unavailable (private mode, disabled): then nothing is
 * remembered and nothing breaks.
 */
export function readCalendarView(): CalendarView {
  try {
    return localStorage.getItem(CALENDAR_VIEW_STORAGE_KEY) === 'month'
      ? 'month'
      : 'agenda';
  } catch {
    return 'agenda';
  }
}

export function writeCalendarView(view: CalendarView): void {
  try {
    localStorage.setItem(CALENDAR_VIEW_STORAGE_KEY, view);
  } catch {
    // Storage write failed: the choice lasts for this visit only.
  }
}

/** The view, per device, surviving a reload. */
export function useCalendarView() {
  const [view, setView] = useState<CalendarView>(readCalendarView);
  const choose = useCallback((next: CalendarView) => {
    writeCalendarView(next);
    setView(next);
  }, []);
  return [view, choose] as const;
}

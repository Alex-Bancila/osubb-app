import { useSyncExternalStore } from 'react';

/**
 * The sentence an Event command leaves on its card ("Modificările sunt
 * salvate."), kept outside the card: an edit that moves the Event to another
 * day moves its card to another day's list, which React mounts afresh, and the
 * receipt must survive that. The Calendar clears them when it unmounts, so a
 * later visit starts clean.
 */
const receipts = new Map<number, string>();
const listeners = new Set<() => void>();
// The page's own sentence, for an Event whose card is gone (#1017).
let calendarReceipt: { text: string; key: number } | null = null;
let receiptCount = 0;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setEventReceipt(eventId: number, text: string) {
  receipts.set(eventId, text);
  emit();
}

export function clearEventReceipts() {
  if (receipts.size === 0 && calendarReceipt === null) return;
  receipts.clear();
  calendarReceipt = null;
  emit();
}

export function useEventReceipt(eventId: number): string | null {
  return useSyncExternalStore(subscribe, () => receipts.get(eventId) ?? null);
}

/**
 * The Calendar's own sentence (#1017): an Event deleted for good takes its
 * card with it, so the receipt is the page's, not the card's. Cleared with
 * the cards' receipts when the Calendar unmounts.
 */

export function setCalendarReceipt(text: string) {
  receiptCount += 1;
  calendarReceipt = { text, key: receiptCount };
  emit();
}

export function useCalendarReceipt(): { text: string; key: number } | null {
  return useSyncExternalStore(subscribe, () => calendarReceipt);
}

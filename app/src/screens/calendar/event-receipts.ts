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
  if (receipts.size === 0) return;
  receipts.clear();
  emit();
}

export function useEventReceipt(eventId: number): string | null {
  return useSyncExternalStore(subscribe, () => receipts.get(eventId) ?? null);
}

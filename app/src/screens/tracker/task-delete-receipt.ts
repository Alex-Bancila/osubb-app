import { formatPointCount } from '../../lib/format';

/** What the list says once the Task is gone (the sheet closes with it). */
export function taskDeletedReceipt(pointsReversed: number): string {
  return pointsReversed === 0
    ? 'Taskul a fost șters definitiv.'
    : `Taskul a fost șters definitiv. Au fost retrase ${formatPointCount(Math.abs(pointsReversed))}.`;
}

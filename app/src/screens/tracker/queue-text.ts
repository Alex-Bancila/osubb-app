import type { OwnTaskQueue } from '../../queries/task-queue';

/**
 * The viewer's own queue line, or null when there is nothing to say: never
 * "not enrolled" (the join button says that, relevance B12), and never the
 * pending place when the stage sentence beside it already names it (B21).
 */
export function queueText(
  queue: OwnTaskQueue,
  { stageShown = false }: { stageShown?: boolean } = {},
): string | null {
  switch (queue.status) {
    case 'pending':
      if (stageShown) return null;
      return queue.position === null
        ? 'Înscris în lista de așteptare. Poziția se actualizează.'
        : // Ruling R9: every Candidate is queued; the card says where.
          `Te-ai înscris pe locul ${queue.position}.`;
    case 'selected':
      return 'Ai fost selectat pentru acest task.';
    case 'withdrawn':
      return 'Te-ai retras din lista de așteptare.';
    case 'closed':
      return 'Înscriere închisă.';
    default:
      return null;
  }
}

import { countLabel } from '../../components/delete-for-good/delete-text';

/** What the panel says once the Campaign is gone, from what lost its label. */
export function campaignDeletedReceipt(
  name: string,
  { tasks, events }: { tasks: number; events: number },
): string {
  const unlabelled = [
    tasks > 0 && countLabel(tasks, 'task', 'taskuri'),
    events > 0 && countLabel(events, 'eveniment', 'evenimente'),
  ].filter(Boolean);
  const many = tasks + events > 1;
  return unlabelled.length === 0
    ? `Campania „${name}” a fost ștearsă definitiv.`
    : `Campania „${name}” a fost ștearsă definitiv. ${unlabelled.join(' și ')} ${many ? 'au rămas' : 'a rămas'} fără etichetă.`;
}

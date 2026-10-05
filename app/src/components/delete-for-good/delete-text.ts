/** The one sentence every delete ends on. */
export const NO_UNDO = 'Nu poate fi recuperat.';

/**
 * A count with its Romanian noun: "1 eveniment", "3 evenimente",
 * "20 de evenimente" — "de" when the last two digits are 00 or 20–99.
 */
export function countLabel(count: number, one: string, many: string): string {
  if (count === 1) return `1 ${one}`;
  const lastTwo = count % 100;
  const de = count >= 20 && (lastTwo === 0 || lastTwo >= 20);
  return `${new Intl.NumberFormat('ro-RO').format(count)} ${de ? 'de ' : ''}${many}`;
}

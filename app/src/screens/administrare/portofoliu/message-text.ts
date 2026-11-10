/**
 * The words of the Mesaj view (ruling R66): pure, so the view and its tests
 * read the same sentences.
 */

/** The heading a new message starts with. */
export const DEFAULT_MESSAGE_TITLE = 'Mesaj de la Biroul de Conducere';

/** The link's label, filled in when a link is typed without one. */
export const DEFAULT_LINK_LABEL = 'Deschide formularul de adeziune';

/** Who receives it, under the section switch. */
export const AUDIENCE_LINE =
  'Îl văd, ca fereastră care trebuie confirmată, Voluntarii Activi studenți UBB.';

/** Romanian puts "de" before the noun for 20 and up, unless the last two digits are 1–19. */
function takesDe(count: number) {
  const lastTwo = count % 100;
  return count >= 20 && (lastTwo === 0 || lastTwo >= 20);
}

/** "1 Voluntar Activ student UBB", "3 Voluntari Activi…", "30 de Voluntari Activi…". */
export function eligibleCount(count: number): string {
  if (count === 1) return '1 Voluntar Activ student UBB';
  return `${count} ${takesDe(count) ? 'de ' : ''}Voluntari Activi studenți UBB`;
}

/** BC's counts line: who answered the version in force, of everyone eligible. */
export function countsLine(answered: number, eligible: number): string {
  if (eligible === 0)
    return 'Nu există acum niciun Voluntar Activ student UBB. Mesajul apare celor care devin.';
  return `Confirmat de ${answered} din ${eligibleCount(eligible)}.`;
}

/**
 * What publishing or asking again does, in the confirmation. `again`: the
 * Members who already answered are asked once more.
 */
export function showConsequence(
  eligible: number | undefined,
  again: boolean,
): string {
  const see = again ? 'vedea din nou' : 'vedea';
  // The count did not load: the sentence without it.
  if (eligible === undefined)
    return `Toți Voluntarii Activi studenți UBB vor ${see} mesajul și vor trebui să-l confirme.`;
  if (eligible === 0)
    return `Nu există acum niciun Voluntar Activ student UBB. Cei care devin vor ${see} mesajul și vor trebui să-l confirme.`;
  if (eligible === 1)
    return `Singurul Voluntar Activ student UBB va ${see} mesajul și va trebui să-l confirme.`;
  return `Toți cei ${eligibleCount(eligible)} vor ${see} mesajul și vor trebui să-l confirme.`;
}

/** Turning the message off, in its confirmation. */
export const STOP_CONSEQUENCE =
  'Nimeni nu va mai vedea mesajul, nici în Profil. Linkul rămâne salvat.';

/** The receipt after each save. */
export const RECEIPT = {
  published: 'Mesaj publicat.',
  saved: 'Mesaj salvat. Cine l-a citit nu îl mai vede ca fereastră.',
  shownAgain: 'Mesaj salvat. Toți îl vor vedea din nou.',
  stopped: 'Mesajul a fost oprit.',
} as const;

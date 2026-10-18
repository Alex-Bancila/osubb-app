/**
 * The Universitate on a Member's Profile (ruling R58, CONTEXT.md): a name
 * chosen from the universities of Cluj, or typed under "Altă universitate".
 * Only a student of Universitatea Babeș-Bolyai may be granted Drept de Vot,
 * and the server holds the same name once more
 * (`private.ubb_university()`), so this one must not drift from it.
 */
export const UBB = 'Universitatea Babeș-Bolyai';

/** The list a Member's Universitate is chosen from, UBB first. */
export const UNIVERSITIES: readonly string[] = [
  UBB,
  'Universitatea Tehnică din Cluj-Napoca',
  'Universitatea de Medicină și Farmacie „Iuliu Hațieganu”',
  'Universitatea de Științe Agricole și Medicină Veterinară Cluj-Napoca',
  'Universitatea de Artă și Design din Cluj-Napoca',
  'Academia Națională de Muzică „Gheorghe Dima”',
  'Universitatea Sapientia',
];

/** The select's value for a university the list does not name. */
export const OTHER_UNIVERSITY = 'other';

/**
 * Which entry of the select a stored Universitate is: its own entry when the
 * list names it, `OTHER_UNIVERSITY` for any other name, `null` for none.
 */
export function universityOption(value: string | null): string | null {
  if (value === null) return null;
  return UNIVERSITIES.includes(value) ? value : OTHER_UNIVERSITY;
}

/** Drept de Vot is for UBB students: an unknown Universitate does not count. */
export function isUbbStudent(value: string | null | undefined): boolean {
  return value === UBB;
}

/** The Universitate select's entries: the list, then the free-text one. */
export const UNIVERSITY_CHOICES: readonly { value: string; label: string }[] = [
  ...UNIVERSITIES.map((name) => ({ value: name, label: name })),
  { value: OTHER_UNIVERSITY, label: 'Altă universitate' },
];

/**
 * The select's draft for a stored Universitate: its list entry, or "Altă
 * universitate" with the stored name as the free text. Nothing stored is an
 * empty `option`, which the select shows as its placeholder.
 */
export function universityDraft(university: string | null) {
  const option = universityOption(university) ?? '';
  return {
    option,
    other: option === OTHER_UNIVERSITY ? (university ?? '') : '',
  };
}

/** What a Universitate form says when the write itself fails (no reason). */
export const UNIVERSITY_SAVE_FAILED =
  'Nu am putut salva universitatea. Verifică permisiunile și reîncearcă.';

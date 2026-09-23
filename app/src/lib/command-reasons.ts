/**
 * One table, every refusal.
 *
 * A command answers a refusal with a snake_case reason as the error message
 * (`docs/backend/conventions.md` §3: `42501 <scope>_forbidden`, `PT400`,
 * `PT404`, `PT409`). That string is a stable identifier, not copy — it must
 * never reach a member's screen. This is the single place it becomes Romanian,
 * so Administrare, the Applications tab (#589), member detail (#103) and the
 * Campaign panel all say the same thing about the same refusal.
 *
 * The copy says what happened and what to do next; it never describes how the
 * rule is implemented.
 */
const REASON_COPY = new Map<string, string>([
  /* ---- Group structure and settings (#582) ---- */
  [
    'group_manage_forbidden',
    'Nu ai permisiunea să faci această schimbare în acest grup.',
  ],
  ['invalid_group_name', 'Scrie un nume de grup valid.'],
  ['invalid_group_category', 'Alege o categorie pentru grup.'],
  ['invalid_group_min_level', 'Alege un nivel minim valid.'],
  ['invalid_group_color', 'Alege o culoare validă.'],
  ['group_name_taken', 'Există deja un grup cu acest nume. Alege altul.'],
  ['group_archived', 'Grupul este arhivat.'],
  ['group_already_archived', 'Grupul este deja arhivat.'],
  [
    'group_min_level_below_parent',
    'Nivelul minim nu poate fi sub nivelul minim al grupului părinte.',
  ],
  [
    'group_min_level_above_actor',
    'Nu poți cere un nivel minim mai mare decât nivelul tău.',
  ],
  [
    'group_min_level_above_children',
    'Un subgrup are un nivel minim mai mic. Schimbă întâi subgrupul.',
  ],
  ['invalid_position_title', 'Scrie un nume de funcție valid.'],
  ['position_title_required', 'Scrie cum se numește funcția responsabilului.'],
  ['invalid_application_level', 'Alege un nivel valid pentru cereri.'],
  [
    'application_level_below_min_level',
    'Nivelul de la care se poate cere înscrierea nu poate fi sub nivelul minim al grupului.',
  ],
  [
    'automatic_group_accepts_no_applications',
    'Un grup cu membri adăugați automat nu primește cereri de înscriere.',
  ],
  [
    'automatic_group_has_roster_members',
    'Grupul are membri adăugați manual. Scoate-i înainte de a trece la membri automați.',
  ],
  [
    'automatic_group_has_no_roster_members',
    'Grupul își adaugă membrii automat, după nivel.',
  ],
  [
    'cup_not_top_level',
    'Doar un grup fără grup părinte poate concura în Cupa Departamentelor.',
  ],
  ['organization_group_exists', 'Există deja un grup al organizației.'],
  [
    'group_has_members_below_level',
    'Unii membri au nivelul sub noul nivel minim. Confirmă scoaterea lor.',
  ],
  ['group_has_open_work', 'Grupul are lucru neterminat.'],
  ['nothing_to_update', 'Nu ai schimbat nimic.'],

  /* ---- Group roster and Group Roles (#583) ---- */
  ['invalid_group_role', 'Alege o funcție validă.'],
  ['already_group_member', 'Membrul face deja parte din grup.'],
  ['group_member_not_found', 'Membrul nu mai face parte din grup.'],
  [
    'group_member_holds_role',
    'Membrul are o funcție în grup. Scoate-i întâi funcția.',
  ],
  ['group_member_not_eligible', 'Membrul nu este activ.'],
  [
    'group_member_below_min_level',
    'Membrul are nivelul sub nivelul minim al grupului.',
  ],

  /* ---- Campaigns (#556) ---- */
  [
    'campaign_manage_forbidden',
    'Nu mai ai permisiunea de a modifica această campanie.',
  ],
  ['invalid_campaign_name', 'Verifică numele campaniei.'],
  [
    'campaign_name_taken',
    'Există deja o campanie cu acest nume în grup. Alege alt nume.',
  ],
  ['campaign_not_found', 'Campania nu mai este disponibilă.'],
  ['invalid_campaign_active', 'Verifică starea campaniei.'],
]);

/** The snake_case reason a command raised, when the failure carries one. */
export function commandReason(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('message' in error))
    return;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return;
  // Only a bare reason token is one of ours: anything with spaces is a
  // Postgres or transport message and must not be shown either way.
  return /^[a-z][a-z0-9_]*$/.test(message) && REASON_COPY.has(message)
    ? message
    : undefined;
}

/** The Romanian copy for a reason, or `undefined` when it is not one of ours. */
export function reasonCopy(reason: string | undefined): string | undefined {
  return reason === undefined ? undefined : REASON_COPY.get(reason);
}

/**
 * A failure, as a member should read it: the translated reason when the server
 * refused for a reason we know, the caller's fallback otherwise. A raw
 * snake_case string never escapes this function.
 */
export function commandErrorMessage(error: unknown, fallback: string): string {
  return reasonCopy(commandReason(error)) ?? fallback;
}

/**
 * A refusal already turned into copy. `reason` keeps the server's identifier
 * so a screen can react to a specific one — the Minimum Level form re-renders
 * its removal preview on `group_has_members_below_level` — without matching on
 * the Romanian text.
 */
export class CommandError extends Error {
  readonly reason: string | undefined;
  constructor(error: unknown, fallback: string) {
    super(commandErrorMessage(error, fallback));
    this.name = 'CommandError';
    this.reason = commandReason(error);
  }
}

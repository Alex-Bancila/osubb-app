/**
 * One table, every refusal.
 *
 * A command answers a refusal with a snake_case reason as the error message
 * (`docs/backend/conventions.md` §3: `42501 <scope>_forbidden`, `PT400`,
 * `PT404`, `PT409`, and the `23514` row guards). That string is a stable
 * identifier, not copy — it must never reach a member's screen. This is the
 * single place it becomes Romanian (ruling R8, #674), so every screen says the
 * same thing about the same refusal, and the rule a form checks in the browser
 * (`lib/schemas/`) says it in the same words the server would.
 *
 * A handful of reasons are the browser's own, for what only the browser can
 * see — a wall-clock time that does not exist in Romania, a Group that a fresh
 * read no longer offers. They are marked "browser" below and never come back
 * from the server.
 *
 * The copy says what happened and what to do next; it never describes how the
 * rule is implemented. A reason keeps one copy everywhere, so it is worded to
 * fit every command that raises it.
 */
const REASON_COPY = new Map<string, string>([
  [
    'group_not_accepting_applications',
    'Acest grup nu primește cereri de înscriere.',
  ],
  ['already_group_member', 'Ești deja membru în acest grup.'],
  ['application_pending', 'Ai deja o cerere în așteptare.'],
  ['group_apply_forbidden', 'Nu îndeplinești nivelul necesar pentru a aplica.'],
  ['application_not_found', 'Cererea nu mai este disponibilă.'],
  ['application_not_pending', 'Cererea a fost deja soluționată.'],
  ['application_withdraw_forbidden', 'Poți retrage doar propria cerere.'],
  ['invalid_application_decision', 'Alege dacă accepți sau respingi cererea.'],
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
  // #756 (ruling R25): Private Groups.
  [
    'group_private',
    'Un grup privat nu primește cereri de înscriere. Membrii intră prin numire.',
  ],
  [
    'private_parent',
    'Un grup dintr-un grup privat rămâne privat cât timp grupul părinte e privat.',
  ],
  ['invalid_group_privacy', 'Alege dacă grupul este privat.'],
  [
    'private_not_allowed_for_organization',
    'Grupul organizației nu poate fi privat.',
  ],
  [
    'private_group_local_only',
    'Taskurile unui grup privat sunt doar pentru membrii lui. Alege audiența locală.',
  ],
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
  ['invalid_campaign_name', 'Scrie numele campaniei.'],
  [
    'campaign_name_taken',
    'Există deja o campanie cu acest nume în grup. Alege alt nume.',
  ],
  ['campaign_not_found', 'Campania nu mai este disponibilă.'],
  ['invalid_campaign_active', 'Verifică starea campaniei.'],

  /* ---- Work Filter date range (#677, #678) ---- */
  [
    'invalid_date_range',
    'Data de sfârșit nu poate fi înaintea celei de început.',
  ],

  /* ---- Input limits (#673, ruling R8) ---- */
  ['title_required', 'Scrie titlul.'],
  ['title_too_short', 'Titlul are cel puțin 3 caractere.'],
  ['title_too_long', 'Titlul are cel mult 120 de caractere.'],
  ['description_too_long', 'Descrierea are cel mult 2000 de caractere.'],
  ['name_too_short', 'Numele are cel puțin 3 caractere.'],
  ['name_too_long', 'Numele are cel mult 120 de caractere.'],
  ['body_required', 'Scrie mesajul.'],
  ['body_too_long', 'Mesajul are cel mult 2000 de caractere.'],
  ['note_required', 'Scrie o notă.'],
  ['note_too_long', 'Nota are cel mult 1000 de caractere.'],
  ['reason_required', 'Scrie motivul.'],
  ['reason_too_long', 'Motivul are cel mult 1000 de caractere.'],
  ['deadline_in_past', 'Termenul nu poate fi în trecut.'],
  ['starts_at_in_past', 'Începutul nu poate fi în trecut.'],
  ['link_label_too_long', 'Numele linkului are cel mult 60 de caractere.'],
  ['link_url_invalid', 'Adresa trebuie să înceapă cu http:// sau https://.'],
  ['link_url_too_long', 'Adresa are cel mult 2048 de caractere.'],
  [
    'link_incomplete',
    'Completează și numele, și adresa linkului, sau lasă-le pe amândouă goale.',
  ],
  [
    'phone_invalid',
    'Scrie un număr de telefon valid (de exemplu 0730 655 145).',
  ],
  /* browser */
  ['link_label_required', 'Scrie numele linkului sau lasă linkul gol.'],
  ['link_url_required', 'Scrie adresa linkului sau lasă linkul gol.'],

  /* ---- Tasks: create, edit, assign, duplicate, Umbrellas ---- */
  [
    'task_command_forbidden',
    'Nu mai ai permisiunea să gestionezi taskurile acestui grup.',
  ],
  [
    'task_manage_forbidden',
    'Nu mai ai permisiunea să gestionezi taskurile acestui grup.',
  ],
  ['task_not_found', 'Taskul nu mai este disponibil.'],
  ['task_group_required', 'Alege exact un grup de origine.'],
  ['invalid_task_kind', 'Alege un tip de task valid.'],
  ['deadline_required', 'Alege termenul taskului.'],
  ['invalid_audience', 'Alege audiența taskului.'],
  ['invalid_assignment_mode', 'Alege atribuirea directă sau publică.'],
  [
    'invalid_executor',
    'Executorul nu mai este eligibil. Alege un membru activ care îndeplinește nivelul minim.',
  ],
  [
    'executor_not_allowed_for_public',
    'Un task public primește Executor prin lista de candidați.',
  ],
  ['invalid_campaign', 'Campania nu mai este disponibilă pentru grupul ales.'],
  ['umbrella_has_no_campaign', 'Taskul-umbrelă nu poate avea o campanie.'],
  [
    'umbrella_has_no_mode',
    'Taskul-umbrelă nu are audiență, mod de atribuire, Executor sau campanie.',
  ],
  ['task_is_umbrella', 'Acest lucru nu se poate face pentru un task-umbrelă.'],
  ['parent_not_umbrella', 'Alege un task-umbrelă valid pentru Subtask.'],
  [
    'parent_terminal',
    'Taskul-umbrelă s-a schimbat. Alege un părinte nefinalizat.',
  ],
  [
    'subtask_origin_mismatch',
    'Subtaskul trebuie să păstreze grupul de origine al taskului-umbrelă.',
  ],
  ['subtask_cannot_be_umbrella', 'Un task-umbrelă nu poate fi Subtask.'],
  ['invalid_group', 'Grupul ales nu mai este activ. Alege alt grup.'],
  [
    'subtask_origin_immutable',
    'Un subtask rămâne în grupul taskului-umbrelă. Nu îi poți schimba grupul.',
  ],
  [
    'umbrella_has_subtasks',
    'Un task-umbrelă cu subtaskuri nu își poate schimba grupul.',
  ],
  [
    'task_in_review',
    'Taskul este în verificare și nu mai poate fi editat. Verifică starea actuală.',
  ],
  ['task_terminal', 'Taskul este deja încheiat. Verifică starea actuală.'],
  [
    'task_parent_changed',
    'Taskul-umbrelă s-a schimbat între timp. Verifică starea actuală.',
  ],
  ['task_not_direct', 'Taskul nu mai folosește atribuirea directă.'],
  [
    'task_already_assigned',
    'Taskul are deja un Executor. Verifică starea actuală.',
  ],
  ['task_not_umbrella', 'Taskul ales nu este un task-umbrelă.'],
  [
    'umbrella_has_no_subtasks',
    'Adaugă cel puțin un subtask înainte de finalizare.',
  ],
  [
    'subtasks_not_terminal',
    'Starea subtaskurilor s-a schimbat. Verifică lista actualizată.',
  ],
  /* browser */
  ['deadline_invalid', 'Alege un termen valid, în ora României.'],
  [
    'task_group_unavailable',
    'Nu mai poți pregăti taskuri pentru grupul ales. Alege un grup disponibil.',
  ],
  [
    'parent_unavailable',
    'Taskul-umbrelă nu mai este disponibil. Alege alt părinte.',
  ],

  /* ---- Evaluations and Completed Work Requests ---- */
  ['invalid_difficulty', 'Alege o Dificultate între 1 și 5.'],
  ['invalid_rating', 'Alege un Calificativ între 1 și 5.'],
  ['evaluation_note_required', 'Scrie nota evaluării.'],
  [
    'request_not_pending',
    'Cererea a fost deja decisă. Lista a fost actualizată.',
  ],
  [
    'request_command_forbidden',
    'Nu mai ai permisiunea de a decide această cerere.',
  ],
  [
    'request_decide_forbidden',
    'Nu mai ai permisiunea de a decide această cerere.',
  ],
  ['request_not_found', 'Cererea nu mai este disponibilă.'],
  ['description_required', 'Descrierea este obligatorie.'],
  ['invalid_origin', 'Alege un grup pentru această activitate.'],
  ['request_origin_forbidden', 'Nu mai faci parte din grupul ales.'],

  /* ---- Calendar ---- */
  ['invalid_event_title', 'Scrie titlul evenimentului.'],
  ['invalid_event_type', 'Alege un tip de eveniment valid.'],
  [
    'invalid_event_interval',
    'Ora de încheiere trebuie să fie după ora de început.',
  ],
  [
    'invalid_event_capacity',
    'Capacitatea este un număr întreg între 1 și 1000.',
  ],
  ['invalid_event_min_level', 'Alege un nivel minim valid.'],
  ['event_group_required', 'Alege grupul evenimentului.'],
  [
    'calendar_manage_forbidden',
    'Nu mai ai permisiunea să gestionezi evenimentele acestui grup. Reîncarcă pagina și încearcă din nou.',
  ],
  [
    'event_min_level_below_group',
    'Nivelul ales este sub nivelul minim al grupului.',
  ],
  [
    'event_min_level_above_actor',
    'Nu poți alege un nivel minim peste nivelul tău.',
  ],
  /* browser */
  ['starts_at_required', 'Alege ora de început.'],
  ['starts_at_invalid', 'Ora de început nu există în fusul orar al României.'],
  ['ends_at_invalid', 'Ora de încheiere nu există în fusul orar al României.'],

  /* ---- Announcements ---- */
  /* browser */
  ['announcement_group_required', 'Alege un grup din lista disponibilă.'],

  /* ---- Members and profiles ---- */
  [
    'member_manage_forbidden',
    'Nu mai ai permisiunea de a modifica acest membru. Reîncarcă pagina.',
  ],
  ['member_not_found', 'Membrul nu mai este disponibil. Reîncarcă pagina.'],
  // #675 (ruling R5): the Nickname guard on `profiles`.
  ['nickname_too_short', 'Pseudonimul are cel puțin 2 caractere.'],
  ['nickname_too_long', 'Pseudonimul are cel mult 24 de caractere.'],
  [
    'nickname_invalid',
    'Pseudonimul poate avea doar litere, cifre, spații, punct, cratimă sau underscore.',
  ],
  [
    'nickname_taken',
    'Pseudonimul este deja folosit de alt membru. Alege altul.',
  ],
  /* browser */
  ['full_name_required', 'Scrie numele complet.'],
  ['invalid_avatar_color', 'Alege o culoare din listă.'],
  ['email_invalid', 'Scrie o adresă de email validă.'],

  /* ---- Web Push on this device (#704) ---- */
  /* browser */
  [
    'push_subscribe_failed',
    'Nu am putut schimba notificările pe acest dispozitiv. Verifică internetul și încearcă din nou.',
  ],
  /* ---- Push preferences (#635) ---- */
  /* browser */
  [
    'push_preference_failed',
    'Nu am putut salva preferința. Verifică internetul și încearcă din nou.',
  ],
  [
    'push_preferences_unavailable',
    'Nu am putut încărca preferințele. Verifică internetul și reîncarcă pagina.',
  ],
]);

/** Every reason with copy, for tests that prove a list of reasons is covered. */
export function knownReasons(): ReadonlySet<string> {
  return new Set(REASON_COPY.keys());
}

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

/**
 * A failure as a form needs it: the reason, when it is one of ours, so the
 * form can put the message under the field it belongs to, and the copy to
 * show. A `CommandError` has already been translated; anything else is.
 */
export function describeFailure(
  error: unknown,
  fallback: string,
): { reason: string | undefined; message: string } {
  if (error instanceof CommandError)
    return { reason: error.reason, message: error.message };
  return {
    reason: commandReason(error),
    message: commandErrorMessage(error, fallback),
  };
}

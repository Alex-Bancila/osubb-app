import { countLabel } from '../../components/delete-for-good/delete-text';

/**
 * The Ștergere panel's words (#1087, ruling R59), from `member_delete_preview`.
 * The server names what holds an account by its column (`tasks.created_by`);
 * a Member reads it by kind, each kind once, in this order. A column the
 * server adds later still refuses, in general words, until it is named here.
 */
const HELD_KINDS: readonly (readonly [
  kind: string,
  tables: readonly string[],
])[] = [
  [
    'taskuri',
    [
      'tasks',
      'task_assignments',
      'task_candidates',
      'task_activity',
      'task_evaluations',
    ],
  ],
  ['puncte', ['points_ledger']],
  ['cereri de activitate realizată', ['completed_work_requests']],
  ['evenimente', ['events', 'event_attendance']],
  ['anunțuri', ['announcements']],
  ['campanii', ['campaigns']],
  ['cereri de înscriere în grupuri', ['group_applications']],
  ['funcții în grupuri', ['group_members']],
  ['grupuri create', ['groups']],
  ['echipa OSUBB Deals', ['assignment_team']],
  [
    'Portofoliu Interne',
    [
      'promotion_candidates',
      'retention_signals',
      'role_evaluations',
      'promotion_thresholds',
      'promotion_threshold_changes',
      'evaluation_settings',
    ],
  ],
  ['decizii despre roluri', ['role_history']],
  ['importuri', ['member_imports', 'legacy_task_imports']],
  ['setările organizației', ['org_settings']],
];
const UNNAMED_KIND = 'alte date ale aplicației';

const list = new Intl.ListFormat('ro', { style: 'long', type: 'conjunction' });

/** "Contul are istoric în taskuri, puncte și evenimente." */
export function memberHeldSentence(
  holds: Readonly<Record<string, number>>,
): string {
  const tables = new Set(Object.keys(holds).map((key) => key.split('.')[0]));
  const named = HELD_KINDS.filter(([, owned]) =>
    owned.some((table) => tables.has(table)),
  ).map(([kind]) => kind);
  const known = new Set(HELD_KINDS.flatMap(([, owned]) => owned));
  const kinds = [...tables].some((table) => !known.has(table ?? ''))
    ? [...named, UNNAMED_KIND]
    : named;
  return `Contul are istoric în ${list.format(kinds)}.`;
}

/** What goes with the account, one fact per row, the profile first. */
export function memberGoesItems(
  goes: Readonly<Record<string, number>>,
): string[] {
  const n = (table: string) => goes[table] ?? 0;
  const items = ['profilul și contul de conectare'];
  if (n('group_members'))
    items.push(
      `locul din ${countLabel(n('group_members'), 'grup', 'grupuri')}`,
    );
  if (n('notifications'))
    items.push(countLabel(n('notifications'), 'notificare', 'notificări'));
  if (n('push_tokens'))
    items.push(
      countLabel(
        n('push_tokens'),
        'dispozitiv cu notificări push',
        'dispozitive cu notificări push',
      ),
    );
  if (n('notification_push_preferences') || n('notification_email_preferences'))
    items.push('preferințele de notificare');
  if (n('privacy_notice_acknowledgements'))
    items.push(
      countLabel(
        n('privacy_notice_acknowledgements'),
        'confirmare a politicii de confidențialitate',
        'confirmări ale politicii de confidențialitate',
      ),
    );
  if (n('role_history'))
    items.push(
      countLabel(
        n('role_history'),
        'schimbare din istoricul de roluri',
        'schimbări din istoricul de roluri',
      ),
    );
  if (n('member_imports'))
    items.push('înregistrarea din importul de voluntari');
  if (n('email_digests'))
    items.push(
      countLabel(n('email_digests'), 'rezumat pe email', 'rezumate pe email'),
    );
  if (n('member_group_unselected')) items.push('alegerea grupurilor preferate');
  if (n('announcement_reads'))
    items.push(
      countLabel(n('announcement_reads'), 'anunț citit', 'anunțuri citite'),
    );
  if (n('deal_code_reveals'))
    items.push(
      countLabel(
        n('deal_code_reveals'),
        'cod OSUBB Deals afișat',
        'coduri OSUBB Deals afișate',
      ),
    );
  return items;
}

/** The Membri tab's receipt: the name as typed, no gendered article. */
export function memberDeletedReceipt(fullName: string): string {
  return `Contul „${fullName}” a fost șters definitiv.`;
}

/** Where a deleted Member's page sends BC, with the receipt. */
export const MEMBERS_LIST_PATH = '/administrare/membri';
export type MembersListState = { receipt?: string };

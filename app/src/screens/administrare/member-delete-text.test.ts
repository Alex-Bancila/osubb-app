import { expect, it } from 'vitest';
import {
  memberDeletedReceipt,
  memberGoesItems,
  memberHeldSentence,
} from './member-delete-text';

/* #1087 (ruling R59): the Ștergere panel's copy, from the server's preview. */
it('names what holds an account by kind, in a fixed order, each kind once', () => {
  expect(
    memberHeldSentence({
      'event_attendance.member_id': 1,
      'task_assignments.member_id': 2,
      'points_ledger.member_id': 4,
      'tasks.created_by': 1,
    }),
  ).toBe('Contul are istoric în taskuri, puncte și evenimente.');
  expect(memberHeldSentence({ 'group_members.member_id': 1 })).toBe(
    'Contul are istoric în funcții în grupuri.',
  );
});

it('names every column the server can hold an account by', () => {
  expect(
    memberHeldSentence({
      'announcements.approval_decided_by': 1,
      'assignment_team.set_by': 1,
      'campaigns.created_by': 1,
      'completed_work_requests.requester_id': 1,
      'evaluation_settings.updated_by': 1,
      'group_applications.member_id': 1,
      'groups.created_by': 1,
      'legacy_task_imports.imported_by': 1,
      'org_settings.updated_by': 1,
      'promotion_candidates.member_id': 1,
      'role_history.changed_by': 1,
    }),
  ).toBe(
    'Contul are istoric în cereri de activitate realizată, anunțuri, campanii, cereri de înscriere în grupuri, grupuri create, echipa OSUBB Deals, Portofoliu Interne, decizii despre roluri, importuri și setările organizației.',
  );
});

it('still refuses a column it has no name for, in general words', () => {
  expect(memberHeldSentence({ 'a_future_table.member_id': 3 })).toBe(
    'Contul are istoric în alte date ale aplicației.',
  );
});

it('lists what goes with the account, the profile first, then the non-zero rows', () => {
  expect(
    memberGoesItems({
      group_members: 2,
      notifications: 21,
      push_tokens: 1,
      privacy_notice_acknowledgements: 1,
      role_history: 1,
      member_imports: 1,
      notification_push_preferences: 3,
      notification_email_preferences: 1,
    }),
  ).toEqual([
    'profilul și contul de conectare',
    'locul din 2 grupuri',
    '21 de notificări',
    '1 dispozitiv cu notificări push',
    'preferințele de notificare',
    '1 confirmare a politicii de confidențialitate',
    '1 schimbare din istoricul de roluri',
    'înregistrarea din importul de voluntari',
  ]);
  expect(memberGoesItems({})).toEqual(['profilul și contul de conectare']);
});

it('confirms the deletion by the name typed, without a gendered article', () => {
  expect(memberDeletedReceipt('Ana Pop')).toBe(
    'Contul „Ana Pop” a fost șters definitiv.',
  );
});

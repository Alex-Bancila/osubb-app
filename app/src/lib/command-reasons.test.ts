import { expect, it } from 'vitest';
import {
  CommandError,
  commandErrorMessage,
  commandReason,
  reasonCopy,
} from './command-reasons';

it('turns a Group command refusal into Romanian, one table for every screen', () => {
  expect(
    commandErrorMessage(
      { code: '42501', message: 'group_manage_forbidden' },
      'fallback',
    ),
  ).toBe('Nu ai permisiunea să faci această schimbare în acest grup.');
  expect(
    commandErrorMessage(
      { code: 'PT409', message: 'group_has_open_work' },
      'fallback',
    ),
  ).toBe('Grupul are lucru neterminat.');
  // The Campaign panel reads the same table rather than keeping a second one.
  expect(reasonCopy('campaign_name_taken')).toMatch('Există deja o campanie');
});

it('never lets a snake_case reason or a database message reach the screen', () => {
  const unknown = commandErrorMessage(
    { code: 'PT409', message: 'some_reason_we_never_wrote' },
    'Nu am putut salva schimbarea.',
  );
  expect(unknown).toBe('Nu am putut salva schimbarea.');
  expect(unknown).not.toMatch(/_/);
  expect(
    commandErrorMessage(
      { code: '42501', message: 'permission denied for table groups' },
      'Nu am putut salva schimbarea.',
    ),
  ).toBe('Nu am putut salva schimbarea.');
  expect(commandErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
  expect(commandReason({ message: 'not a reason at all' })).toBeUndefined();
});

it('keeps the server identifier so a screen can react to one refusal', () => {
  const failure = new CommandError(
    { code: 'PT409', message: 'group_has_members_below_level' },
    'fallback',
  );
  expect(failure.reason).toBe('group_has_members_below_level');
  expect(failure.message).toMatch('Confirmă scoaterea');
  expect(
    new CommandError({ message: 'nope nope' }, 'fallback').reason,
  ).toBeUndefined();
});

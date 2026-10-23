import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { AppointableMember } from '../../queries/groups-admin';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import { MemberPicker } from './MemberPicker';

function member(over: Partial<AppointableMember>): AppointableMember {
  return {
    memberId: 'm',
    name: 'Membru',
    nickname: null,
    avatarColor: null,
    status: 'activ',
    roleId: 'voluntar',
    roleLabel: 'Voluntar',
    level: 1,
    ...over,
  };
}

const members = [
  member({ memberId: 'stefan', name: 'Ștefan Ionescu', nickname: 'Stefi' }),
  member({ memberId: 'ana', name: 'Ana Pop', roleLabel: 'Președinte' }),
];

async function search(text: string, noneLabel?: string) {
  const user = userEvent.setup();
  render(
    <>
      <span id="label">Manager</span>
      <MemberPicker
        ariaLabelledBy="label"
        members={members}
        value={null}
        onValueChange={vi.fn()}
        noneLabel={noneLabel}
      />
    </>,
  );
  await user.click(screen.getByRole('combobox', { name: 'Manager' }));
  await user.type(
    await screen.findByRole('combobox', { name: 'Caută un membru' }),
    text,
  );
}
const optionNames = () =>
  screen.getAllByRole('option').map((option) => option.textContent);

it('finds a Member with a Nickname by the full name, without diacritics', async () => {
  await search('stefan');
  await waitFor(() => expect(optionNames()).toHaveLength(1));
  expect(optionNames()[0]).toContain('Ștefan Ionescu');
});

it('finds the same Member by the Nickname', async () => {
  await search('stefi');
  await waitFor(() => expect(optionNames()).toHaveLength(1));
  expect(optionNames()[0]).toContain('Ștefan Ionescu');
});

it('still finds a Member by their Role label', async () => {
  await search('presedinte');
  await waitFor(() => expect(optionNames()).toHaveLength(1));
  expect(optionNames()[0]).toContain('Ana Pop');
});

it('keeps the "nobody" row findable by its own label', async () => {
  await search('fara', 'Fără manager direct');
  await waitFor(() => expect(optionNames()).toEqual(['Fără manager direct']));
});

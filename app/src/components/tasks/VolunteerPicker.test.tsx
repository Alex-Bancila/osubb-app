import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CompletedTaskVolunteer } from '../../queries/completed-tasks';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const hook = vi.hoisted(() => vi.fn());
vi.mock('../../queries/completed-tasks', async (original) => ({
  ...(await original<object>()),
  useCompletedTaskExecutors: hook,
}));
import { VolunteerPicker } from './VolunteerPicker';

// `name` is what is shown: the Nickname when set (R5), else the full name.
const volunteers: CompletedTaskVolunteer[] = [
  {
    id: 'stefan',
    name: 'Stefi',
    nickname: 'Stefi',
    fullName: 'Ștefan Ionescu',
    avatarColor: null,
  },
  {
    id: 'ana',
    name: 'Ana Pop',
    nickname: null,
    fullName: 'Ana Pop',
    avatarColor: null,
  },
];

beforeEach(() =>
  hook.mockReturnValue({
    data: volunteers,
    isPending: false,
    isError: false,
    isSuccess: true,
  }),
);

const optionNames = () =>
  screen.getAllByRole('option').map((option) => option.textContent);

async function search(text: string) {
  const user = userEvent.setup();
  render(<VolunteerPicker groupId={7} value={null} onChange={vi.fn()} />);
  await user.click(screen.getByRole('combobox', { name: 'Voluntar' }));
  await user.type(
    await screen.findByRole('combobox', { name: 'Caută un membru' }),
    text,
  );
}

it('finds a Member shown by Nickname through the real name, without diacritics', async () => {
  await search('stefan ion');
  await waitFor(() => expect(optionNames()).toEqual(['STStefi']));
});

it('finds the same Member by the Nickname', async () => {
  await search('STEF');
  await waitFor(() => expect(optionNames()).toEqual(['STStefi']));
});

it('does not find a Member by a name that is neither', async () => {
  await search('pop stefan');
  await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
});

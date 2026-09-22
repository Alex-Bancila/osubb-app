import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { beforeEach, expect, it, vi } from 'vitest';

const hook = vi.hoisted(() => vi.fn());
vi.mock('@/queries/member-profile', () => ({ useMemberProfile: hook }));

import { MemberProfileButton } from './MemberProfileDialog';

const profile = {
  id: 'member-1',
  fullName: 'Ana Pop',
  avatarColor: '#0055aa',
  roleLabel: 'Membru cu Drept de Vot',
  joinedYear: 2024,
  groups: [
    {
      id: 1,
      name: 'IT',
      short: 'IT',
      color: '#123456',
      category: 'department',
      group_role: 'manager',
      position_title: null,
      role_label: 'Coordonator',
      label: 'IT',
    },
    {
      id: 7,
      name: 'Web',
      short: null,
      color: null,
      category: 'team',
      group_role: 'member',
      position_title: null,
      role_label: 'Membru',
      label: 'Web · IT',
    },
  ],
  email: 'ana@osubb.ro',
  phone: '+40 700 000 000',
};

beforeEach(() => {
  hook.mockReset();
  hook.mockReturnValue({
    data: profile,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
});

it('reads nothing until the profile is opened', () => {
  render(<MemberProfileButton memberId="member-1" name="Ana Pop" />);
  expect(hook).not.toHaveBeenCalled();
});

it('opens a Dialog with the member, their Groups and the contact they may see', async () => {
  render(
    <MemberProfileButton memberId="member-1" name="Ana Pop" points={42} />,
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Profilul membrului Ana Pop' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Ana Pop' });
  expect(hook).toHaveBeenCalledWith('member-1');
  expect(dialog).toHaveTextContent('Membru cu Drept de Vot · Membru din 2024');
  expect(dialog).toHaveTextContent('42 puncte');
  const groups = within(dialog).getByRole('region', { name: 'Grupuri' });
  expect(within(groups).getAllByRole('listitem')).toHaveLength(2);
  expect(groups).toHaveTextContent('Web · IT');
  expect(groups).toHaveTextContent('Coordonator');
  expect(
    within(dialog).getByRole('link', { name: 'ana@osubb.ro' }),
  ).toHaveAttribute('href', 'mailto:ana@osubb.ro');
  expect((await axe.run(dialog)).violations).toEqual([]);
});

it('omits the sections the viewer may not read', async () => {
  hook.mockReturnValue({
    data: { ...profile, groups: [], email: null, phone: null },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  render(<MemberProfileButton memberId="member-1" name="Ana Pop" />);
  await userEvent.click(screen.getByRole('button'));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByText('Grupuri')).not.toBeInTheDocument();
  expect(within(dialog).queryByText('Contact')).not.toBeInTheDocument();
  expect(dialog).not.toHaveTextContent('puncte');
});

it('shows loading and a retry on failure', async () => {
  const refetch = vi.fn();
  hook.mockReturnValue({ isPending: true, isError: false, refetch });
  const { rerender } = render(
    <MemberProfileButton memberId="member-1" name="Ana Pop" />,
  );
  await userEvent.click(screen.getByRole('button'));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Se încarcă profilul',
  );
  // The name the caller already had is shown while the read is pending.
  expect(screen.getByRole('dialog', { name: 'Ana Pop' })).toBeVisible();

  hook.mockReturnValue({ isPending: false, isError: true, refetch });
  rerender(<MemberProfileButton memberId="member-1" name="Ana Pop" />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Reîncarcă profilul' }),
  );
  expect(refetch).toHaveBeenCalledOnce();
});

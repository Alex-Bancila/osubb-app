import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

vi.mock('@ionic/react', () => ({ IonIcon: () => null }));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}));
vi.mock('../../queries/profile', () => ({
  useMyProfile: () => ({ data: { avatar_color: '#284C93' } }),
}));
vi.mock('../../queries/points', () => ({
  useLeaderboard: () => ({
    isPending: false,
    isError: false,
    data: [
      {
        member_id: 'a',
        full_name: 'Ana Pop',
        nickname: 'Ani',
        points: 20,
        rank: 1,
      },
      {
        member_id: 'me',
        full_name: 'Ioana Popescu',
        nickname: null,
        points: 15,
        rank: 2,
      },
    ],
  }),
  useMyStanding: () => ({ data: undefined }),
}));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
vi.mock('../../lib/capabilities', () => ({
  useCapability: () => ({ data: false }),
}));

import { useMemberCard } from '../../test/member-card-mock';
import LeaderboardCard from './LeaderboardCard';

it('names every ranked Member as a button that opens their Member Card', async () => {
  const user = userEvent.setup();
  render(<LeaderboardCard />);
  const [first, mine, ...rest] = within(screen.getByRole('list')).getAllByRole(
    'listitem',
  );
  if (!first || !mine) throw new Error('Expected two ranked rows.');
  expect(rest).toHaveLength(0);
  // The Nickname stands in for the full name; my own row keeps its "tu".
  expect(
    within(first).getByRole('button', { name: 'Profilul membrului Ani' }),
  ).not.toHaveTextContent('Ana Pop');
  expect(mine).toHaveTextContent('tu');
  await user.click(
    within(mine).getByRole('button', {
      name: 'Profilul membrului Ioana Popescu',
    }),
  );
  const card = await screen.findByRole('dialog', { name: 'Ioana Popescu' });
  expect(useMemberCard).toHaveBeenCalledWith('me');
  // The board's rank and points stay on the board.
  expect(card).not.toHaveTextContent(/15|locul/i);
});

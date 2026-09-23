import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

const hook = vi.hoisted(() => vi.fn());
vi.mock('@/queries/member-card', () => ({ useMemberCard: hook }));
vi.mock('@/lib/capabilities', () => ({
  useCapability: () => ({ data: false }),
}));

import { MemberName } from './MemberName';

beforeEach(() => {
  hook.mockReset();
  hook.mockReturnValue({
    data: undefined,
    isPending: true,
    isError: false,
    refetch: vi.fn(),
  });
});

it('shows the Nickname and names the Member in its accessible name', () => {
  render(<MemberName memberId="m-1" nickname="Ani" fullName="Ana Pop" />);
  const button = screen.getByRole('button', {
    name: 'Profilul membrului Ani',
  });
  expect(button).toHaveAttribute('type', 'button');
  expect(button).toHaveTextContent('Ani');
  // Without showFullName the full name stays out of the row.
  expect(button).not.toHaveTextContent('Ana Pop');
});

it('falls back to the full name when there is no Nickname', () => {
  const { rerender } = render(
    <MemberName memberId="m-1" nickname={null} fullName="Ana Pop" />,
  );
  expect(
    screen.getByRole('button', { name: 'Profilul membrului Ana Pop' }),
  ).toHaveTextContent('Ana Pop');
  // A blank Nickname is no Nickname.
  rerender(<MemberName memberId="m-1" nickname="  " fullName="Ana Pop" />);
  expect(
    screen.getByRole('button', { name: 'Profilul membrului Ana Pop' }),
  ).toBeVisible();
});

it('adds the full name underneath with showFullName, once', () => {
  const { rerender } = render(
    <MemberName
      memberId="m-1"
      nickname="Ani"
      fullName="Ana Pop"
      showFullName
    />,
  );
  expect(screen.getByRole('button')).toHaveTextContent('AniAna Pop');
  // Without a Nickname the full name is the name: it is not repeated.
  rerender(<MemberName memberId="m-1" fullName="Ana Pop" showFullName />);
  expect(screen.getAllByText('Ana Pop')).toHaveLength(1);
});

it('reads nothing until pressed, then opens the Member Card', async () => {
  render(<MemberName memberId="m-1" nickname="Ani" fullName="Ana Pop" />);
  expect(hook).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button'));
  expect(await screen.findByRole('dialog', { name: 'Ani' })).toBeVisible();
  expect(hook).toHaveBeenCalledWith('m-1');
});

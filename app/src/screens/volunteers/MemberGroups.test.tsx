import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemberGroups } from './MemberGroups';

describe('MemberGroups', () => {
  it('shows a dash and no button when the Member holds no explicit membership', () => {
    const onOpen = vi.fn();
    render(
      <MemberGroups
        primaryGroup={null}
        otherMemberships={0}
        memberName="Ana Ionescu"
        onOpen={onOpen}
      />,
    );
    expect(screen.getByText('—')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the chip alone, in the Group colour, when there is no other membership', () => {
    const onOpen = vi.fn();
    render(
      <MemberGroups
        primaryGroup={{ id: 1, name: 'Educațional', color: '#284C93' }}
        otherMemberships={0}
        memberName="Ana Ionescu"
        onOpen={onOpen}
      />,
    );
    const chip = screen.getByRole('button', {
      name: 'Grupul Educațional. Vezi profilul membrului Ana Ionescu',
    });
    expect(chip).toHaveTextContent('Educațional');
    expect(chip.style.borderColor).toBe('rgb(40, 76, 147)');
    expect(screen.queryByRole('button', { name: /^\+/ })).toBeNull();
  });

  it('adds "+n" for other explicit memberships, both opening the Member Card', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <MemberGroups
        primaryGroup={{ id: 1, name: 'Educațional', color: '#284C93' }}
        otherMemberships={3}
        memberName="Ana Ionescu"
        onOpen={onOpen}
      />,
    );
    const chip = screen.getByRole('button', {
      name: 'Grupul Educațional. Vezi profilul membrului Ana Ionescu',
    });
    const more = screen.getByRole('button', {
      name: '+3 grupuri. Vezi profilul membrului Ana Ionescu',
    });
    expect(more).toHaveTextContent('+3');
    await user.click(chip);
    await user.click(more);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('uses the singular for exactly one other membership', () => {
    render(
      <MemberGroups
        primaryGroup={{ id: 1, name: 'Educațional', color: null }}
        otherMemberships={1}
        memberName="Ana Ionescu"
        onOpen={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', {
        name: '+1 grup. Vezi profilul membrului Ana Ionescu',
      }),
    ).toHaveTextContent('+1');
  });
});

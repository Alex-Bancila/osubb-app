import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest } from '../../queries/approvals';

const state = vi.hoisted(() => ({
  requests: [] as unknown[],
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/approvals', () => ({
  useApprovalRequests: (kind?: string) => ({
    data: (state.requests as { kind: string }[]).filter(
      (request) => !kind || request.kind === kind,
    ),
  }),
}));
vi.mock('../../queries/member-identities', () => ({
  useMemberIdentities: () => ({
    data: new Map([
      [
        'ana',
        {
          memberId: 'ana',
          fullName: 'Ana Pop',
          nickname: null,
          avatarColor: null,
        },
      ],
    ]),
  }),
}));
vi.mock('../../queries/reference', () => ({
  useGroups: () => ({
    data: new Map([
      [1, { id: 1, name: 'OSUBB', is_organization: true }],
      [7, { id: 7, name: 'Educațional', is_organization: false }],
    ]),
  }),
}));
vi.mock('../member/MemberName', () => ({
  MemberName: ({ fullName }: { fullName: string }) => <span>{fullName}</span>,
}));
import { approvalRequestsLabel } from './approval-labels';
import { ApprovalRequestsButton } from './ApprovalRequestsButton';
import { ApprovalRequestsSheet } from './ApprovalRequestsSheet';

const gala: ApprovalRequest = {
  kind: 'event',
  id: 7,
  title: 'Gala',
  groupId: 1,
  createdBy: 'ana',
  createdAt: '2026-10-11T10:00:00Z',
  startsAt: '2026-11-01T18:00:00Z',
};
const burse: ApprovalRequest = {
  kind: 'announcement',
  id: 3,
  title: 'Burse',
  groupId: 7,
  createdBy: 'ana',
  createdAt: '2026-10-11T09:00:00Z',
  startsAt: null,
};

describe('approvalRequestsLabel', () => {
  it('counts the requests in Romanian', () => {
    expect(approvalRequestsLabel(1)).toBe('1 cerere de aprobare');
    expect(approvalRequestsLabel(3)).toBe('3 cereri de aprobare');
    expect(approvalRequestsLabel(21)).toBe('21 de cereri de aprobare');
  });
});

describe('ApprovalRequestsButton', () => {
  it('renders nothing when there is no request of its kind', () => {
    state.requests = [gala];
    const { container } = render(
      <ApprovalRequestsButton kind="announcement" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count of its kind and opens the list of those requests', async () => {
    state.requests = [gala, burse];
    const user = userEvent.setup();
    render(<ApprovalRequestsButton kind="announcement" />);
    const button = screen.getByRole('button', { name: '1 cerere de aprobare' });
    expect(button).toHaveTextContent('1');
    await user.click(button);
    const sheet = await screen.findByRole('dialog', {
      name: 'Cereri de aprobare',
    });
    expect(
      within(sheet).getByRole('button', { name: 'Revizuiește: Burse' }),
    ).toBeVisible();
    expect(within(sheet).queryByText('Gala')).toBeNull();
  });
});

describe('ApprovalRequestsSheet', () => {
  it('lists each request with its author, Group, time and, for an Event, its day, and hands a row over for review', async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    render(
      <ApprovalRequestsSheet
        kind="event"
        requests={[gala]}
        open
        onOpenChange={vi.fn()}
        onReview={onReview}
      />,
    );
    const sheet = screen.getByRole('dialog', { name: 'Cereri de aprobare' });
    expect(sheet).toHaveAccessibleDescription(
      'Evenimentele pentru întreaga OSUBB care așteaptă decizia BC.',
    );
    expect(within(sheet).getByText('Ana Pop')).toBeVisible();
    expect(within(sheet).getByText('OSUBB')).toBeVisible();
    expect(within(sheet).getByText(/cerută/)).toBeVisible();
    expect(within(sheet).getByText(/1 noiembrie/)).toBeVisible();
    await user.click(
      within(sheet).getByRole('button', { name: 'Revizuiește: Gala' }),
    );
    expect(onReview).toHaveBeenCalledWith(gala);
  });
});

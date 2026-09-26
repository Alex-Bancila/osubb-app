import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberIdentity } from '../../components/member/member-identity';
import type { MyProfile } from '../../queries/profile';
import type { RoleHistoryRow } from '../../queries/role-history';
import { RoleTimeline } from './RoleTimeline';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);

const historyMock = vi.hoisted(() => ({
  data: [] as RoleHistoryRow[] | undefined,
  isPending: false,
  isError: false,
}));
vi.mock('../../queries/role-history', () => ({
  useMyRoleHistory: () => historyMock,
}));

const identitiesMock = vi.hoisted(() => ({
  data: undefined as Map<string, MemberIdentity> | undefined,
  lastIds: [] as readonly string[],
}));
vi.mock('../../queries/member-identities', () => ({
  useMemberIdentities: (ids: readonly string[]) => {
    identitiesMock.lastIds = ids;
    return { data: identitiesMock.data };
  },
}));

vi.mock('../../queries/reference', () => ({
  useRoles: () => ({
    data: new Map([
      ['recrut', { name: 'Recrut', level: 0 }],
      ['voluntar', { name: 'Voluntar', level: 1 }],
      ['activ', { name: 'Voluntar Activ', level: 2 }],
    ]),
  }),
}));

const profile: MyProfile = {
  id: 'p1',
  full_name: 'Maria Enache',
  nickname: null,
  role: 'voluntar',
  status: 'activ',
  avatar_color: '#ED2025',
  joined_year: 2025,
  joined_at: '2025-10-01',
  email: 'maria@osubb.ro',
  phone: '0722334455',
};

function items() {
  return within(
    screen.getByRole('list', { name: 'Parcursul organizațional' }),
  ).getAllByRole('listitem');
}

describe('RoleTimeline', () => {
  beforeEach(() => {
    historyMock.data = [];
    historyMock.isPending = false;
    historyMock.isError = false;
    identitiesMock.data = undefined;
    identitiesMock.lastIds = [];
  });

  it('renders nothing while the history loads or when it fails', () => {
    historyMock.isPending = true;
    const pending = render(<RoleTimeline profile={profile} />);
    expect(pending.container).toBeEmptyDOMElement();
    pending.unmount();

    historyMock.isPending = false;
    historyMock.isError = true;
    const failed = render(<RoleTimeline profile={profile} />);
    expect(failed.container).toBeEmptyDOMElement();
  });

  it('with no role_history rows shows one open segment from joined_at', () => {
    render(<RoleTimeline profile={profile} />);

    const [only] = items();
    expect(items()).toHaveLength(1);
    expect(only).toHaveTextContent('Voluntar');
    expect(only).toHaveTextContent('din 1 oct. 2025');
  });

  it('with two changes shows three segments, oldest first, with Romanian durations and who decided', () => {
    historyMock.data = [
      {
        from_role: 'recrut',
        to_role: 'voluntar',
        created_at: '2026-02-01T10:00:00Z',
        actor_kind: 'human',
        changed_by: 'bc-1',
      },
      {
        from_role: 'voluntar',
        to_role: 'activ',
        created_at: '2027-04-01T10:00:00Z',
        actor_kind: 'automatic',
        changed_by: null,
      },
    ];
    identitiesMock.data = new Map([
      ['bc-1', { memberId: 'bc-1', fullName: 'Ioana Pop', nickname: 'Io' }],
    ]);

    render(<RoleTimeline profile={{ ...profile, role: 'activ' }} />);

    const [first, second, third] = items();
    expect(items()).toHaveLength(3);

    expect(first).toHaveTextContent('Recrut');
    expect(first).toHaveTextContent('1 oct. 2025 – 1 feb. 2026 · 4 luni');

    expect(second).toHaveTextContent('Voluntar');
    expect(second).toHaveTextContent(
      '1 feb. 2026 – 1 apr. 2027 · 1 an și 2 luni',
    );
    expect(second).toHaveTextContent('Decis de');
    expect(
      within(second as HTMLElement).getByRole('button', {
        name: 'Profilul membrului Io',
      }),
    ).toBeInTheDocument();

    expect(third).toHaveTextContent('Voluntar Activ');
    expect(third).toHaveTextContent('din 1 apr. 2027');
    expect(third).toHaveTextContent('Schimbare automată');
    expect(third).not.toHaveTextContent('luni');

    // Only the human actor's name is looked up.
    expect(identitiesMock.lastIds).toEqual(['bc-1']);
  });

  it('names the actor generically when the directory does not answer for them', () => {
    historyMock.data = [
      {
        from_role: 'recrut',
        to_role: 'voluntar',
        created_at: '2026-02-01T10:00:00Z',
        actor_kind: 'human',
        changed_by: 'gone',
      },
    ];

    render(<RoleTimeline profile={profile} />);

    expect(items()[1]).toHaveTextContent('Decis de conducere');
  });

  it('a null joined_at shows the current Role and the join year, without durations', () => {
    historyMock.data = [
      {
        from_role: 'recrut',
        to_role: 'voluntar',
        created_at: '2026-02-01T10:00:00Z',
        actor_kind: 'human',
        changed_by: 'bc-1',
      },
    ];

    render(<RoleTimeline profile={{ ...profile, joined_at: null }} />);

    const [only] = items();
    expect(items()).toHaveLength(1);
    // The Role and the join year, nothing else: no dates, no duration, no actor.
    expect(only).toHaveTextContent(/^VoluntarMembru din 2025$/);
  });

  it('shows a Role key the reference does not know as-is', () => {
    render(<RoleTimeline profile={{ ...profile, role: 'responsabil' }} />);

    expect(items()[0]).toHaveTextContent('responsabil');
  });
});

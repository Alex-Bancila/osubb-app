import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { MyProfile } from '../../queries/profile';
import type { RoleHistoryRow } from '../../queries/role-history';
import RoleTimeline from './RoleTimeline';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    session: { user: { id: 'p1' } },
    claims: null,
    loading: false,
    signOut: vi.fn(),
  }),
}));

// -- Role history mock --
const roleHistoryMock = vi.hoisted(() => ({
  data: [] as RoleHistoryRow[],
  isPending: false,
  isError: false,
}));

vi.mock('../../queries/role-history', () => ({
  useMyRoleHistory: () => roleHistoryMock,
}));

// -- Roles mock --
const rolesMap = new Map([
  ['recrut', { name: 'Recrut', level: 0 }],
  ['voluntar', { name: 'Voluntar', level: 1 }],
  ['activ', { name: 'Voluntar Activ', level: 2 }],
  ['vot', { name: 'Membru cu Drept de Vot', level: 3 }],
  ['bce', { name: 'BCE', level: 5 }],
  ['bc', { name: 'BC', level: 6 }],
]);

vi.mock('../../queries/reference', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../queries/reference')>();
  return {
    ...actual,
    useRoles: () => ({
      data: rolesMap,
      isPending: false,
      isError: false,
    }),
  };
});

const baseProfile: MyProfile = {
  id: 'p1',
  full_name: 'Maria Enache',
  role: 'voluntar',
  status: 'activ',
  avatar_color: '#ED2025',
  joined_year: 2025,
  joined_at: '2025-10-01',
  email: 'maria@osubb.ro',
  phone: '0722334455',
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('RoleTimeline', () => {
  beforeEach(() => {
    roleHistoryMock.data = [];
    roleHistoryMock.isPending = false;
    roleHistoryMock.isError = false;
  });

  it('renders nothing while history is pending', () => {
    roleHistoryMock.isPending = true;

    const { container } = render(
      <RoleTimeline profile={baseProfile} />,
      { wrapper },
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing on error', () => {
    roleHistoryMock.isError = true;

    const { container } = render(
      <RoleTimeline profile={baseProfile} />,
      { wrapper },
    );

    expect(container.firstChild).toBeNull();
  });

  it('a Member with no role_history rows sees one open segment in their current Role', () => {
    roleHistoryMock.data = [];

    render(<RoleTimeline profile={baseProfile} />, { wrapper });

     expect(screen.getByTestId('role-timeline-card')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Parcursul organizațional'),
    ).toBeInTheDocument();

    // Should show "Voluntar din ..." (the current role with a start date)
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toMatch(/Voluntar din/);
  });

  it('a Member with two changes sees three segments with Romanian durations', () => {
    roleHistoryMock.data = [
      {
        from_role: 'recrut',
        to_role: 'voluntar',
        created_at: '2026-02-01T10:00:00Z',
      },
      {
        from_role: 'voluntar',
        to_role: 'activ',
        created_at: '2026-06-01T10:00:00Z',
      },
    ];

    render(
      <RoleTimeline profile={{ ...baseProfile, role: 'activ' }} />,
      { wrapper },
    );

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);

    // First segment: Recrut with duration
    expect(items[0]?.textContent).toMatch(/Recrut timp de/);

    // Second segment: Voluntar with duration
    expect(items[1]?.textContent).toMatch(/Voluntar timp de/);

    // Third segment: Voluntar Activ din ...
    expect(items[2]?.textContent).toMatch(/Voluntar Activ din/);
  });

  it('a null joined_at degrades to the current Role only, no dates', () => {
    roleHistoryMock.data = [];

    render(
      <RoleTimeline profile={{ ...baseProfile, joined_at: null }} />,
      { wrapper },
    );

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    // No "din" — just the role name
    expect(items[0]?.textContent).toBe('Voluntar');
  });

  it('resolves role display names from useRoles()', () => {
    roleHistoryMock.data = [
      {
        from_role: 'recrut',
        to_role: 'activ',
        created_at: '2026-03-01T10:00:00Z',
      },
    ];

    render(
      <RoleTimeline profile={{ ...baseProfile, role: 'activ' }} />,
      { wrapper },
    );

    const items = screen.getAllByRole('listitem');
    // Should use "Recrut" and "Voluntar Activ" — the display names, not the enum values
    expect(items[0]?.textContent).toMatch(/Recrut/);
    expect(items[1]?.textContent).toMatch(/Voluntar Activ/);
  });
});

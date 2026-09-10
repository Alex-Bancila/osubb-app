import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('../../lib/auth', () => ({ useAuth: auth.useAuth }));
vi.mock('../../queries/profile', () => ({
  useMyProfile: () => ({
    data: { full_name: 'Ioana Popescu', role: 'voluntar', tier: null },
  }),
}));
vi.mock('../../queries/reference', () => ({
  useRoles: () => ({ data: new Map() }),
  useDepartments: () => ({ data: new Map() }),
}));
vi.mock('../../queries/points', () => ({
  useMyPoints: () => ({ isPending: false, isError: false, data: 12 }),
  useMyStanding: () => ({
    isPending: false,
    isError: false,
    data: { rank: 4, total: 8, next: { rank: 3, gap: 3 } },
  }),
  useLeaderboard: () => ({ isPending: false, isError: false, data: [] }),
  useDeptCup: () => ({ isPending: false, isError: false, data: [] }),
}));
vi.mock('@ionic/react', () => ({
  IonPage: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IonContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IonIcon: () => null,
}));

import DashboardScreen from './DashboardScreen';

function claims(level: number) {
  return {
    claims: {
      member_role: 'x',
      member_level: level,
      dept_ids: [],
      team_ids: [],
    },
    session: { user: { id: 'm' } },
    loading: false,
    signOut: vi.fn(),
  };
}

describe('DashboardScreen leadership gate', () => {
  it('hides leaderboard, cup and rank for a level-1 member', () => {
    auth.useAuth.mockReturnValue(claims(1));
    render(<DashboardScreen />);
    expect(screen.getByText(/12/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /clasament/i })).toBeNull();
    expect(screen.queryByText(/din 8 membri/)).toBeNull();
    expect(
      screen.getByText(/Cupa Departamentelor sunt vizibile pentru BCE și BC/i),
    ).toBeInTheDocument();
  });

  it('shows everything for a level-5 member', () => {
    auth.useAuth.mockReturnValue(claims(5));
    render(<DashboardScreen />);
    expect(screen.getByText(/din 8 membri/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /clasament/i }),
    ).toBeInTheDocument();
  });
});

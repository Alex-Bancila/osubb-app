import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('../../lib/auth', () => ({ useAuth: auth.useAuth }));
/* `see_leadership` from the server capability row (`my_capabilities()`). */
const leadership = vi.hoisted(() => ({
  capability: vi.fn(),
  result: { data: false } as { data?: boolean; isPending?: boolean },
}));
vi.mock('../../lib/capabilities', () => ({
  useCapability: (name: string) => {
    leadership.capability(name);
    return leadership.result;
  },
}));
vi.mock('../../queries/profile', () => ({
  useMyProfile: () => ({
    data: { full_name: 'Ioana Popescu', role: 'voluntar' },
  }),
}));
vi.mock('../../queries/reference', () => ({
  useRoles: () => ({ data: new Map() }),
  useGroups: () => ({ data: new Map() }),
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
      group_ids: [],
    },
    session: { user: { id: 'm' } },
    loading: false,
    signOut: vi.fn(),
  };
}

// The "12 puncte" hero figure: the number is a direct text node of
// .hero-value, "puncte" is a nested <span>. Reading it this way scopes the
// assertion to the hero card and to the number alone, so it can never
// collide with the page date rendered elsewhere on the screen.
function heroPointsValue(container: HTMLElement): string {
  const el = container.querySelector('.hero-value');
  if (!el) throw new Error('.hero-value not found');
  const digits = Array.from(el.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join('')
    .trim();
  return digits;
}

describe('DashboardScreen leadership gate', () => {
  beforeEach(() => {
    // DashboardScreen renders formatLongDate(new Date()) inline (the page
    // date under the greeting). On the 12th of any month that produces a
    // Romanian date like "joi, 12 septembrie 2026", which also matches a
    // loose /12/ points assertion — getByText then throws on multiple
    // matches for a reason that has nothing to do with what this test
    // covers. Freeze the clock to a date with no "12" in it so the outcome
    // never depends on today's date.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides leaderboard, cup and rank without the see_leadership capability', () => {
    auth.useAuth.mockReturnValue(claims(1));
    leadership.result = { data: false };
    const { container } = render(<DashboardScreen />);
    // Scoped to the hero points value and anchored to "puncte" so it cannot
    // collide with the page date (or any date) even without the freeze
    // above — belt and suspenders. getByText's default node-text extraction
    // only looks at an element's own direct text nodes, so a bare /12/ or
    // /12\s*puncte/ against the whole document would either match "12" and
    // the date in the same render (the bug this guards against) or match
    // nothing at all, since "puncte" sits in a nested <span>.
    expect(heroPointsValue(container)).toMatch(/^12$/);
    expect(screen.queryByRole('heading', { name: /clasament/i })).toBeNull();
    expect(screen.queryByText(/din 8 membri/)).toBeNull();
    expect(
      screen.getByText(/Cupa Departamentelor sunt vizibile pentru BCE și BC/i),
    ).toBeInTheDocument();
    expect(leadership.capability).toHaveBeenCalledWith('seeLeadership');
  });

  it('hides leaderboard, cup and rank while the capability row is loading', () => {
    // The threshold lives on the server now (see_leadership = level >= 5,
    // pinned by my_capabilities.test.sql); the screen must not guess from the
    // token's level while the row is on its way.
    auth.useAuth.mockReturnValue(claims(5));
    leadership.result = { isPending: true, data: undefined };
    const { container } = render(<DashboardScreen />);
    expect(heroPointsValue(container)).toMatch(/^12$/);
    expect(screen.queryByRole('heading', { name: /clasament/i })).toBeNull();
    expect(screen.queryByText(/din 8 membri/)).toBeNull();
  });

  it('shows everything with the see_leadership capability', () => {
    auth.useAuth.mockReturnValue(claims(5));
    leadership.result = { data: true };
    render(<DashboardScreen />);
    expect(screen.getByText(/din 8 membri/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /clasament/i }),
    ).toBeInTheDocument();
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberClaims } from '../../lib/auth';
import type { PromotionProgress as Progress } from '../../queries/promotion-progress';
import { PromotionProgress } from './PromotionProgress';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

const state = vi.hoisted(() => ({
  claims: null as MemberClaims | null,
  role: 'voluntar',
  joinedAt: '2026-03-25' as string | null,
  progress: {
    data: undefined as Progress | undefined,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  enabled: [] as boolean[],
}));

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ claims: state.claims, session: { user: { id: 'm1' } } }),
}));

vi.mock('../../queries/profile', () => ({
  useMyProfile: () => ({
    data: { id: 'm1', role: state.role, joined_at: state.joinedAt },
  }),
}));

vi.mock('../../queries/reference', () => ({
  useRoles: () => ({
    data: new Map([
      ['recrut', { name: 'Recrut', level: 0 }],
      ['voluntar', { name: 'Voluntar', level: 1 }],
      ['activ', { name: 'Voluntar Activ', level: 2 }],
      ['vot', { name: 'Voluntar cu Drept de Vot', level: 3 }],
      ['bce', { name: 'BCE', level: 5 }],
      ['bc', { name: 'BC', level: 6 }],
    ]),
  }),
}));

vi.mock('../../queries/promotion-progress', () => ({
  usePromotionProgress: ({ enabled }: { enabled: boolean }) => {
    state.enabled.push(enabled);
    return state.progress;
  },
}));

const LEVELS: Record<string, number> = {
  recrut: 0,
  voluntar: 1,
  activ: 2,
  vot: 3,
  bce: 5,
  bc: 6,
};

/** Joined 25 March 2026; both rules demand 6 months, so tenure is 25 September 2026. */
function progress(overrides: Partial<Progress> = {}): Progress {
  return {
    openPeriod: { id: 7, name: 'Semestrul I 2026–2027' },
    voluntarTenureMonths: 6,
    activTenureMonths: 6,
    threshold: 30,
    periodPoints: 12,
    ...overrides,
  };
}

function setup(
  role: string,
  data: Progress = progress(),
  { today = new Date(2026, 8, 25, 9, 0) } = {},
) {
  state.role = role;
  state.claims = {
    member_role: role,
    member_level: LEVELS[role] ?? 0,
    group_ids: [],
  };
  state.progress.data = data;
  vi.setSystemTime(today);
  return render(<PromotionProgress />);
}

const DAY_BEFORE_TENURE = new Date(2026, 8, 24, 23, 59);
const DAY_OF_TENURE = new Date(2026, 8, 25, 0, 1);

describe('PromotionProgress (#634)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    state.joinedAt = '2026-03-25';
    state.progress.isError = false;
    state.progress.error = null;
    state.progress.refetch.mockClear();
    state.enabled = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Recrut', () => {
    it('shows the date the tenure rule makes them Voluntar, and no bar', () => {
      setup('recrut', progress(), { today: DAY_BEFORE_TENURE });

      expect(
        screen.getByText('Devii Voluntar din 25 septembrie 2026'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.queryByText(/pragul/i)).not.toBeInTheDocument();
    });

    it('clamps a join on the 31st to the last day of the target month', () => {
      state.joinedAt = '2026-08-31';
      setup('recrut');

      expect(
        screen.getByText('Devii Voluntar din 28 februarie 2027'),
      ).toBeInTheDocument();
    });

    it('keeps the tenure line when no Period is open', () => {
      setup('recrut', progress({ openPeriod: null, periodPoints: null }));

      expect(
        screen.getByText('Devii Voluntar din 25 septembrie 2026'),
      ).toBeInTheDocument();
    });
  });

  describe('Voluntar', () => {
    it('the day before the tenure date: the eligibility date and nothing about points', () => {
      setup('voluntar', progress(), { today: DAY_BEFORE_TENURE });

      expect(
        screen.getByText('Poți deveni Voluntar Activ din 25 septembrie 2026'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.queryByText(/punct/i)).not.toBeInTheDocument();
      expect(screen.queryByText('12')).not.toBeInTheDocument();
    });

    it('the day of the tenure date: a bar from 0 to the stored threshold', () => {
      setup('voluntar', progress(), { today: DAY_OF_TENURE });

      const bar = screen.getByRole('progressbar', {
        name: 'Progres spre Voluntar Activ',
      });
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuemax', '30');
      expect(bar).toHaveAttribute('aria-valuenow', '12');
      expect(bar).toHaveAttribute('aria-valuetext', '12 din 30 de puncte');
      expect(
        screen.getByText('Mai ai 18 puncte până la Voluntar Activ'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/poți deveni voluntar activ/i),
      ).not.toBeInTheDocument();
    });

    it('one point short says "1 punct"', () => {
      setup('voluntar', progress({ periodPoints: 29 }));

      expect(
        screen.getByText('Mai ai 1 punct până la Voluntar Activ'),
      ).toBeInTheDocument();
    });

    it('exactly at the threshold: past it, the role follows automatically', () => {
      setup('voluntar', progress({ periodPoints: 30 }));

      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '30',
      );
      expect(
        screen.getByText('Ai depășit pragul — rolul se acordă automat'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/mai ai/i)).not.toBeInTheDocument();
    });

    it('above the threshold the bar stays full', () => {
      setup('voluntar', progress({ periodPoints: 45 }));

      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '30',
      );
      expect(
        screen.getByText('Ai depășit pragul — rolul se acordă automat'),
      ).toBeInTheDocument();
    });

    it('a threshold of 0 or below makes the bar full or empty, never NaN', () => {
      setup('voluntar', progress({ threshold: 0, periodPoints: 0 }));

      const full = screen.getByRole('progressbar');
      expect(full).toHaveAttribute('aria-valuemax', '1');
      expect(full).toHaveAttribute('aria-valuenow', '1');
      expect(
        screen.getByText('Ai depășit pragul — rolul se acordă automat'),
      ).toBeInTheDocument();
      cleanup();

      setup('voluntar', progress({ threshold: -2, periodPoints: -5 }));

      const empty = screen.getByRole('progressbar');
      expect(empty).toHaveAttribute('aria-valuemax', '1');
      expect(empty).toHaveAttribute('aria-valuenow', '0');
      expect(
        screen.getByText('Mai ai 3 puncte până la Voluntar Activ'),
      ).toBeInTheDocument();
    });

    it('twenty or more points take "de"', () => {
      setup('voluntar', progress({ threshold: 40, periodPoints: 5 }));

      expect(
        screen.getByText('Mai ai 35 de puncte până la Voluntar Activ'),
      ).toBeInTheDocument();
    });

    it('no open Period: the tenure line only, the bar hidden', () => {
      setup('voluntar', progress({ openPeriod: null, periodPoints: null }));

      expect(
        screen.getByText('Poți deveni Voluntar Activ din 25 septembrie 2026'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.queryByText(/mai ai|pragul/i)).not.toBeInTheDocument();
    });

    it('no threshold in force: the bar is hidden, never faked', () => {
      setup('voluntar', progress({ threshold: null }));

      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(
        screen.getByText('Poți deveni Voluntar Activ din 25 septembrie 2026'),
      ).toBeInTheDocument();
    });
  });

  describe.each([
    ['activ', 'Voluntar Activ'],
    ['vot', 'Voluntar cu Drept de Vot'],
  ])('%s', (role) => {
    it('shows Period points beside the semester threshold, no bar', () => {
      setup(role);

      expect(screen.getByText('12')).toBeInTheDocument();
      expect(
        screen.getByText('puncte în Semestrul I 2026–2027'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Pragul semestrului: 30 de puncte'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.queryByText(/mai ai|depășit/i)).not.toBeInTheDocument();
    });

    it('no open Period: nothing to show', () => {
      const { container } = setup(
        role,
        progress({ openPeriod: null, periodPoints: null }),
      );

      expect(container).toBeEmptyDOMElement();
    });
  });

  it.each(['bce', 'bc'])(
    'level >= 5 (%s): the block is absent and nothing is fetched',
    (role) => {
      const { container } = setup(role);

      expect(container).toBeEmptyDOMElement();
      expect(
        screen.queryByTestId('promotion-progress'),
      ).not.toBeInTheDocument();
      expect(state.enabled.every((enabled) => !enabled)).toBe(true);
    },
  );

  it('a level >= 5 claim hides the block even on a ladder role', () => {
    state.role = 'activ';
    state.claims = { member_role: 'activ', member_level: 5, group_ids: [] };
    state.progress.data = progress();
    const { container } = render(<PromotionProgress />);

    expect(container).toBeEmptyDOMElement();
  });

  it('a failed read offers a retry', () => {
    state.progress.isError = true;
    state.progress.error = new Error('boom');
    setup('voluntar');

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

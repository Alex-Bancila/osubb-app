import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberClaims } from '../../lib/auth';
import type { PromotionProgress as Progress } from '../../queries/promotion-progress';
import { PromotionPanel, PromotionProgress } from './PromotionProgress';

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
  /** The Points Start Date (R58): null until BC sets one. */
  startDate: null as string | null | undefined,
  enabled: [] as boolean[],
  roles: [] as (string | undefined)[],
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

// R58: the Points Start Date is a settings read; the test hands it over.
vi.mock('../../queries/evaluation-settings', () => ({
  usePointsStartDate: () => state.startDate,
}));

// The read is the hook's to fake; `membershipCutoffState` is the real rule (R58).
vi.mock('../../queries/promotion-progress', async (importActual) => ({
  ...(await importActual<typeof import('../../queries/promotion-progress')>()),
  usePromotionProgress: ({
    enabled,
    role,
  }: {
    enabled: boolean;
    role: string | undefined;
  }) => {
    state.enabled.push(enabled);
    state.roles.push(role);
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

/**
 * Joined 25 March 2026; the Membership Cutoff Date (R58) is 31 March 2026, so a
 * Voluntar joined by it is open to Voluntar Activ.
 */
function progress(overrides: Partial<Progress> = {}): Progress {
  return {
    since: '2026-07-01',
    membershipCutoff: '2026-03-31',
    threshold: 30,
    points: 12,
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

describe('PromotionProgress (#634)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    state.joinedAt = '2026-03-25';
    state.progress.isError = false;
    state.progress.error = null;
    state.progress.refetch.mockClear();
    state.enabled = [];
    state.roles = [];
    state.startDate = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // R58: nothing promotes a Recrut by the calendar any more; BC does it by
  // hand in Roluri, so Profil promises no date and no line.
  describe('Recrut', () => {
    it('promises nothing: no cutoff line, no date, no bar', () => {
      const { container } = setup('recrut');

      expect(container).toBeEmptyDOMElement();
      expect(document.body.textContent).not.toMatch(/devii voluntar/i);
    });

    it('promises nothing either way a threshold stands', () => {
      const { container } = setup('recrut', progress({ threshold: null }));

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('Voluntar and the Membership Cutoff Date (R58)', () => {
    it('joined after the cutoff: the day they must have joined by, nothing about points', () => {
      state.joinedAt = '2026-04-02';
      setup('voluntar');

      expect(
        screen.getByText(
          'Pentru a deveni candidat la Voluntar Activ trebuie să fi intrat în OSUBB până la 31.03.2026.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.getByTestId('promotion-progress')).not.toHaveTextContent(
        /punct|12/i,
      );
    });

    it('joined on the cutoff day itself: the bar is open', () => {
      state.joinedAt = '2026-03-31';
      setup('voluntar');

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('the day after the cutoff is already too late', () => {
      state.joinedAt = '2026-04-01';
      setup('voluntar');

      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(
        screen.getByText(/trebuie să fi intrat în OSUBB/),
      ).toBeInTheDocument();
    });

    it('no cutoff set yet: nobody is listed, so nothing is promised', () => {
      const { container } = setup(
        'voluntar',
        progress({ membershipCutoff: null }),
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('a Voluntar with no join date cannot be listed either', () => {
      state.joinedAt = null;
      setup('voluntar');

      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(
        screen.getByText(/trebuie să fi intrat în OSUBB/),
      ).toBeInTheDocument();
    });

    it('never speaks of months of vechime', () => {
      state.joinedAt = '2026-04-02';
      setup('voluntar');

      expect(document.body.textContent).not.toMatch(/vechime|luni/i);
    });
  });

  describe('Voluntar', () => {
    it('joined by the cutoff: a bar from 0 to the stored threshold', () => {
      setup('voluntar');

      const bar = screen.getByRole('progressbar', {
        name: 'Progres spre pragul Voluntar Activ',
      });
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuemax', '30');
      expect(bar).toHaveAttribute('aria-valuenow', '12');
      expect(bar).toHaveAttribute('aria-valuetext', '12 din 30 de puncte');
      expect(
        screen.getByText('din 01.07.2026 (după ultima evaluare)'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Mai ai 18 puncte până la pragul Voluntar Activ'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/trebuie să fi intrat în OSUBB/),
      ).not.toBeInTheDocument();
    });

    // F-6 (#893): `since` is the day AFTER the last range, so a Role
    // Evaluation ending today makes it tomorrow. It was printed as the
    // evaluation's own date ("de la ultima evaluare (30 septembrie 2026)")
    // over a "0 / 30" that read as points lost.
    it('after a Role Evaluation ending today: when the count starts, no "0 / 30"', () => {
      setup('voluntar', progress({ since: '2026-09-30', points: 0 }), {
        today: new Date(2026, 8, 29, 18, 0),
      });

      expect(screen.getByTestId('count-starts')).toHaveTextContent(
        'Punctele pentru următoarea evaluare se numără din 30.09.2026.',
      );
      expect(
        screen.getByText('Pragul în vigoare: 30 de puncte'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.queryByText(/0 \/ 30/)).not.toBeInTheDocument();
      expect(
        screen.queryByText(/de la ultima evaluare/),
      ).not.toBeInTheDocument();
    });

    it('on the day the count starts, the bar is back', () => {
      setup('voluntar', progress({ since: '2026-09-30', points: 0 }), {
        today: new Date(2026, 8, 30, 0, 1),
      });

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
      expect(
        screen.getByText('din 30.09.2026 (după ultima evaluare)'),
      ).toBeInTheDocument();
    });

    it('one point short says "1 punct"', () => {
      setup('voluntar', progress({ points: 29 }));

      expect(
        screen.getByText('Mai ai 1 punct până la pragul Voluntar Activ'),
      ).toBeInTheDocument();
    });

    it('exactly at the threshold: past it, a Promotion Candidate at once; BC decides', () => {
      setup('voluntar', progress({ points: 30 }));

      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '30',
      );
      expect(
        screen.getByText(
          'Ai depășit pragul — ești candidat la promovare; BC decide',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/mai ai/i)).not.toBeInTheDocument();
    });

    it('above the threshold the bar stays full', () => {
      setup('voluntar', progress({ points: 45 }));

      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '30',
      );
      expect(
        screen.getByText(
          'Ai depășit pragul — ești candidat la promovare; BC decide',
        ),
      ).toBeInTheDocument();
    });

    it('a threshold of 0 or below makes the bar full or empty, never NaN', () => {
      setup('voluntar', progress({ threshold: 0, points: 0 }));

      const full = screen.getByRole('progressbar');
      expect(full).toHaveAttribute('aria-valuemax', '1');
      expect(full).toHaveAttribute('aria-valuenow', '1');
      expect(
        screen.getByText(
          'Ai depășit pragul — ești candidat la promovare; BC decide',
        ),
      ).toBeInTheDocument();
      cleanup();

      setup('voluntar', progress({ threshold: -2, points: -5 }));

      const empty = screen.getByRole('progressbar');
      expect(empty).toHaveAttribute('aria-valuemax', '1');
      expect(empty).toHaveAttribute('aria-valuenow', '0');
      expect(
        screen.getByText('Mai ai 3 puncte până la pragul Voluntar Activ'),
      ).toBeInTheDocument();
    });

    it('twenty or more points take "de"', () => {
      setup('voluntar', progress({ threshold: 40, points: 5 }));

      expect(
        screen.getByText('Mai ai 35 de puncte până la pragul Voluntar Activ'),
      ).toBeInTheDocument();
    });

    it('no threshold in force: the cutoff line only, nothing about the threshold', () => {
      setup('voluntar', progress({ threshold: null }));

      expect(
        screen.getByText(
          'Ai intrat în OSUBB până la 31.03.2026: poți deveni candidat la Voluntar Activ.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.queryByText(/mai ai|pragul/i)).not.toBeInTheDocument();
    });

    it('no threshold in force: the bar is hidden, never faked', () => {
      setup('voluntar', progress({ threshold: null }));

      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(
        screen.getByText(
          'Ai intrat în OSUBB până la 31.03.2026: poți deveni candidat la Voluntar Activ.',
        ),
      ).toBeInTheDocument();
    });
  });

  describe.each([
    ['activ', 'Voluntar Activ'],
    ['vot', 'Voluntar cu Drept de Vot'],
  ])('%s', (role) => {
    it('shows points since the last Role Evaluation beside the threshold, no bar', () => {
      setup(role);

      expect(screen.getByText('12')).toBeInTheDocument();
      expect(
        screen.getByText('puncte din 01.07.2026 (după ultima evaluare)'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Pragul în vigoare: 30 de puncte'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Punctaj' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.queryByText(/mai ai|depășit/i)).not.toBeInTheDocument();
    });

    it('after a Role Evaluation ending today: when the count starts, not "0 puncte"', () => {
      setup(role, progress({ since: '2026-09-30', points: 0 }), {
        today: new Date(2026, 8, 29, 18, 0),
      });

      expect(screen.getByTestId('count-starts')).toHaveTextContent(
        'Punctele pentru următoarea evaluare se numără din 30.09.2026.',
      );
      expect(
        screen.getByText('Pragul în vigoare: 30 de puncte'),
      ).toBeInTheDocument();
      expect(screen.queryByText('0')).not.toBeInTheDocument();
    });

    it('before any Role Evaluation the figure is the total, never "în total"', () => {
      setup(role, progress({ since: null }));

      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('puncte')).toBeInTheDocument();
      expect(
        screen.queryByText(/în total|ultima evaluare/),
      ).not.toBeInTheDocument();
    });

    it('no threshold in force: nothing to show', () => {
      const { container } = setup(role, progress({ threshold: null }));

      expect(container).toBeEmptyDOMElement();
    });
  });

  // #828 (R28): the standing is read for the Member's own Role, which picks
  // the kind (roleEvaluationKindFor: vot -> adunarea_generala), and no state
  // promises a Role granted automatically.
  it.each([
    ['recrut', progress()],
    ['voluntar', progress({ points: 45 })],
    ['activ', progress()],
    ['vot', progress()],
  ])(
    '%s: asks for the standing of its own Role and never says "automat"',
    (role, data) => {
      setup(role, data);

      expect(state.roles.at(-1)).toBe(role);
      expect(document.body.textContent).not.toMatch(/automat/i);
    },
  );

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

// #859 (B38): Profil's one points panel carries the total, once.
describe('PromotionPanel with the total', () => {
  beforeEach(() => {
    state.startDate = null;
  });
  afterEach(cleanup);

  it('after a Role Evaluation: the total leads, the bar says when its count started', () => {
    render(
      <PromotionPanel
        state={{
          kind: 'view',
          view: {
            kind: 'bar',
            points: 5,
            threshold: 30,
            since: '01.07.2026',
            sinceIso: '2026-07-01',
          },
        }}
        totalPoints={20}
      />,
    );

    expect(screen.getByTestId('points-total')).toHaveTextContent('20de puncte');
    expect(
      screen.getByText('din 01.07.2026 (după ultima evaluare)'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/în total/)).not.toBeInTheDocument();
  });

  it("before any Role Evaluation the bar's figure is the total, so it is not printed twice", () => {
    render(
      <PromotionPanel
        state={{
          kind: 'view',
          view: {
            kind: 'bar',
            points: 12,
            threshold: 30,
            since: null,
            sinceIso: null,
          },
        }}
        totalPoints={12}
      />,
    );

    expect(screen.queryByTestId('points-total')).not.toBeInTheDocument();
    expect(screen.getByText('12 / 30 de puncte')).toBeInTheDocument();
    expect(screen.queryByText(/în total/)).not.toBeInTheDocument();
  });

  it('a cutoff line still shows the total above it', () => {
    render(
      <PromotionPanel
        state={{
          kind: 'view',
          view: {
            kind: 'cutoff',
            text: 'Pentru a deveni candidat la Voluntar Activ trebuie să fi intrat în OSUBB până la 31.03.2026.',
            state: {
              cutoff: '2026-03-31',
              joinedAt: '2026-04-02',
              met: false,
            },
          },
        }}
        totalPoints={1}
      />,
    );

    expect(screen.getByTestId('points-total')).toHaveTextContent('1punct');
    expect(
      screen.getByRole('heading', { name: 'Punctaj și promovare' }),
    ).toBeInTheDocument();
  });
});

// R58: from when the total counts, once BC has set a Points Start Date.
describe('the Points Start Date beside the total', () => {
  beforeEach(() => {
    state.startDate = null;
  });
  afterEach(cleanup);

  const afterEvaluation = {
    kind: 'view',
    view: {
      kind: 'bar',
      points: 5,
      threshold: 30,
      since: '01.07.2026',
      sinceIso: '2026-07-01',
    },
  } as const;

  it('PointsTotal says from when under the number', () => {
    state.startDate = '2026-09-01';
    render(<PromotionPanel state={afterEvaluation} totalPoints={20} />);

    expect(screen.getByTestId('points-total')).toHaveTextContent('20de puncte');
    expect(screen.getByTestId('points-since')).toHaveTextContent(
      /^din 01\.09\.2026$/,
    );
    // Under the number, not beside it.
    expect(
      screen
        .getByTestId('points-total')
        .compareDocumentPosition(screen.getByTestId('points-since')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId('points-total')).not.toHaveTextContent('din');
  });

  it.each([null, undefined])(
    'says nothing while the date is %s',
    (startDate) => {
      state.startDate = startDate;
      render(<PromotionPanel state={afterEvaluation} totalPoints={20} />);

      expect(screen.getByTestId('points-total')).toBeInTheDocument();
      expect(screen.queryByTestId('points-since')).not.toBeInTheDocument();
    },
  );

  // Ruling 17: the standing's figure (`my_role_evaluation_standing`) is not
  // floored in PR 2, so with a date set it is never taken for the total.
  const barBeforeAnyEvaluation = {
    kind: 'view',
    view: {
      kind: 'bar',
      points: 12,
      threshold: 30,
      since: null,
      sinceIso: null,
    },
  } as const;
  const referenceBeforeAnyEvaluation = {
    kind: 'view',
    view: {
      kind: 'reference',
      points: 12,
      threshold: 30,
      since: null,
      sinceIso: null,
      startsLater: false,
    },
  } as const;

  it('with a date, the floored total leads with its din line and the bar keeps its own figure unlabelled', () => {
    state.startDate = '2026-09-01';
    render(<PromotionPanel state={barBeforeAnyEvaluation} totalPoints={20} />);

    expect(screen.getByTestId('points-total')).toHaveTextContent('20de puncte');
    expect(screen.getByTestId('points-since').textContent).toBe(
      'din 01.09.2026',
    );
    // The all-time figure, with no period beside it: the one `din` is the
    // total's.
    const figure = screen.getByText('12 / 30 de puncte');
    expect(figure.parentElement).not.toHaveTextContent('din');
    expect(screen.getByTestId('promotion-progress').textContent).toMatch(
      /^20de puncte/,
    );
    expect(
      screen.getByTestId('promotion-progress').textContent?.split('din'),
    ).toHaveLength(2);
  });

  it('with a date, the floored total leads and the reference keeps its own figure unlabelled', () => {
    state.startDate = '2026-09-01';
    render(
      <PromotionPanel state={referenceBeforeAnyEvaluation} totalPoints={20} />,
    );

    expect(screen.getByTestId('points-total')).toHaveTextContent('20de puncte');
    expect(screen.getByTestId('points-since').textContent).toBe(
      'din 01.09.2026',
    );
    // The reference's own figure and word, with no period beside them.
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('puncte')).toBeInTheDocument();
    expect(
      screen.getByTestId('promotion-progress').textContent?.split('din'),
    ).toHaveLength(2);
  });

  it('with no date set, the bar figure is still the total and prints no period', () => {
    state.startDate = null;
    render(<PromotionPanel state={barBeforeAnyEvaluation} totalPoints={12} />);

    expect(screen.queryByTestId('points-total')).not.toBeInTheDocument();
    expect(screen.queryByTestId('points-since')).not.toBeInTheDocument();
    expect(screen.getByText('12 / 30 de puncte')).toBeInTheDocument();
  });

  it('with no date set, the reference figure is still the total', () => {
    state.startDate = null;
    render(
      <PromotionPanel state={referenceBeforeAnyEvaluation} totalPoints={12} />,
    );

    expect(screen.queryByTestId('points-total')).not.toBeInTheDocument();
    expect(screen.getByText('puncte')).toBeInTheDocument();
  });

  // Unknown is not "none": while the settings load (or failed to read) the
  // floored total is shown, without a din line, rather than the unfloored
  // standing as if it were the total, and nothing jumps when the date arrives.
  it('while the date is unknown, the floored total leads on the bar view without a period', () => {
    state.startDate = undefined;
    render(<PromotionPanel state={barBeforeAnyEvaluation} totalPoints={20} />);

    expect(screen.getByTestId('points-total')).toHaveTextContent('20de puncte');
    expect(screen.queryByTestId('points-since')).not.toBeInTheDocument();
    expect(screen.getByText('12 / 30 de puncte')).toBeInTheDocument();
    expect(screen.getByTestId('promotion-progress').textContent).not.toContain(
      'din',
    );
  });

  it('while the date is unknown, the floored total leads on the reference view without a period', () => {
    state.startDate = undefined;
    render(
      <PromotionPanel state={referenceBeforeAnyEvaluation} totalPoints={20} />,
    );

    expect(screen.getByTestId('points-total')).toHaveTextContent('20de puncte');
    expect(screen.queryByTestId('points-since')).not.toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByTestId('promotion-progress').textContent).not.toContain(
      'din',
    );
  });
});

// Ruling 17 (R58): the standing's window opens on the later of the day after
// the last run and the Points Start Date. "după ultima evaluare" says the run
// opened it; when the start date did, the day stands alone, and while the
// date is unknown nothing is claimed about which one it was.
describe('the label of the figure’s window (ruling 17)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    state.progress.isError = false;
    state.progress.error = null;
    state.joinedAt = '2026-03-25';
    state.startDate = null;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  const today = { today: new Date(2026, 9, 20, 9, 0) };

  it('a Voluntar whose window the start date opened reads the day alone', () => {
    state.startDate = '2026-10-01';
    setup('voluntar', progress({ since: '2026-10-01', points: 5 }), today);

    expect(screen.getByText('din 01.10.2026')).toBeInTheDocument();
    expect(screen.queryByText(/după ultima evaluare/)).not.toBeInTheDocument();
  });

  it('a Voluntar whose window a run opened keeps "după ultima evaluare"', () => {
    state.startDate = '2026-10-01';
    setup('voluntar', progress({ since: '2026-10-05', points: 5 }), today);

    expect(
      screen.getByText('din 05.10.2026 (după ultima evaluare)'),
    ).toBeInTheDocument();
  });

  it('with no start date set, the run opened it', () => {
    state.startDate = null;
    setup('voluntar', progress({ since: '2026-07-01' }), today);

    expect(
      screen.getByText('din 01.07.2026 (după ultima evaluare)'),
    ).toBeInTheDocument();
  });

  it('claims no event while the start date is unknown', () => {
    state.startDate = undefined;
    setup('voluntar', progress({ since: '2026-07-01' }), today);

    expect(screen.getByText('din 01.07.2026')).toBeInTheDocument();
    expect(screen.queryByText(/după ultima evaluare/)).not.toBeInTheDocument();
  });

  it.each(['activ', 'vot'])(
    'the reference of a %s reads the same way',
    (role) => {
      state.startDate = '2026-10-01';
      setup(role, progress({ since: '2026-10-01', points: 5 }), today);
      expect(screen.getByText('puncte din 01.10.2026')).toBeInTheDocument();
      expect(
        screen.queryByText(/după ultima evaluare/),
      ).not.toBeInTheDocument();
      cleanup();

      setup(role, progress({ since: '2026-10-05', points: 5 }), today);
      expect(
        screen.getByText('puncte din 05.10.2026 (după ultima evaluare)'),
      ).toBeInTheDocument();
    },
  );

  it('a start date set on the day of the run’s end names the start date', () => {
    // Both opened the window on the same day: the start date is what the
    // figure is judged by, and the day stands alone.
    state.startDate = '2026-10-01';
    setup('activ', progress({ since: '2026-10-01' }), today);

    expect(screen.queryByText(/după ultima evaluare/)).not.toBeInTheDocument();
  });

  // The hero figure is single: the total leads once the settings say there is
  // a start date, or while they are unknown; otherwise the standing's own
  // figure is the total and leads itself.
  it.each([
    ['no start date set', null, null],
    ['the start date unknown', undefined, null],
    ['a start date set', '2026-10-01', '2026-10-01'],
  ])(
    'prints one big figure on the reference view with %s',
    (_case, startDate, sinceIso) => {
      state.startDate = startDate;
      const { container } = render(
        <PromotionPanel
          state={{
            kind: 'view',
            view: {
              kind: 'reference',
              points: 12,
              threshold: 30,
              since: sinceIso ? '01.10.2026' : null,
              sinceIso,
              startsLater: false,
            },
          }}
          totalPoints={20}
        />,
      );

      expect(container.querySelectorAll('[class*="fs-2xl"]')).toHaveLength(1);
    },
  );
});

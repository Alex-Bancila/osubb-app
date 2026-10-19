import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  db,
  resetDb,
  RUN_VA,
  show,
  type Candidate,
} from '../../../test/portofoliu-fake';
import { useRoleEvaluationCommand } from '../../../queries/role-evaluations';

// #1012 (R37): opening a thing reads its Notifications. The hook is observed
// here; its own behaviour is covered in queries/notifications-read.test.tsx.
const readNotificationsAbout = vi.hoisted(() => vi.fn());
vi.mock('../../../queries/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../queries/notifications')>()),
  useReadNotificationsAbout: readNotificationsAbout,
}));
vi.mock('../../../lib/supabase', async () =>
  (await import('../../../test/portofoliu-fake')).supabaseMock(),
);
vi.mock('../../../lib/auth', async () =>
  (await import('../../../test/portofoliu-fake')).authMock(),
);
vi.mock('../../../queries/member-identities', async () =>
  (await import('../../../test/portofoliu-fake')).identitiesMock(),
);
vi.mock(
  '../../../queries/member-card',
  () => import('../../../test/member-card-mock'),
);
import { CandidatesPanel } from './CandidatesPanel';

vi.setConfig({ testTimeout: 20_000 });

function Host() {
  const command = useRoleEvaluationCommand();
  return (
    <CandidatesPanel
      disabled={command.isPending}
      onRun={(next) => command.mutateAsync(next)}
    />
  );
}

beforeEach(() => {
  resetDb();
  readNotificationsAbout.mockReset();
});

const panel = async () =>
  (
    await screen.findByRole('heading', {
      name: 'Candidați la promovare',
      level: 2,
    })
  ).closest('section') as HTMLElement;

const candidate = (extra: Partial<Candidate> & { id: number }): Candidate => ({
  member_id: 'ana',
  task_points: 48,
  tenure_since: '2026-03-15',
  role_evaluation_id: 1,
  threshold_used: 30,
  created_at: '2026-07-01T09:00:00Z',
  decision: null,
  ...extra,
});

it('lists the open Promotion Candidates: Promovează opens Roluri preset, Respinge needs a reason', async () => {
  db.runs = [RUN_VA];
  db.candidates = [
    candidate({ id: 7 }),
    candidate({
      id: 8,
      member_id: 'dan',
      task_points: 31,
      tenure_since: '2026-01-10',
    }),
  ];
  const user = userEvent.setup();
  show(<Host />);
  const candidates = await panel();
  // No eyebrow over the title, and no filled button in the list.
  expect(document.querySelector('[data-slot="section-eyebrow"]')).toBeNull();
  const list = await within(candidates).findByRole('list', {
    name: 'Candidați la promovare',
  });
  expect(
    within(list).getByRole('link', { name: 'Promovează: Ana Pop' }),
  ).not.toHaveClass('bg-primary');
  // #1012 (R37): the list shows every candidate, so all their Notifications
  // are read in one request.
  expect(readNotificationsAbout).toHaveBeenCalledWith(['promotion_candidate']);
  const rows = within(list).getAllByRole('listitem');
  // Since R58 the join date is judged by the Membership Cutoff Date, not by
  // months of vechime.
  expect(rows[0]).toHaveTextContent(
    '48 de puncte · pragul de promovare 30 · în OSUBB din 15.03.2026',
  );
  expect(rows[0]).not.toHaveTextContent(/vechime/i);
  expect(rows[0]).toHaveTextContent('Evaluarea „Semestrul I”');
  const href =
    within(rows[0] as HTMLElement)
      .getByRole('link', { name: 'Promovează: Ana Pop' })
      .getAttribute('href') ?? '';
  const url = new URL(href, 'https://app.osubb.ro');
  expect(url.pathname).toBe('/administrare/roluri');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    membru: 'ana',
    rol: 'activ',
    motiv: 'Evaluarea de rol „Semestrul I”',
  });

  await user.click(
    within(rows[1] as HTMLElement).getByRole('button', {
      name: 'Respinge: Dănuț',
    }),
  );
  const dialog = await screen.findByRole('dialog');
  expect(
    within(dialog).getByRole('heading', { name: 'Respingi candidatul?' }),
  ).toBeVisible();
  // The name renders through MemberName, like every Member's name.
  expect(
    within(dialog).getByRole('button', { name: 'Profilul membrului Dănuț' }),
  ).toBeVisible();
  expect(dialog).toHaveTextContent('31 de puncte · pragul de promovare 30');
  const reason = within(dialog).getByLabelText('Motivul respingerii');
  await user.click(
    within(dialog).getByRole('button', { name: 'Respinge candidatul' }),
  );
  expect(reason).toHaveAccessibleDescription('Scrie motivul respingerii.');
  await user.click(reason);
  await user.paste('r'.repeat(501));
  await user.click(
    within(dialog).getByRole('button', { name: 'Respinge candidatul' }),
  );
  expect(reason).toHaveAccessibleDescription(
    'Motivul are cel mult 500 de caractere.',
  );
  expect(db.rpc).not.toHaveBeenCalledWith(
    'reject_promotion_candidate',
    expect.anything(),
  );
  await user.clear(reason);
  await user.type(reason, '  Puncte dintr-un singur eveniment  ');
  await user.click(
    within(dialog).getByRole('button', { name: 'Respinge candidatul' }),
  );
  expect(db.rpc).toHaveBeenCalledWith('reject_promotion_candidate', {
    p_candidate_id: 8,
    p_reason: 'Puncte dintr-un singur eveniment',
  });
  await waitFor(() =>
    expect(
      within(
        within(candidates).getByRole('list', {
          name: 'Candidați la promovare',
        }),
      ).getAllByRole('listitem'),
    ).toHaveLength(1),
  );
  await user.click(
    within(candidates).getByRole('link', { name: 'Promovează: Ana Pop' }),
  );
  expect(screen.getByTestId('where')).toHaveTextContent(
    '/administrare/roluri?membru=ana&rol=activ&motiv=Evaluarea+de+rol+%E2%80%9ESemestrul+I%E2%80%9D',
  );
});

it('lists a candidate who qualified between runs by the day they did, and says how long a rejection holds (#983)', async () => {
  db.runs = [RUN_VA];
  db.candidates = [
    candidate({
      id: 9,
      task_points: 32,
      role_evaluation_id: null,
      created_at: '2026-10-02T08:30:00Z',
    }),
  ];
  const user = userEvent.setup();
  show(<Host />);
  const candidates = await panel();
  const list = await within(candidates).findByRole('list', {
    name: 'Candidați la promovare',
  });
  const row = within(list).getAllByRole('listitem')[0] as HTMLElement;
  expect(row).toHaveTextContent(
    '32 de puncte · pragul de promovare 30 · în OSUBB din 15.03.2026',
  );
  expect(row).toHaveTextContent('Eligibil din 02.10.2026, între evaluări');
  expect(row).not.toHaveTextContent('Evaluarea „');
  const href =
    within(row)
      .getByRole('link', { name: 'Promovează: Ana Pop' })
      .getAttribute('href') ?? '';
  const url = new URL(href, 'https://app.osubb.ro');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    membru: 'ana',
    rol: 'activ',
    motiv: 'Candidat la promovare din 02.10.2026',
  });

  await user.click(
    within(row).getByRole('button', { name: 'Respinge: Ana Pop' }),
  );
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(
    'Respingerea ține până la următoarea evaluare Voluntar Activ: dacă la ea, sau după ea, are din nou cel puțin pragul de promovare, reapare în listă.',
  );
  expect(dialog).toHaveTextContent('32 de puncte · pragul de promovare 30');
});

it('names the Membership Cutoff Date, not the months of tenure, in what it explains', async () => {
  db.candidates = [candidate({ id: 7 })];
  const user = userEvent.setup();
  show(<Host />);
  const candidates = await panel();
  await user.click(
    within(candidates).getByRole('button', {
      name: 'Despre candidații la promovare',
    }),
  );
  const hint = await screen.findByText(/Voluntari intrați până la data limită/);
  expect(hint).toHaveTextContent(
    'Voluntari intrați până la data limită de intrare, care ating pragul de promovare: de îndată ce îl ating, și la fiecare evaluare Voluntar Activ. Nimeni nu este promovat automat: BC decide în panoul de roluri.',
  );
  expect(hint).not.toHaveTextContent(/vechime/i);
});

it('reports a candidate decided meanwhile, and says so when no candidate waits', async () => {
  db.runs = [RUN_VA];
  db.candidates = [candidate({ id: 7 })];
  db.refuse.set('reject_promotion_candidate', {
    code: 'PT409',
    message: 'promotion_candidate_decided',
  });
  const user = userEvent.setup();
  show(<Host />);
  const candidates = await panel();
  await user.click(
    await within(candidates).findByRole('button', {
      name: 'Respinge: Ana Pop',
    }),
  );
  const dialog = await screen.findByRole('dialog');
  await user.type(
    within(dialog).getByLabelText('Motivul respingerii'),
    'Deja promovată',
  );
  // Another BC promoted her meanwhile: the refetch empties the list.
  db.candidates = [];
  await user.click(
    within(dialog).getByRole('button', { name: 'Respinge candidatul' }),
  );
  expect(
    await within(candidates).findByText(
      'Candidatul a fost deja decis. Pagina a fost actualizată.',
    ),
  ).toBeVisible();
  expect(
    await within(candidates).findByText('Niciun candidat la promovare.'),
  ).toBeVisible();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

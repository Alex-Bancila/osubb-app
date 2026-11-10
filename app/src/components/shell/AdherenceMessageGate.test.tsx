import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, expect, it, vi } from 'vitest';

type Row = {
  title: string;
  body: string;
  link_url: string | null;
  link_label: string | null;
  version: number;
};

/* `my_adherence_message()` and `answer_adherence_message()` over one
   message and the Member's answered version, as the server keeps them. */
const db = vi.hoisted(() => ({
  message: null as Row | null,
  answered: 0,
  eligible: true,
  readError: null as { message: string } | null,
  answerError: null as { code: string; message: string } | null,
  /** A save by BC that lands while the pop-up is open. */
  onAnswer: null as (() => void) | null,
  rpc: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.rpc(name, args);
      if (name === 'my_adherence_message') {
        if (db.readError) return { data: null, error: db.readError };
        const row = db.message;
        return {
          data:
            row && db.eligible
              ? [{ ...row, answered: db.answered >= row.version }]
              : [],
          error: null,
        };
      }
      if (name === 'answer_adherence_message') {
        db.onAnswer?.();
        if (db.answerError) return { data: null, error: db.answerError };
        if (args.p_version !== db.message?.version)
          return {
            data: null,
            error: { code: 'PT409', message: 'adherence_message_changed' },
          };
        db.answered = Number(args.p_version);
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  },
}));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'member-1' } } }),
}));
import { AdherenceMessageGate } from './AdherenceMessageGate';

vi.setConfig({ testTimeout: 15_000 });

const MESSAGE: Row = {
  title: 'Mesaj de la Biroul de Conducere',
  body: 'Felicitări, ai devenit **Voluntar Activ**!\n\nCompletează formularul.',
  link_url: 'https://forms.example.org/aderare',
  link_label: 'Deschide formularul de adeziune',
  version: 3,
};

beforeEach(() => {
  db.message = { ...MESSAGE };
  db.answered = 0;
  db.eligible = true;
  db.readError = null;
  db.answerError = null;
  db.onAnswer = null;
  db.rpc.mockReset();
});

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <main>
        <h1>Acasă</h1>
        <button type="button">Un buton din pagină</button>
      </main>
      <AdherenceMessageGate />
    </QueryClientProvider>,
  );
}

const answers = () =>
  db.rpc.mock.calls
    .filter(([name]) => name === 'answer_adherence_message')
    .map(([, args]) => args);

it('shows an unanswered message over the app, with why, the body, the link and Am citit', async () => {
  const { container } = show();
  const dialog = await screen.findByRole('dialog', {
    name: 'Mesaj de la Biroul de Conducere',
  });
  expect(
    within(dialog).getByText('Voluntar Activ', { selector: '.role-badge' }),
  ).toBeVisible();
  expect(within(dialog).getByText('Student UBB')).toBeVisible();
  // Formatted Text, read as the reader reads it.
  expect(
    within(dialog).getByText('Voluntar Activ', { selector: 'strong' }),
  ).toBeVisible();
  expect(within(dialog).getByText('Completează formularul.')).toBeVisible();
  const link = within(dialog).getByRole('link', {
    name: /Deschide formularul de adeziune/,
  });
  expect(link).toHaveAttribute('href', 'https://forms.example.org/aderare');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(
    within(dialog).getByRole('button', { name: 'Am citit' }),
  ).toBeEnabled();
  expect((await axe.run(container)).violations).toEqual([]);
});

it('cannot be closed but by Am citit: no X, and Escape or a tap outside do nothing', async () => {
  const user = userEvent.setup();
  show();
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByRole('button', { name: 'Închide' })).toBeNull();
  await user.keyboard('{Escape}');
  const backdrop = document.querySelector('[data-slot="dialog-overlay"]');
  expect(backdrop).not.toBeNull();
  await user.click(backdrop as HTMLElement);
  // Opening the link answers nothing either.
  await user.click(
    within(dialog).getByRole('link', { name: /Deschide formularul/ }),
  );
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(answers()).toEqual([]);
});

it('answers the version on screen with Am citit and closes', async () => {
  const user = userEvent.setup();
  show();
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Am citit' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(answers()).toEqual([{ p_version: 3 }]);
});

it('shows the new text when BC asked again while it was open, and answers that one', async () => {
  const user = userEvent.setup();
  show();
  const dialog = await screen.findByRole('dialog');
  // BC saves a new version just before the tap reaches the server.
  db.onAnswer = () => {
    db.message = { ...MESSAGE, title: 'Mesaj nou de la BC', version: 4 };
    db.onAnswer = null;
  };
  await user.click(within(dialog).getByRole('button', { name: 'Am citit' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Mesajul tocmai a fost actualizat. Citește noua versiune.',
  );
  const renewed = await screen.findByRole('dialog', {
    name: 'Mesaj nou de la BC',
  });
  await user.click(within(renewed).getByRole('button', { name: 'Am citit' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(answers()).toEqual([{ p_version: 3 }, { p_version: 4 }]);
});

it('keeps the pop-up open with the reason when the answer fails', async () => {
  const user = userEvent.setup();
  db.answerError = { code: '', message: 'TypeError: Failed to fetch' };
  show();
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Am citit' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Nu am putut salva confirmarea. Verifică internetul și încearcă din nou.',
  );
  expect(screen.getByRole('dialog')).toBeVisible();

  db.answerError = null;
  await user.click(within(dialog).getByRole('button', { name: 'Am citit' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('shows a message without a link with Am citit alone', async () => {
  db.message = { ...MESSAGE, link_url: null, link_label: null };
  show();
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByRole('link')).toBeNull();
  expect(
    within(dialog).getByRole('button', { name: 'Am citit' }),
  ).toBeVisible();
});

it.each([
  ['the read fails', () => (db.readError = { message: 'Failed to fetch' })],
  ['the Member is not eligible', () => (db.eligible = false)],
  ['there is no message', () => (db.message = null)],
  ['the Member answered this version', () => (db.answered = 3)],
])('shows nothing when %s', async (_, arrange) => {
  arrange();
  show();
  await waitFor(() =>
    expect(db.rpc).toHaveBeenCalledWith('my_adherence_message', undefined),
  );
  // Give the read a turn to land, then nothing stands over the page.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Un buton din pagină' }),
  ).toBeVisible();
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Group } from '../../queries/reference';

const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: api.invoke } },
}));
vi.mock('../../queries/reference', async (original) => ({
  ...(await original<object>()),
  useGroups: () => ({
    data: new Map<number, Group>([
      [
        1,
        {
          id: 1,
          name: 'Educațional',
          category: 'department',
          manager_title: 'Coordonator',
        } as Group,
      ],
      [9, { id: 9, name: 'Gala Voluntarilor', category: 'project' } as Group],
    ]),
  }),
  useRoles: () => ({
    data: new Map([
      ['voluntar', { name: 'Voluntar', level: 1 }],
      ['bce', { name: 'BCE', level: 5 }],
    ]),
  }),
}));
import { CsvImportDialog } from './CsvImportDialog';

// The real header with fake people.
const HEADER =
  'Nume & Prenume,Funcția,Email,Număr de telefon,Departament PRINCIPAL,Departament secundar,Departament secundar,Departament secundar,Departament secundar,Data Nașterii,Universitatea,Facultatea,Specializarea,Nivel,An de studiu';
const CSV = [
  HEADER,
  'Pop Ana,"BCE, Coordonator Edu",ana@example.test,712345678,Edu,,,,,,,,,,',
  'Ionescu Dan,Membru voluntar,dan@example.test,712345679,Edu,,,,,,,,,,',
  'Fără Adresă,Membru voluntar,,712345670,Edu,,,,,,,,,,',
].join('\n');

const PLAN = {
  format: 'volunteers',
  mode: 'dry_run',
  rows: [
    {
      row: 2,
      full_name: 'Pop Ana',
      email: 'ana@example.test',
      rank: 'bce',
      action: 'create',
      placements: [
        {
          group_id: 1,
          group_name: 'Educațional',
          group_role: 'manager',
          position_title: null,
        },
      ],
      problems: [],
    },
    {
      row: 3,
      full_name: 'Ionescu Dan',
      email: 'dan@example.test',
      rank: 'voluntar',
      action: 'create',
      placements: [
        {
          group_id: 1,
          group_name: 'Educațional',
          group_role: 'member',
          position_title: null,
        },
      ],
      problems: [
        {
          code: 'project_missing',
          message: 'proiect lipsă: Gala',
          blocking: false,
        },
      ],
    },
    {
      row: 4,
      full_name: 'Fără Adresă',
      email: '',
      rank: 'voluntar',
      action: 'skip',
      placements: [],
      problems: [
        {
          code: 'email_missing',
          message: 'Lipsește adresa de email.',
          blocking: true,
        },
      ],
    },
  ],
};

function csvFile(csv = CSV) {
  const file = new File([csv], 'voluntari.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', {
    value: vi.fn().mockResolvedValue(csv),
  });
  return file;
}

beforeEach(() => api.invoke.mockReset());

function show(onShowUninvited = vi.fn()) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <CsvImportDialog onShowUninvited={onShowUninvited} />
    </QueryClientProvider>,
  );
  return { client, onShowUninvited };
}

async function choose(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Import CSV' }));
  const dialog = await screen.findByRole('dialog', { name: 'Import CSV' });
  await user.upload(screen.getByLabelText('Fișier CSV'), csvFile());
  return dialog;
}

it('checks the volunteer sheet with a dry run and previews every row with its problems', async () => {
  const user = userEvent.setup();
  api.invoke.mockResolvedValue({ data: PLAN, error: null });
  show();
  const dialog = await choose(user);
  expect(api.invoke).toHaveBeenCalledWith('csv-import', {
    body: { csv: CSV, mode: 'dry_run' },
  });
  const preview = await within(dialog).findByRole('region', {
    name: 'Previzualizare import',
  });
  // The old flow's button is gone: nothing is created before the preview.
  expect(
    within(dialog).queryByRole('button', { name: 'Importă fișierul' }),
  ).toBeNull();
  const ana = within(preview).getByText('Pop Ana').closest('tr') as HTMLElement;
  expect(ana).toHaveTextContent('BCE');
  expect(ana).toHaveTextContent('Educațional');
  expect(ana).toHaveTextContent('Coordonator · Educațional');
  const dan = within(preview)
    .getByText('Ionescu Dan')
    .closest('tr') as HTMLElement;
  expect(dan).toHaveTextContent('proiect lipsă: Gala');
  const skipped = within(preview)
    .getByText('Fără Adresă')
    .closest('tr') as HTMLElement;
  expect(skipped).toHaveTextContent('Lipsește adresa de email.');
  expect(skipped).toHaveClass('text-muted-foreground');
  expect(within(dialog).getByText('Rânduri').parentElement).toHaveTextContent(
    'Rânduri 3',
  );
  expect(
    within(dialog).getByText('Fără probleme').parentElement,
  ).toHaveTextContent('Fără probleme 1');
  expect(
    within(dialog).getByText('Cu probleme').parentElement,
  ).toHaveTextContent('Cu probleme 2');
  expect(within(dialog).getByText('Se sar').parentElement).toHaveTextContent(
    'Se sar 1',
  );

  await user.click(
    within(dialog).getByRole('button', { name: 'Cu probleme (2)' }),
  );
  expect(within(preview).queryByText('Pop Ana')).toBeNull();
  expect(within(preview).getByText('Ionescu Dan')).toBeVisible();
});

it('imports only the rows the plan keeps, then sums up and leads to "De invitat"', async () => {
  const user = userEvent.setup();
  api.invoke.mockImplementation(
    (_name: string, options?: { body: { mode: string; rows?: number[] } }) => {
      const body = options?.body ?? { mode: 'none' };
      return Promise.resolve({
        error: null,
        data:
          body.mode === 'dry_run'
            ? PLAN
            : {
                rows: (body.rows ?? []).map((row) => ({
                  row,
                  email: row === 2 ? 'ana@example.test' : 'dan@example.test',
                  outcome: row === 2 ? 'created' : 'failed',
                  message: row === 2 ? undefined : 'Telefon invalid.',
                })),
              },
      });
    },
  );
  const { client, onShowUninvited } = show();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const dialog = await choose(user);
  await user.click(
    await within(dialog).findByRole('button', { name: 'Importă 2 membri' }),
  );
  expect(api.invoke).toHaveBeenLastCalledWith('csv-import', {
    body: { csv: CSV, mode: 'apply', rows: [2, 3] },
  });
  expect(
    await within(dialog).findByText('Rezultatul importului'),
  ).toBeVisible();
  expect(within(dialog).getByText('Creați').parentElement).toHaveTextContent(
    'Creați 1',
  );
  expect(within(dialog).getByText('Eșuate').parentElement).toHaveTextContent(
    'Eșuate 1',
  );
  expect(within(dialog).getByText('Sărite').parentElement).toHaveTextContent(
    'Sărite 1',
  );
  const left = within(dialog).getByRole('list', {
    name: 'Rânduri neimportate',
  });
  expect(left).toHaveTextContent(
    'Rândul 3 (dan@example.test): Telefon invalid.',
  );
  expect(left).toHaveTextContent('Rândul 4: Lipsește adresa de email.');
  expect(within(dialog).getByText(/Nu s-a trimis niciun email/)).toBeVisible();
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['members'] }),
  );
  await user.click(
    within(dialog).getByRole('button', { name: 'Vezi lista „De invitat”' }),
  );
  expect(onShowUninvited).toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it("shows the dry run's refusal and imports nothing", async () => {
  const user = userEvent.setup();
  api.invoke.mockResolvedValue({
    data: null,
    error: {
      context: new Response(
        JSON.stringify({
          code: 'too_many_rows',
          error: 'Un fișier poate conține cel mult 1000 de rânduri.',
        }),
        { status: 413 },
      ),
    },
  });
  show();
  const dialog = await choose(user);
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Un fișier poate conține cel mult 1000 de rânduri.',
  );
  expect(api.invoke).toHaveBeenCalledTimes(1);
});

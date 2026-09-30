import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as axe from 'axe-core';
import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: api.invoke } },
}));
import { CsvImportDialog } from './CsvImportDialog';

function csvFile(csv = 'name,email,dept,team\nAna Pop,ana@example.com,EDU,') {
  const file = new File([csv], 'membri.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', {
    value: vi.fn().mockResolvedValue(csv),
  });
  return file;
}

async function uploadAndImport(
  user: ReturnType<typeof userEvent.setup>,
  file = csvFile(),
) {
  await user.upload(screen.getByLabelText('Fișier CSV'), file);
  await user.click(screen.getByRole('button', { name: 'Importă fișierul' }));
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Import CSV' }));
  return screen.findByRole('dialog', { name: 'Import CSV' });
}

beforeEach(() => api.invoke.mockReset());

function show() {
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <CsvImportDialog />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

it('imports a CSV and shows created rows and the exact downloadable template', async () => {
  const user = userEvent.setup();
  api.invoke.mockResolvedValue({
    data: {
      summary: { created: 1, skipped: 0, errors: 0 },
      created: [{ row: 2, email: 'ana@example.com', user_id: 'u1' }],
      skipped: [],
      errors: [],
    },
    error: null,
  });
  const { client } = show();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const dialog = await open(user);
  expect(screen.getByRole('link', { name: 'Descarcă șablon' })).toHaveAttribute(
    'download',
    'model-import-membri.csv',
  );
  expect(screen.getByRole('link', { name: 'Descarcă șablon' })).toHaveAttribute(
    'href',
    '/model-import-membri.csv',
  );
  const template = readFileSync(
    path.resolve('public/model-import-membri.csv'),
    'utf8',
  );
  const documented = readFileSync(
    path.resolve('../docs/backend/recruits-import-template.csv'),
    'utf8',
  );
  expect(template).toBe(documented);
  expect(template).toMatch(/^name,email,dept,team\n/);
  await uploadAndImport(user);
  expect(api.invoke).toHaveBeenCalledWith('csv-import', {
    body: { csv: 'name,email,dept,team\nAna Pop,ana@example.com,EDU,' },
  });
  expect(await screen.findByText('Rândul 2: ana@example.com')).toBeVisible();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['members'] });
  expect(screen.getByText('Create').parentElement).toHaveTextContent(
    'Create: 1',
  );
  expect(
    (
      await axe.run(dialog, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it('shows created, skipped, and per-row error messages from a mixed report', async () => {
  const user = userEvent.setup();
  api.invoke.mockResolvedValue({
    data: {
      summary: { created: 1, skipped: 1, errors: 1 },
      created: [{ row: 2, email: 'ana@example.com', user_id: 'u1' }],
      skipped: [
        { row: 3, email: 'vechi@example.com', code: 'already_exists' },
        { row: 5, email: 'dublu@example.com', code: 'duplicate_in_file' },
        { row: 6, email: 'nou@example.com', code: 'some_future_code' },
      ],
      errors: [
        {
          row: 4,
          email: 'gresit@example.com',
          field: 'dept',
          code: 'unknown_department',
          message: 'Departament inexistent: Necunoscut.',
        },
      ],
    },
    error: null,
  });
  show();
  await open(user);
  await uploadAndImport(user);
  expect(
    await screen.findByText('Rândul 3: vechi@example.com (există deja)'),
  ).toBeVisible();
  expect(
    screen.getByText('Rândul 5: dublu@example.com (duplicat în fișier)'),
  ).toBeVisible();
  // A skip code the dialog does not know yet never reads as a duplicate.
  expect(screen.getByText('Rândul 6: nou@example.com (ignorat)')).toBeVisible();
  expect(
    screen.getByText(
      'Rândul 4 (gresit@example.com): Departament inexistent: Necunoscut.',
    ),
  ).toBeVisible();
  expect(screen.getByText('Erori')).toBeVisible();
});

it('reports a malformed file response without crashing', async () => {
  const user = userEvent.setup();
  api.invoke.mockResolvedValue({
    data: null,
    error: {
      context: new Response(
        JSON.stringify({
          error: 'Antetul CSV trebuie să fie exact: name,email,dept,team.',
        }),
      ),
    },
  });
  show();
  await open(user);
  await uploadAndImport(user, csvFile('wrong,header'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Antetul CSV trebuie să fie exact',
  );
  expect(screen.queryByText('Rezultatul importului')).toBeNull();
});

it('keeps import disabled until a file is selected', async () => {
  const user = userEvent.setup();
  show();
  await open(user);
  expect(
    screen.getByRole('button', { name: 'Importă fișierul' }),
  ).toBeDisabled();
});

/* #949: "Import CSV" is a header action like "Invită membru", its report kept
   in the dialog until it is closed, and a fresh dialog next time. */
it('opens from its button, keeps the report until closed, then starts afresh', async () => {
  const user = userEvent.setup();
  api.invoke.mockResolvedValue({
    data: {
      summary: { created: 1, skipped: 0, errors: 0 },
      created: [{ row: 2, email: 'ana@example.com', user_id: 'u1' }],
      skipped: [],
      errors: [],
    },
    error: null,
  });
  show();
  const trigger = screen.getByRole('button', { name: 'Import CSV' });
  expect(trigger).toHaveClass('w-full');
  expect(screen.queryByLabelText('Fișier CSV')).toBeNull();
  const dialog = await open(user);
  await uploadAndImport(user);
  expect(
    await within(dialog).findByText('Rândul 2: ana@example.com'),
  ).toBeVisible();
  await user.click(within(dialog).getByRole('button', { name: 'Închide' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Import CSV' })).toBeNull(),
  );
  const again = await open(user);
  expect(within(again).queryByText('Rezultatul importului')).toBeNull();
  expect(
    within(again).getByRole('button', { name: 'Importă fișierul' }),
  ).toBeDisabled();
});

it('locks the selected file while its report is pending', async () => {
  let finish!: (value: unknown) => void;
  api.invoke.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const user = userEvent.setup();
  show();
  await open(user);
  await uploadAndImport(user);
  await waitFor(() =>
    expect(screen.getByLabelText('Fișier CSV')).toBeDisabled(),
  );
  finish({
    data: {
      summary: { created: 0, skipped: 0, errors: 0 },
      created: [],
      skipped: [],
      errors: [],
    },
    error: null,
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Fișier CSV')).toBeEnabled(),
  );
});

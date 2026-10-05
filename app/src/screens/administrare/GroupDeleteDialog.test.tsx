import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommandError } from '../../lib/command-reasons';
import type { GroupDeletePreview } from '../../queries/delete-for-good';

const state = vi.hoisted(() => ({
  preview: vi.fn(),
  deleteAsync: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/delete-for-good', async (original) => ({
  ...(await original<object>()),
  useGroupDeletePreview: state.preview,
  useDeleteGroup: () => ({ mutateAsync: state.deleteAsync, isPending: false }),
}));
import { GroupDeleteDialog } from './GroupDeleteDialog';
import { groupDeleteItems } from './group-delete-summary';

const EMPTY: GroupDeletePreview = {
  subgroups: 0,
  members: 0,
  tasks: 0,
  tasksWithPoints: 0,
  points: 0,
  pointMembers: 0,
  events: 0,
  announcements: 0,
  campaigns: 0,
  applications: 0,
  requests: 0,
  protected: false,
};
const FULL: GroupDeletePreview = {
  ...EMPTY,
  subgroups: 2,
  members: 7,
  tasks: 21,
  tasksWithPoints: 3,
  points: 45,
  pointMembers: 4,
  events: 1,
  announcements: 2,
  campaigns: 1,
  applications: 3,
};

const group = { id: 2, name: 'Logistică', parent_id: 1, path: [1, 2] };
const archive = vi.fn();

function preview(data: GroupDeletePreview) {
  state.preview.mockReturnValue({
    isPending: false,
    isError: false,
    data,
    refetch: state.refetch,
  });
}

function Landing() {
  const location = useLocation();
  return (
    <p data-testid="landing">
      {(location.state as { receipt?: string } | null)?.receipt}
    </p>
  );
}

function show(withArchive = true) {
  render(
    <MemoryRouter initialEntries={['/administrare/grupuri/2']}>
      <Routes>
        <Route
          path="/administrare/grupuri/2"
          element={
            <GroupDeleteDialog
              group={group}
              disabled={false}
              onArchive={withArchive ? archive : undefined}
            />
          }
        />
        <Route path="/administrare/grupuri" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Șterge definitiv' }));
  return screen.findByRole('dialog', {
    name: 'Ștergi definitiv grupul Logistică?',
  });
}

beforeEach(() => {
  state.deleteAsync.mockReset().mockResolvedValue({});
  state.refetch.mockReset();
  archive.mockReset().mockResolvedValue(true);
  preview(FULL);
});

it('turns the preview into Romanian counts, only the non-zero ones', () => {
  expect(groupDeleteItems(FULL)).toEqual([
    '2 subgrupuri',
    '21 de taskuri, dintre care 3 cu puncte',
    '45 de puncte retrase de la 4 membri, care primesc o notificare',
    '1 eveniment',
    '2 anunțuri',
    '1 campanie',
    '3 cereri de înscriere',
    '7 membri din roster (conturile lor rămân)',
  ]);
  expect(groupDeleteItems(EMPTY)).toEqual([]);
  expect(groupDeleteItems({ ...EMPTY, requests: 1, members: 1 })).toEqual([
    '1 cerere de activitate realizată',
    '1 membru din roster (conturile lor rămân)',
  ]);
});

it('deletes everything only once the Group’s exact name is typed', async () => {
  const user = userEvent.setup();
  show();
  const dialog = await open(user);
  expect(state.preview).toHaveBeenCalledWith(2);
  const list = within(dialog).getByRole('list', {
    name: 'Ce se șterge odată cu grupul',
  });
  expect(within(list).getAllByRole('listitem')).toHaveLength(8);
  const results = await axe.run(dialog, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);

  const remove = within(dialog).getByRole('button', { name: 'Șterge tot' });
  expect(remove).toBeDisabled();
  const name = within(dialog).getByLabelText(
    'Scrie „Logistică” ca să confirmi',
  );
  await user.type(name, 'logistică');
  expect(remove).toBeDisabled();
  await user.clear(name);
  await user.type(name, 'Logistică ');
  expect(remove).toBeEnabled();
  await user.click(remove);
  expect(state.deleteAsync).toHaveBeenCalledWith({
    groupId: 2,
    mode: 'everything',
  });
  // Back to the Groups list, with the receipt.
  expect(await screen.findByTestId('landing')).toHaveTextContent(
    'Grupul Logistică a fost șters definitiv.',
  );
});

it('deletes a Group with no content in the empty mode', async () => {
  preview({ ...EMPTY, members: 3 });
  const user = userEvent.setup();
  show();
  const dialog = await open(user);
  expect(
    within(dialog).getByText('3 membri din roster (conturile lor rămân)'),
  ).toBeVisible();
  await user.type(
    within(dialog).getByLabelText('Scrie „Logistică” ca să confirmi'),
    'Logistică',
  );
  await user.click(within(dialog).getByRole('button', { name: 'Șterge tot' }));
  expect(state.deleteAsync).toHaveBeenCalledWith({ groupId: 2, mode: 'empty' });
});

it('archives instead, through archive_group, and Păstrează only closes', async () => {
  const user = userEvent.setup();
  show();
  let dialog = await open(user);
  await user.click(within(dialog).getByRole('button', { name: 'Păstrează' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(archive).not.toHaveBeenCalled();
  expect(state.deleteAsync).not.toHaveBeenCalled();

  dialog = await open(user);
  await user.click(within(dialog).getByRole('button', { name: 'Arhivează' }));
  expect(archive).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(state.deleteAsync).not.toHaveBeenCalled();
});

it('keeps the dialog when archiving is refused for open work, linking to it', async () => {
  archive.mockImplementation(async (onFailure: (failure: unknown) => void) => {
    onFailure(
      new CommandError(
        { code: 'PT409', message: 'group_has_open_work' },
        'nope',
      ),
    );
    return false;
  });
  const user = userEvent.setup();
  show();
  const dialog = await open(user);
  await user.click(within(dialog).getByRole('button', { name: 'Arhivează' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Grupul are lucru neterminat.',
  );
  expect(
    within(dialog).getByRole('link', { name: 'Vezi taskurile neterminate' }),
  ).toHaveAttribute('href', '/tracker?lista=gestionat&grup=1&subgrup=2');
});

it('offers no Arhivează for an archived Group', async () => {
  const user = userEvent.setup();
  show(false);
  const dialog = await open(user);
  expect(
    within(dialog).queryByRole('button', { name: 'Arhivează' }),
  ).toBeNull();
  expect(
    within(dialog).getByRole('button', { name: 'Păstrează' }),
  ).toBeVisible();
});

it('says a protected Group cannot be deleted and offers only Arhivează and Păstrează', async () => {
  preview({ ...FULL, protected: true });
  const user = userEvent.setup();
  show();
  const dialog = await open(user);
  expect(dialog).toHaveAccessibleDescription(
    /Logistică nu poate fi șters definitiv\. Grupul organizației, grupurile cu membri adăugați automat și grupurile Biroului de Conducere sau Adunării Generale alese în Setări rămân mereu/,
  );
  expect(
    within(dialog)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['Păstrează', 'Arhivează', '']);
  expect(within(dialog).queryByRole('textbox')).toBeNull();
});

it('reads the preview again when the server says the Group changed', async () => {
  state.deleteAsync.mockRejectedValue(
    new CommandError({ code: 'PT409', message: 'group_not_empty' }, 'x'),
  );
  preview({ ...EMPTY });
  const user = userEvent.setup();
  show();
  const dialog = await open(user);
  await user.type(
    within(dialog).getByLabelText('Scrie „Logistică” ca să confirmi'),
    'Logistică',
  );
  await user.click(within(dialog).getByRole('button', { name: 'Șterge tot' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Între timp, grupul a primit conținut.',
  );
  expect(state.refetch).toHaveBeenCalled();
});

it('shows a preview refusal in Romanian', async () => {
  state.preview.mockReturnValue({
    isPending: false,
    isError: true,
    error: { code: '42501', message: 'group_manage_forbidden' },
    refetch: state.refetch,
  });
  const user = userEvent.setup();
  show();
  const dialog = await open(user);
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'Nu ai permisiunea să faci această schimbare în acest grup.',
  );
});

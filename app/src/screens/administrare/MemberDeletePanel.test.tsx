import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommandError } from '../../lib/command-reasons';
import type { MemberDeletePreview } from '../../queries/member-deletion';

const state = vi.hoisted(() => ({
  preview: vi.fn(),
  deleteAsync: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/member-deletion', async (original) => ({
  ...(await original<object>()),
  useMemberDeletePreview: state.preview,
  useDeleteMember: () => ({ mutateAsync: state.deleteAsync, isPending: false }),
}));
import { MemberDeletePanel } from './MemberDeletePanel';

const MEMBER = '7a3c1e2b-4d5f-4a6b-8c9d-0e1f2a3b4c5d';
const FREE: MemberDeletePreview = {
  holds: {},
  goes: { group_members: 1, notifications: 2 },
  lastHolder: null,
};

function preview(data: MemberDeletePreview | undefined, patch: object = {}) {
  state.preview.mockReturnValue({
    isPending: data === undefined,
    isError: false,
    data,
    error: null,
    refetch: state.refetch,
    ...patch,
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

function show() {
  render(
    <MemoryRouter initialEntries={[`/administrare/membri/${MEMBER}`]}>
      <Routes>
        <Route
          path="/administrare/membri/:memberId"
          element={<MemberDeletePanel memberId={MEMBER} fullName="Ana Pop" />}
        />
        <Route path="/administrare/membri" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
}

const panel = () => screen.getByRole('region', { name: 'Ștergere' });

beforeEach(() => {
  state.deleteAsync.mockReset().mockResolvedValue(undefined);
  state.refetch.mockReset();
  preview(FREE);
});

it('checks the account before it offers anything', () => {
  preview(undefined);
  show();
  expect(within(panel()).getByRole('status')).toHaveTextContent(
    'Se verifică dacă acest cont poate fi șters…',
  );
  expect(screen.queryByRole('button', { name: 'Șterge definitiv' })).toBeNull();
  expect(state.preview).toHaveBeenCalledWith(MEMBER);
});

it('names what holds an account and points to deactivation instead', () => {
  preview({
    ...FREE,
    holds: { 'tasks.created_by': 1, 'points_ledger.member_id': 3 },
  });
  show();
  expect(panel()).toHaveTextContent(
    'Contul are istoric în taskuri și puncte. Nu poate fi șters definitiv;',
  );
  expect(
    within(panel()).getByRole('link', { name: 'dezactivează-l din Roluri' }),
  ).toHaveAttribute('href', `/administrare/membri/${MEMBER}?tab=roluri`);
  expect(screen.queryByRole('button', { name: 'Șterge definitiv' })).toBeNull();
});

it('never offers to delete the last active Moderator or BC member', () => {
  preview({ ...FREE, lastHolder: 'moderator' });
  show();
  expect(panel()).toHaveTextContent(
    'Este ultimul Moderator activ, așa că nu poate fi șters. Numește întâi alt Moderator.',
  );
  expect(screen.queryByRole('button', { name: 'Șterge definitiv' })).toBeNull();
});

it('deletes only once the full name is typed, then lands on Membri with the receipt', async () => {
  const user = userEvent.setup();
  show();
  expect(panel()).toHaveTextContent(
    'Contul dispare cu tot ce ține de el și nu rămâne nicio urmă, nici a ștergerii.',
  );
  await user.click(screen.getByRole('button', { name: 'Șterge definitiv' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Ștergi definitiv acest cont?',
  });
  const list = within(dialog).getByRole('list', {
    name: 'Ce se șterge odată cu contul',
  });
  expect(
    within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual([
    'profilul și contul de conectare',
    'locul din 1 grup',
    '2 notificări',
  ]);
  const results = await axe.run(dialog, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);

  const remove = within(dialog).getByRole('button', { name: 'Șterge contul' });
  expect(remove).toBeDisabled();
  const name = within(dialog).getByLabelText(
    'Scrie numele complet „Ana Pop” ca să confirmi',
  );
  await user.type(name, 'Ana');
  expect(remove).toBeDisabled();
  await user.type(name, ' Pop ');
  expect(remove).toBeEnabled();
  await user.click(remove);

  expect(state.deleteAsync).toHaveBeenCalledWith(MEMBER);
  expect(await screen.findByTestId('landing')).toHaveTextContent(
    'Contul „Ana Pop” a fost șters definitiv.',
  );
});

it('keeps Păstrează as the way out, deleting nothing', async () => {
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole('button', { name: 'Șterge definitiv' }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Păstrează' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(state.deleteAsync).not.toHaveBeenCalled();
});

it('says why the server refused, and reads the preview again', async () => {
  const user = userEvent.setup();
  state.deleteAsync.mockRejectedValue(
    new CommandError(
      { code: 'PT409', message: 'member_has_history' },
      'Nu am putut șterge contul.',
    ),
  );
  show();
  await user.click(screen.getByRole('button', { name: 'Șterge definitiv' }));
  const dialog = await screen.findByRole('dialog');
  await user.type(
    within(dialog).getByLabelText(
      'Scrie numele complet „Ana Pop” ca să confirmi',
    ),
    'Ana Pop',
  );
  await user.click(
    within(dialog).getByRole('button', { name: 'Șterge contul' }),
  );
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Contul are istoric și nu poate fi șters definitiv. Îl poți dezactiva din Roluri.',
  );
  expect(state.refetch).toHaveBeenCalled();
});

it('offers to check again when the preview could not be read', async () => {
  const user = userEvent.setup();
  preview(undefined, {
    isPending: false,
    isError: true,
    error: new CommandError(
      { code: '42501', message: 'member_manage_forbidden' },
      'Nu am putut verifica acest cont.',
    ),
  });
  show();
  expect(within(panel()).getByRole('alert')).toHaveTextContent(
    'Nu mai ai permisiunea de a modifica acest membru. Reîncarcă pagina.',
  );
  await user.click(within(panel()).getByRole('button', { name: 'Reîncearcă' }));
  expect(state.refetch).toHaveBeenCalled();
});

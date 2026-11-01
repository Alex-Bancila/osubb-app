import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import type { GroupArchivePreview } from '../../queries/groups-admin';

/*
 * #1149 (audit M21): the archive confirmation says what archiving does --
 * every descendant archived, every future Event of the subtree cancelled with
 * Notifications to attendees, every pending Application declined with the
 * applicants notified -- with the counts from `group_archive_preview`, and that
 * Dezarhivează restores none of it. One dialog for the Setări tab and the
 * Subgrupuri rows.
 */

const state = vi.hoisted(() => ({ preview: vi.fn(), refetch: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/groups-admin', async (original) => ({
  ...(await original<object>()),
  useGroupArchivePreview: state.preview,
}));
import { GroupArchiveDialog } from './GroupArchiveDialog';
import { groupArchiveItems, NO_UNARCHIVE } from './group-archive-summary';

const group = { id: 2, name: 'Logistică', parent_id: 1, path: [1, 2] };
const archive = vi.fn<() => Promise<boolean>>();
const EMPTY: GroupArchivePreview = { subgroups: 0, events: 0, applications: 0 };
const FULL: GroupArchivePreview = { subgroups: 3, events: 2, applications: 1 };

function preview(data: GroupArchivePreview) {
  state.preview.mockReturnValue({
    isPending: false,
    isError: false,
    data,
    refetch: state.refetch,
  });
}

function show(
  error: string | null = null,
  variant: 'group' | 'child' = 'group',
) {
  return render(
    <MemoryRouter>
      <GroupArchiveDialog
        group={group}
        disabled={false}
        error={error}
        onArchive={archive}
        variant={variant}
      />
    </MemoryRouter>,
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Arhivează grupul' }));
  return screen.findByRole('dialog', { name: 'Arhivează Logistică' });
}

beforeEach(() => {
  archive.mockReset().mockResolvedValue(true);
  state.refetch.mockReset();
  preview(FULL);
});

it('turns the preview into Romanian counts, only the non-zero ones', () => {
  expect(groupArchiveItems(FULL)).toEqual([
    '3 subgrupuri arhivate',
    '2 evenimente viitoare anulate, cu notificare către participanți',
    '1 cerere de înscriere respinsă, cu notificare către solicitant',
  ]);
  expect(groupArchiveItems(EMPTY)).toEqual([]);
  expect(
    groupArchiveItems({ subgroups: 1, events: 1, applications: 21 }),
  ).toEqual([
    '1 subgrup arhivat',
    '1 eveniment viitor anulat, cu notificare către participanți',
    '21 de cereri de înscriere respinse, cu notificare către solicitanți',
  ]);
});

it('lists what archiving does, with the counts, and that unarchiving brings none of it back (#1149)', async () => {
  const user = userEvent.setup();
  show();
  const dialog = await open(user);
  const list = within(dialog).getByRole('list', {
    name: 'Ce se întâmplă la arhivare',
  });
  expect(
    within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(groupArchiveItems(FULL));
  expect(dialog).toHaveTextContent(NO_UNARCHIVE);
  expect(
    within(dialog).getByRole('button', { name: 'Arhivează' }),
  ).toBeEnabled();
});

it('says the short sentence on an empty leaf', async () => {
  preview(EMPTY);
  const user = userEvent.setup();
  show();
  const dialog = await open(user);
  expect(within(dialog).queryByRole('list')).toBeNull();
  expect(dialog).toHaveAccessibleDescription(
    /Grupul nu mai poate primi taskuri, evenimente sau membri noi\. Istoricul rămâne\./,
  );
  expect(dialog).not.toHaveTextContent(NO_UNARCHIVE);
});

it('archives through onArchive and closes when it succeeds', async () => {
  const user = userEvent.setup();
  show();
  const dialog = await open(user);
  await user.click(within(dialog).getByRole('button', { name: 'Arhivează' }));
  expect(archive).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('keeps the dialog with the reason and the link when archiving is refused for open work', async () => {
  archive.mockResolvedValue(false);
  const user = userEvent.setup();
  show('Grupul are lucru neterminat.');
  const dialog = await open(user);
  await user.click(within(dialog).getByRole('button', { name: 'Arhivează' }));
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'Grupul are lucru neterminat.',
  );
  expect(
    within(dialog).getByRole('link', { name: 'Vezi taskurile neterminate' }),
  ).toBeVisible();
});

it('waits for the preview and shows a failed one with Reîncearcă', async () => {
  state.preview.mockReturnValue({
    isPending: true,
    isError: false,
    data: undefined,
    refetch: state.refetch,
  });
  const user = userEvent.setup();
  const first = show();
  const dialog = await open(user);
  expect(within(dialog).getByRole('status')).toHaveTextContent(
    'Se verifică ce ar schimba arhivarea…',
  );
  expect(
    within(dialog).queryByRole('button', { name: 'Arhivează' }),
  ).toBeNull();
  first.unmount();

  state.preview.mockReturnValue({
    isPending: false,
    isError: true,
    data: undefined,
    error: new Error('x'),
    refetch: state.refetch,
  });
  show();
  const again = await open(user);
  expect(within(again).getByRole('alert')).toHaveTextContent(
    'Nu am putut verifica ce ar schimba arhivarea.',
  );
  expect(within(again).queryByRole('button', { name: 'Arhivează' })).toBeNull();
  await user.click(within(again).getByRole('button', { name: 'Reîncearcă' }));
  expect(state.refetch).toHaveBeenCalled();
});

it('offers the compact trigger for a Subgrupuri row and names the Child Group', async () => {
  preview(EMPTY);
  const user = userEvent.setup();
  show(null, 'child');
  await user.click(screen.getByRole('button', { name: 'Arhivează Logistică' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Arhivează Logistică',
  });
  expect(dialog).toHaveAccessibleDescription(
    /Subgrupul nu mai poate primi taskuri, evenimente sau membri noi\./,
  );
});

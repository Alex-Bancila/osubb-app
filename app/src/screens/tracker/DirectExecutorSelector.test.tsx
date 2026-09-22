import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { beforeEach, expect, it, vi } from 'vitest';
import type { DirectExecutorData } from '../../queries/direct-executors';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const hook = vi.hoisted(() => vi.fn());
vi.mock('../../queries/direct-executors', async (original) => ({
  ...(await original<object>()),
  useDirectExecutors: hook,
}));
import { DirectExecutorSelector } from './DirectExecutorSelector';

const data: DirectExecutorData = {
  members: [
    { id: 'ana', name: 'Ana Șerban', level: 1, avatarColor: '#123456' },
    { id: 'mihai', name: 'Mihai Pop', level: 3, avatarColor: null },
  ],
  groups: [
    {
      id: 1,
      name: 'Educațional',
      path: [1],
      min_level: 0,
      automatic_membership: false,
      status: 'active',
    },
    {
      id: 2,
      name: 'Echipa',
      path: [1, 2],
      min_level: 0,
      automatic_membership: false,
      status: 'active',
    },
    {
      id: 3,
      name: 'Adunarea Generală',
      path: [3],
      min_level: 3,
      automatic_membership: true,
      status: 'active',
    },
  ],
  memberships: [{ group_id: 2, member_id: 'ana' }],
};
beforeEach(() =>
  hook.mockReturnValue({
    data,
    isSuccess: true,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
);

const executorBox = () => screen.getByRole('combobox', { name: 'Executor' });
const groupBox = () =>
  screen.getByRole('combobox', { name: 'Arată doar membrii din grupul' });
const optionNames = () =>
  screen.getAllByRole('option').map((option) => option.textContent);

async function pickGroup(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
) {
  await user.click(groupBox());
  await user.click(await screen.findByRole('option', { name: text }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

it('searches names inside the Executor dropdown, ignoring diacritics, and returns one member ID', async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  render(
    <DirectExecutorSelector originGroupId={1} value={null} onChange={change} />,
  );
  await user.click(executorBox());
  await user.type(
    await screen.findByRole('combobox', { name: 'Caută un membru' }),
    'serban',
  );
  await waitFor(() => expect(optionNames()).toEqual(['AȘAna Șerban']));
  await user.keyboard('{ArrowDown}{Enter}');
  expect(change).toHaveBeenLastCalledWith('ana');
});

it('shows a small initials avatar on the member colour, never a full image', async () => {
  const user = userEvent.setup();
  render(
    <DirectExecutorSelector
      originGroupId={1}
      value={null}
      onChange={vi.fn()}
    />,
  );
  await user.click(executorBox());
  const option = await screen.findByRole('option', { name: 'Ana Șerban' });
  const avatar = option.querySelector('[data-slot="member-avatar"]');
  expect(avatar).toHaveTextContent('AȘ');
  expect(avatar).toHaveStyle({ background: '#123456' });
  expect(screen.getByRole('listbox').querySelector('img')).toBeNull();
});

it('offers no Campaign filter: Campaigns have no members', () => {
  render(
    <DirectExecutorSelector
      originGroupId={1}
      value={null}
      onChange={vi.fn()}
    />,
  );
  expect(screen.queryByText(/campani/i)).not.toBeInTheDocument();
  expect(screen.getAllByRole('combobox')).toHaveLength(2);
});

it('searches Groups by name or parent, and a Group includes every Group below it', async () => {
  const user = userEvent.setup();
  render(
    <DirectExecutorSelector
      originGroupId={1}
      value={null}
      onChange={vi.fn()}
    />,
  );
  await user.click(groupBox());
  await user.type(
    await screen.findByRole('combobox', { name: 'Caută un grup' }),
    'educ',
  );
  await waitFor(() =>
    expect(optionNames()).toEqual(['Educațional', 'Echipa· Educațional']),
  );
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());

  await pickGroup(user, 'Educațional');
  expect(groupBox()).toHaveTextContent('Educațional');
  await user.click(executorBox());
  await waitFor(() => expect(optionNames()).toEqual(['AȘAna Șerban']));
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());

  await user.click(
    screen.getByRole('button', { name: 'Arată toate grupurile' }),
  );
  await user.click(executorBox());
  await waitFor(() =>
    expect(optionNames()).toEqual(['AȘAna Șerban', 'MPMihai Pop']),
  );
});

it('keeps a filtered-out selection, but clears it when the Origin minimum rises', async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  const { rerender } = render(
    <DirectExecutorSelector originGroupId={1} value="ana" onChange={change} />,
  );
  expect(executorBox()).toHaveTextContent('Ana Șerban');
  await pickGroup(user, 'Adunarea Generală');
  expect(executorBox()).toHaveTextContent('Ana Șerban');
  expect(change).not.toHaveBeenCalled();
  rerender(
    <DirectExecutorSelector originGroupId={3} value="ana" onChange={change} />,
  );
  expect(change).toHaveBeenCalledWith(null);
});

it('clears a deactivated selection after refreshed data, but not while loading', () => {
  const change = vi.fn();
  hook.mockReturnValue({ data: undefined, isSuccess: false, isPending: true });
  const { rerender } = render(
    <DirectExecutorSelector originGroupId={1} value="ana" onChange={change} />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Se încarcă');
  expect(change).not.toHaveBeenCalled();
  hook.mockReturnValue({
    data: { ...data, members: [data.members[1]] },
    isSuccess: true,
  });
  rerender(
    <DirectExecutorSelector originGroupId={1} value="ana" onChange={change} />,
  );
  expect(change).toHaveBeenCalledWith(null);
});

it('offers a retry, and says so when a search finds nobody', async () => {
  const user = userEvent.setup();
  const refetch = vi.fn();
  hook.mockReturnValue({ isError: true, refetch });
  const { rerender } = render(
    <DirectExecutorSelector
      originGroupId={1}
      value={null}
      onChange={vi.fn()}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Reîncarcă lista' }));
  expect(refetch).toHaveBeenCalled();
  hook.mockReturnValue({ data, isSuccess: true });
  rerender(
    <DirectExecutorSelector
      originGroupId={1}
      value={null}
      onChange={vi.fn()}
    />,
  );
  await user.click(executorBox());
  await user.type(
    await screen.findByRole('combobox', { name: 'Caută un membru' }),
    'Nobody',
  );
  expect(await screen.findByText('Niciun membru găsit.')).toBeVisible();
});

it('says when nobody meets the Origin minimum', () => {
  hook.mockReturnValue({
    data: { ...data, members: [data.members[0]] },
    isSuccess: true,
  });
  render(
    <DirectExecutorSelector
      originGroupId={3}
      value={null}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Niciun membru nu are nivelul cerut',
  );
  expect(executorBox()).toBeDisabled();
});

it('has no automated accessibility violations', async () => {
  const { container } = render(
    <DirectExecutorSelector
      originGroupId={1}
      value={null}
      onChange={vi.fn()}
    />,
  );
  expect((await axe.run(container)).violations).toEqual([]);
});

it('derives Automatic Membership by level and accepts a readable archived Origin', async () => {
  hook.mockReturnValue({
    data: {
      ...data,
      groups: data.groups.map((group) =>
        group.id === 1 ? { ...group, status: 'archived' } : group,
      ),
    },
    isSuccess: true,
  });
  const user = userEvent.setup();
  render(
    <DirectExecutorSelector
      originGroupId={1}
      value={null}
      onChange={vi.fn()}
    />,
  );
  await pickGroup(user, 'Adunarea Generală');
  await user.click(executorBox());
  const list = await screen.findByRole('listbox');
  expect(
    within(list)
      .getAllByRole('option')
      .map((o) => o.textContent),
  ).toEqual(['MPMihai Pop']);
});

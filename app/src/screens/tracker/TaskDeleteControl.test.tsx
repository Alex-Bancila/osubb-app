import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { beforeEach, expect, it, vi } from 'vitest';
import { DeleteRefusal } from '../../queries/delete-for-good';

const state = vi.hoisted(() => ({
  preview: vi.fn(),
  deleteAsync: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/delete-for-good', async (original) => ({
  ...(await original<object>()),
  useTaskDeletePreview: state.preview,
  useDeleteTask: () => ({ mutateAsync: state.deleteAsync, isPending: false }),
}));
vi.mock('../../queries/member-identities', () => ({
  useMemberIdentities: () => ({
    data: new Map([
      ['ana', { memberId: 'ana', nickname: null, fullName: 'Ana Pop' }],
      ['radu', { memberId: 'radu', nickname: 'Radu', fullName: 'Radu Mihai' }],
    ]),
  }),
}));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
import { TaskDeleteControl } from './TaskDeleteControl';

const onDeleted = vi.fn();

function preview(data: {
  subtasks?: number;
  total?: number;
  members?: { memberId: string; points: number }[];
}) {
  state.preview.mockReturnValue({
    isPending: false,
    isError: false,
    refetch: state.refetch,
    data: { subtasks: 0, total: 0, members: [], ...data },
  });
}

beforeEach(() => {
  onDeleted.mockReset();
  state.deleteAsync.mockReset().mockResolvedValue({
    deletedTasks: 1,
    pointsReversed: 0,
    members: 0,
  });
  preview({});
});

async function open(user: ReturnType<typeof userEvent.setup>) {
  render(<TaskDeleteControl taskId={17} canManage onDeleted={onDeleted} />);
  await user.click(screen.getByRole('button', { name: 'Șterge definitiv' }));
  return screen.findByRole('dialog', { name: 'Ștergi definitiv taskul?' });
}

it('is offered only to the Task’s managers', () => {
  const { rerender } = render(
    <TaskDeleteControl taskId={17} canManage={false} onDeleted={onDeleted} />,
  );
  expect(screen.queryByRole('button')).toBeNull();
  rerender(<TaskDeleteControl taskId={17} canManage onDeleted={onDeleted} />);
  const trigger = screen.getByRole('button', { name: 'Șterge definitiv' });
  // Visually destructive and pushed apart from the other commands.
  expect(trigger).toHaveClass('text-destructive', 'sm:ml-auto');
  expect(state.preview).not.toHaveBeenCalled();
});

it('asks once for a Task without points and deletes it without them', async () => {
  const user = userEvent.setup();
  const dialog = await open(user);
  expect(state.preview).toHaveBeenCalledWith(17);
  expect(dialog).toHaveAccessibleDescription('Nu poate fi recuperat.');
  const results = await axe.run(dialog, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);
  await user.click(
    within(dialog).getByRole('button', { name: 'Șterge definitiv' }),
  );
  expect(state.deleteAsync).toHaveBeenCalledWith({
    taskId: 17,
    withPoints: false,
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(onDeleted).toHaveBeenCalledWith('Taskul a fost șters definitiv.');
});

it('names an Umbrella’s Subtasks', async () => {
  preview({ subtasks: 3 });
  const user = userEvent.setup();
  const dialog = await open(user);
  expect(dialog).toHaveAccessibleDescription(
    'Se șterg și cele 3 subtaskuri ale lui. Nu poate fi recuperat.',
  );
});

it('with points, names the Member and offers to delete the points or keep the Task', async () => {
  preview({ total: 12, members: [{ memberId: 'ana', points: 12 }] });
  state.deleteAsync.mockResolvedValue({
    deletedTasks: 1,
    pointsReversed: -12,
    members: 1,
  });
  const user = userEvent.setup();
  const dialog = await open(user);
  expect(dialog).toHaveAccessibleDescription(
    /^Taskul a acordat 12 puncte lui Ana Pop ?\. Ce vrei să faci\?$/,
  );
  expect(
    within(dialog).getByRole('button', { name: 'Profilul membrului Ana Pop' }),
  ).toBeVisible();
  expect(
    within(dialog).queryByRole('button', { name: 'Șterge definitiv' }),
  ).toBeNull();
  await user.click(
    within(dialog).getByRole('button', { name: 'Șterge taskul și punctele' }),
  );
  expect(state.deleteAsync).toHaveBeenCalledWith({
    taskId: 17,
    withPoints: true,
  });
  await waitFor(() =>
    expect(onDeleted).toHaveBeenCalledWith(
      'Taskul a fost șters definitiv. Au fost retrase 12 puncte.',
    ),
  );
});

it('lists several Members with their points, and "Păstrează taskul" closes', async () => {
  preview({
    total: 20,
    members: [
      { memberId: 'radu', points: 12 },
      { memberId: 'ana', points: 8 },
    ],
  });
  const user = userEvent.setup();
  const dialog = await open(user);
  expect(
    within(dialog).getByText('Taskul a acordat 20 de puncte acestor 2 membri:'),
  ).toBeVisible();
  const list = within(dialog).getByRole('list', {
    name: 'Membri cu puncte din acest task',
  });
  const rows = within(list).getAllByRole('listitem');
  expect(rows.map((row) => row.textContent)).toEqual([
    'RMRadu12 puncte',
    'APAna Pop8 puncte',
  ]);
  await user.click(
    within(dialog).getByRole('button', { name: 'Păstrează taskul' }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(state.deleteAsync).not.toHaveBeenCalled();
  expect(onDeleted).not.toHaveBeenCalled();
});

it('switches to the points question when points arrived after the preview', async () => {
  state.deleteAsync.mockRejectedValueOnce(
    new DeleteRefusal(
      {
        code: 'PT409',
        message: 'task_has_points',
        details: '{"total": 5, "members": [{"member_id": "ana", "points": 5}]}',
      },
      'x',
    ),
  );
  const user = userEvent.setup();
  const dialog = await open(user);
  await user.click(
    within(dialog).getByRole('button', { name: 'Șterge definitiv' }),
  );
  expect(
    await within(dialog).findByRole('button', {
      name: 'Șterge taskul și punctele',
    }),
  ).toBeVisible();
  expect(dialog).toHaveAccessibleDescription(
    /Taskul a acordat 5 puncte lui Ana Pop/,
  );
  await user.click(
    within(dialog).getByRole('button', { name: 'Șterge taskul și punctele' }),
  );
  expect(state.deleteAsync).toHaveBeenLastCalledWith({
    taskId: 17,
    withPoints: true,
  });
});

it('shows a refusal in Romanian inside the dialog', async () => {
  preview({ total: 5, members: [{ memberId: 'ana', points: 5 }] });
  state.deleteAsync.mockRejectedValue(
    new DeleteRefusal(
      { code: '42501', message: 'task_evaluate_forbidden' },
      'x',
    ),
  );
  const user = userEvent.setup();
  const dialog = await open(user);
  await user.click(
    within(dialog).getByRole('button', { name: 'Șterge taskul și punctele' }),
  );
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Nu poți evalua munca acestui membru în grupul ales și nici să-i retragi punctele.',
  );
  expect(onDeleted).not.toHaveBeenCalled();
});

it('says when the preview could not be read, with a retry', async () => {
  state.preview.mockReturnValue({
    isPending: false,
    isError: true,
    error: new Error('offline'),
    refetch: state.refetch,
  });
  const user = userEvent.setup();
  const dialog = await open(user);
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'Nu am putut verifica punctele taskului.',
  );
  await user.click(within(dialog).getByRole('button', { name: 'Reîncearcă' }));
  expect(state.refetch).toHaveBeenCalled();
  expect(
    within(dialog).queryByRole('button', { name: 'Șterge definitiv' }),
  ).toBeNull();
});

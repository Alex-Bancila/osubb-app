import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { taskRow } from '../../test/task-fixtures';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const state = vi.hoisted(() => ({
  participation: vi.fn(),
  mutate: vi.fn(),
  pending: false,
}));
vi.mock('../../queries/task-mode', async (original) => ({
  ...(await original<object>()),
  useTaskParticipation: state.participation,
  useConvertTaskMode: () => ({
    mutateAsync: state.mutate,
    isPending: state.pending,
  }),
}));
import { TaskModeControl } from './TaskModeControl';
import { TaskModeError } from '../../queries/task-mode';

const untouched = { assigned: false, hasCandidates: false };
const task = taskRow({ assignment_mode: 'direct', audience: 'local' });

beforeEach(() => {
  state.pending = false;
  state.participation.mockReset();
  state.participation.mockReturnValue({ data: untouched });
  state.mutate.mockReset();
  state.mutate.mockResolvedValue({ id: 1 });
});

it('offers the conversion to a manager of a Task nobody has taken yet', async () => {
  const { container } = render(<TaskModeControl task={task} canManage />);
  await userEvent.click(screen.getByRole('button', { name: 'Schimbă modul' }));
  expect(screen.getByLabelText('Mod de atribuire')).toHaveValue('direct');
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it('hides the control for a non-manager without even asking the server', () => {
  render(<TaskModeControl task={task} canManage={false} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(state.participation).toHaveBeenCalledWith(task.id, false);
});

it('hides the control once an Executor or a Candidate exists', () => {
  for (const participation of [
    { assigned: true, hasCandidates: false },
    { assigned: false, hasCandidates: true },
  ]) {
    state.participation.mockReturnValue({ data: participation });
    const view = render(<TaskModeControl task={task} canManage />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    view.unmount();
  }
});

it('hides the control while participation is still unknown', () => {
  state.participation.mockReturnValue({ data: undefined });
  render(<TaskModeControl task={task} canManage />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('hides the control for an Umbrella and for every terminal status', () => {
  const view = render(
    <TaskModeControl task={{ ...task, kind: 'umbrella' }} canManage />,
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  for (const status of ['completed', 'unfulfilled', 'cancelled'] as const) {
    view.rerender(<TaskModeControl task={{ ...task, status }} canManage />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  }
  expect(state.participation).toHaveBeenCalledWith(task.id, false);
  expect(state.participation).not.toHaveBeenCalledWith(task.id, true);
});

it('sends each Mode and Audience combination and keeps a direct Task’s Audience', async () => {
  const user = userEvent.setup();
  const cases = [
    {
      row: { assignment_mode: 'direct', audience: 'local' } as const,
      mode: 'public',
      audience: 'org',
      sent: { assignmentMode: 'public', audience: 'org' },
    },
    {
      row: { assignment_mode: 'direct', audience: 'local' } as const,
      mode: 'public',
      audience: 'local',
      sent: { assignmentMode: 'public', audience: 'local' },
    },
    {
      row: { assignment_mode: 'public', audience: 'org' } as const,
      mode: 'direct',
      audience: null,
      sent: { assignmentMode: 'direct', audience: 'org' },
    },
    {
      row: { assignment_mode: 'public', audience: 'local' } as const,
      mode: 'direct',
      audience: null,
      sent: { assignmentMode: 'direct', audience: 'local' },
    },
  ];
  for (const scenario of cases) {
    const view = render(
      <TaskModeControl task={{ ...task, ...scenario.row }} canManage />,
    );
    await user.click(screen.getByRole('button', { name: 'Schimbă modul' }));
    await user.selectOptions(
      screen.getByLabelText('Mod de atribuire'),
      scenario.mode,
    );
    if (scenario.audience === null) {
      expect(screen.queryByLabelText('Audiență')).not.toBeInTheDocument();
    } else {
      await user.selectOptions(
        screen.getByLabelText('Audiență'),
        scenario.audience,
      );
    }
    await user.click(screen.getByRole('button', { name: 'Salvează modul' }));
    expect(state.mutate).toHaveBeenLastCalledWith({
      taskId: task.id,
      ...scenario.sent,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'istoricul taskului',
    );
    view.unmount();
  }
  expect(state.mutate).toHaveBeenCalledTimes(4);
});

it('shows the translated reason and keeps the form open when the command refuses', async () => {
  state.mutate.mockRejectedValue(
    new TaskModeError('Cineva s-a înscris deja în coada taskului.'),
  );
  render(<TaskModeControl task={task} canManage />);
  await userEvent.click(screen.getByRole('button', { name: 'Schimbă modul' }));
  await userEvent.selectOptions(
    screen.getByLabelText('Mod de atribuire'),
    'public',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Salvează modul' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'înscris deja în coada taskului',
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Mod de atribuire')).toHaveValue('public');
});

it('never sends an unexpected failure’s backend detail to the member', async () => {
  state.mutate.mockRejectedValue(new Error('stack depth limit exceeded'));
  render(<TaskModeControl task={task} canManage />);
  await userEvent.click(screen.getByRole('button', { name: 'Schimbă modul' }));
  await userEvent.selectOptions(
    screen.getByLabelText('Mod de atribuire'),
    'public',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Salvează modul' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Nu am putut schimba modul taskului',
  );
});

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { expect, it, vi } from 'vitest';
import { TaskForm } from './TaskForm';
import type { TaskFormOptions } from './task-form-model';
vi.mock('../../queries/direct-executors', async (original) => ({
  ...(await original<typeof import('../../queries/direct-executors')>()),
  useDirectExecutors: () => ({
    isSuccess: true,
    data: {
      members: [{ id: 'ana', name: 'Ana Pop', level: 3 }],
      groups: [{ id: 3, name: 'Echipa afișe', path: [1, 2, 3], min_level: 1 }],
      memberships: [],
      campaigns: [],
      assignments: [],
    },
  }),
}));
const options: TaskFormOptions = {
  groups: [
    {
      id: 1,
      name: 'Educațional',
      path: [1],
      min_level: 0,
    },
    {
      id: 2,
      name: 'Conferință',
      path: [1, 2],
      min_level: 1,
    },
    {
      id: 3,
      name: 'Echipa afișe',
      path: [1, 2, 3],
      min_level: 1,
    },
    { id: 4, name: 'Tineret', path: [4], min_level: 0 },
  ],
  campaigns: [
    { id: 10, name: 'Campanie părinte', group_id: 1 },
    { id: 11, name: 'Campanie proprie', group_id: 3 },
    { id: 12, name: 'Altă origine', group_id: 4 },
  ],
  umbrellas: [{ id: 30, title: 'Pregătește conferința', group_id: 3 }],
};
async function content() {
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText('Titlu (obligatoriu)'),
    '  Pregătește afișele  ',
  );
  fireEvent.change(screen.getByLabelText(/Termen/), {
    target: { value: '2026-10-01T12:30' },
  });
  return user;
}
it('offers nested managed Groups and ancestor Campaigns, emitting a trimmed direct draft without writing', async () => {
  const onDraft = vi.fn();
  const { container } = render(
    <TaskForm options={options} onDraft={onDraft} />,
  );
  const user = await content();
  expect(
    screen.getByRole('option', {
      name: /Educațional › Conferință › Echipa afișe/,
    }),
  ).toBeInTheDocument();
  await user.selectOptions(
    screen.getByLabelText('Grup de origine (obligatoriu)'),
    '3',
  );
  expect(
    screen.getByRole('option', { name: 'Campanie părinte' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('option', { name: 'Altă origine' }),
  ).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Campanie (opțional)'), '10');
  await user.selectOptions(screen.getByLabelText('Executor'), 'ana');
  expect(screen.queryByLabelText(/Dificultate/)).not.toBeInTheDocument();
  expect((await axe.run(container)).violations).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledWith({
    title: 'Pregătește afișele',
    description: null,
    deadline: '2026-10-01T09:30:00.000Z',
    groupId: 3,
    kind: 'task',
    parentTaskId: null,
    audience: 'local',
    assignmentMode: 'direct',
    executorId: 'ana',
    campaignId: 10,
  });
});
it('clears the Executor on public mode and clears incompatible Campaigns after Origin changes', async () => {
  const onDraft = vi.fn();
  render(<TaskForm options={options} onDraft={onDraft} />);
  const user = await content();
  await user.selectOptions(
    screen.getByLabelText('Grup de origine (obligatoriu)'),
    '3',
  );
  await user.selectOptions(screen.getByLabelText('Campanie (opțional)'), '10');
  await user.selectOptions(screen.getByLabelText('Executor'), 'ana');
  await user.selectOptions(screen.getByLabelText('Mod de atribuire'), 'public');
  expect(screen.queryByLabelText('Executor')).not.toBeInTheDocument();
  await user.selectOptions(
    screen.getByLabelText('Grup de origine (obligatoriu)'),
    '4',
  );
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({
      groupId: 4,
      assignmentMode: 'public',
      executorId: null,
      campaignId: null,
    }),
  );
});
it('locks Subtask Origin to a live parent and cannot create nested Umbrellas', async () => {
  const onDraft = vi.fn();
  render(<TaskForm options={options} onDraft={onDraft} parentTaskId={30} />);
  const user = await content();
  expect(screen.getByLabelText('Tip')).toBeDisabled();
  expect(screen.getByLabelText('Task-umbrelă (obligatoriu)')).toBeDisabled();
  expect(screen.getByLabelText('Grup de origine (obligatoriu)')).toBeDisabled();
  expect(screen.getByLabelText('Grup de origine (obligatoriu)')).toHaveValue(
    '3',
  );
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'task', parentTaskId: 30, groupId: 3 }),
  );
});
it('strips assignment and Campaign fields for an Umbrella and allows no deadline', async () => {
  const onDraft = vi.fn();
  render(<TaskForm options={options} onDraft={onDraft} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Titlu (obligatoriu)'), 'Eveniment');
  await user.selectOptions(
    screen.getByLabelText('Grup de origine (obligatoriu)'),
    '3',
  );
  await user.selectOptions(screen.getByLabelText('Tip'), 'umbrella');
  expect(screen.queryByLabelText('Mod de atribuire')).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText('Campanie (opțional)'),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'umbrella',
      deadline: null,
      audience: null,
      assignmentMode: null,
      executorId: null,
      campaignId: null,
    }),
  );
});
it('blocks invalid deadlines and a parent removed by a refreshed read', async () => {
  const onDraft = vi.fn();
  const view = render(
    <TaskForm options={options} onDraft={onDraft} parentTaskId={30} />,
  );
  const user = await content();
  fireEvent.change(screen.getByLabelText(/Termen/), {
    target: { value: '2027-03-28T03:30' },
  });
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(screen.getByRole('alert')).toHaveTextContent('termen valid');
  view.rerender(
    <TaskForm
      options={{ ...options, umbrellas: [] }}
      onDraft={onDraft}
      parentTaskId={30}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'task-umbrelă disponibil',
  );
  expect(onDraft).not.toHaveBeenCalled();
});
it('explains when the caller has no managed Groups', () => {
  render(
    <TaskForm
      options={{ groups: [], campaigns: [], umbrellas: [] }}
      onDraft={vi.fn()}
    />,
  );
  expect(
    screen.getByText('Nu ai grupuri în care poți pregăti taskuri.'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

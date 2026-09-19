import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  capability: true,
  mutation: { isPending: false, mutateAsync: vi.fn() },
  guide: {
    isPending: false,
    isError: false,
    data: {
      ratings: [
        { rating: 1, multiplier: -2, label: 'Slab', note: null },
        { rating: 5, multiplier: 4, label: 'Excelent', note: null },
      ],
      difficulties: [{ stars: 2, note: 'Ușor' }],
    },
  },
}));
vi.mock('../../queries/task-review', () => ({
  useTaskEvaluationCapability: () => ({ data: state.capability }),
  useEvaluateTask: () => state.mutation,
}));
vi.mock('../../queries/scoring-guide', () => ({
  useScoringGuide: () => state.guide,
}));
import { TaskEvaluationControl } from './TaskEvaluationControl';
beforeEach(() => {
  state.capability = true;
  state.mutation.isPending = false;
  state.mutation.mutateAsync.mockReset().mockResolvedValue({ id: 17 });
});
const props = {
  taskId: 17,
  status: 'in_review' as const,
  kind: 'task',
  executorName: 'Ana Pop',
};
it('hides evaluation without server authority and outside review', () => {
  state.capability = false;
  const view = render(<TaskEvaluationControl {...props} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  state.capability = true;
  view.rerender(<TaskEvaluationControl {...props} status="todo" />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('requires all fields, previews live guide values and submits one Executor evaluation', async () => {
  const user = userEvent.setup();
  render(<TaskEvaluationControl {...props} />);
  await user.click(screen.getByRole('button', { name: 'Evaluează taskul' }));
  await user.click(screen.getByRole('button', { name: 'Confirmă evaluarea' }));
  expect(state.mutation.mutateAsync).not.toHaveBeenCalled();
  await user.selectOptions(
    screen.getByLabelText('Dificultate (obligatoriu)'),
    '2',
  );
  await user.selectOptions(
    screen.getByLabelText('Calificativ (obligatoriu)'),
    '1',
  );
  expect(screen.getByRole('status')).toHaveTextContent('-4 puncte');
  await user.type(
    screen.getByLabelText('Notă (obligatoriu)'),
    '  De îmbunătățit  ',
  );
  await user.click(screen.getByRole('button', { name: 'Confirmă evaluarea' }));
  expect(state.mutation.mutateAsync).toHaveBeenCalledWith({
    taskId: 17,
    difficulty: 2,
    rating: 1,
    note: 'De îmbunătățit',
  });
});
it('retains entered values on conflict and is accessible', async () => {
  state.mutation.mutateAsync.mockRejectedValue(
    new Error('Taskul s-a schimbat.'),
  );
  const user = userEvent.setup();
  const { container } = render(<TaskEvaluationControl {...props} />);
  await user.click(screen.getByRole('button', { name: 'Evaluează taskul' }));
  await user.selectOptions(
    screen.getByLabelText('Dificultate (obligatoriu)'),
    '2',
  );
  await user.selectOptions(
    screen.getByLabelText('Calificativ (obligatoriu)'),
    '5',
  );
  await user.type(screen.getByLabelText('Notă (obligatoriu)'), 'Bravo');
  await user.click(screen.getByRole('button', { name: 'Confirmă evaluarea' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Taskul s-a schimbat.',
  );
  expect(screen.getByLabelText('Notă (obligatoriu)')).toHaveValue('Bravo');
  expect((await axe.run(container)).violations).toEqual([]);
});
it('prevents repeated submits while the first command is unresolved', async () => {
  state.mutation.mutateAsync.mockReturnValue(new Promise(() => {}));
  const user = userEvent.setup();
  render(<TaskEvaluationControl {...props} />);
  await user.click(screen.getByRole('button', { name: 'Evaluează taskul' }));
  await user.selectOptions(
    screen.getByLabelText('Dificultate (obligatoriu)'),
    '2',
  );
  await user.selectOptions(
    screen.getByLabelText('Calificativ (obligatoriu)'),
    '5',
  );
  await user.type(screen.getByLabelText('Notă (obligatoriu)'), 'Bravo');
  await user.dblClick(
    screen.getByRole('button', { name: 'Confirmă evaluarea' }),
  );
  expect(state.mutation.mutateAsync).toHaveBeenCalledTimes(1);
});
it('offers unfulfilled only for an authorized overdue unfinished Task', () => {
  const view = render(
    <TaskEvaluationControl {...props} status="todo" overdue={false} />,
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  view.rerender(<TaskEvaluationControl {...props} status="todo" overdue />);
  expect(
    screen.getByRole('button', { name: 'Marchează nerealizat' }),
  ).toBeInTheDocument();
  view.rerender(
    <TaskEvaluationControl {...props} status="completed" overdue />,
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  state.capability = false;
  view.rerender(<TaskEvaluationControl {...props} status="todo" overdue />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('submits the unfulfilled outcome through the shared evaluation form', async () => {
  const user = userEvent.setup();
  render(<TaskEvaluationControl {...props} status="in_progress" overdue />);
  await user.click(
    screen.getByRole('button', { name: 'Marchează nerealizat' }),
  );
  expect(
    screen.getByText(/păstrează încercarea în istoric/),
  ).toBeInTheDocument();
  await user.selectOptions(
    screen.getByLabelText('Dificultate (obligatoriu)'),
    '2',
  );
  await user.selectOptions(
    screen.getByLabelText('Calificativ (obligatoriu)'),
    '1',
  );
  await user.type(
    screen.getByLabelText('Notă (obligatoriu)'),
    'Termen depășit',
  );
  await user.click(screen.getByRole('button', { name: 'Confirmă evaluarea' }));
  expect(state.mutation.mutateAsync).toHaveBeenCalledWith({
    taskId: 17,
    difficulty: 2,
    rating: 1,
    note: 'Termen depășit',
    outcome: 'unfulfilled',
  });
});

it('announces and focuses success after the refetch changes status before mutation resolves', async () => {
  let finish!: () => void;
  state.mutation.mutateAsync.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const user = userEvent.setup();
  const view = render(<TaskEvaluationControl {...props} />);
  await user.click(screen.getByRole('button', { name: 'Evaluează taskul' }));
  await user.selectOptions(
    screen.getByLabelText('Dificultate (obligatoriu)'),
    '2',
  );
  await user.selectOptions(
    screen.getByLabelText('Calificativ (obligatoriu)'),
    '5',
  );
  await user.type(screen.getByLabelText('Notă (obligatoriu)'), 'Bravo');
  await user.click(screen.getByRole('button', { name: 'Confirmă evaluarea' }));
  view.rerender(<TaskEvaluationControl {...props} status="completed" />);
  await act(async () => finish());
  expect(screen.getByRole('status')).toHaveTextContent(
    'Evaluarea a fost salvată',
  );
  expect(screen.getByRole('status')).toHaveFocus();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  view.rerender(<TaskEvaluationControl {...props} />);
  expect(
    screen.getByRole('button', { name: 'Evaluează taskul' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('announces and focuses success for unfulfilled after the refetch changes status before mutation resolves', async () => {
  let finish!: () => void;
  state.mutation.mutateAsync.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const user = userEvent.setup();
  const view = render(
    <TaskEvaluationControl {...props} status="in_progress" overdue />,
  );
  await user.click(
    screen.getByRole('button', { name: 'Marchează nerealizat' }),
  );
  await user.selectOptions(
    screen.getByLabelText('Dificultate (obligatoriu)'),
    '2',
  );
  await user.selectOptions(
    screen.getByLabelText('Calificativ (obligatoriu)'),
    '5',
  );
  await user.type(screen.getByLabelText('Notă (obligatoriu)'), 'Bravo');
  await user.click(screen.getByRole('button', { name: 'Confirmă evaluarea' }));
  view.rerender(
    <TaskEvaluationControl {...props} status="unfulfilled" overdue />,
  );
  await act(async () => finish());
  expect(screen.getByRole('status')).toHaveTextContent(
    'Evaluarea a fost salvată',
  );
  expect(screen.getByRole('status')).toHaveFocus();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('preserves success when mutation resolves before the refetch changes status before mutation resolves', async () => {
  let finish!: () => void;
  state.mutation.mutateAsync.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const user = userEvent.setup();
  const view = render(<TaskEvaluationControl {...props} />);
  await user.click(screen.getByRole('button', { name: 'Evaluează taskul' }));
  await user.selectOptions(
    screen.getByLabelText('Dificultate (obligatoriu)'),
    '2',
  );
  await user.selectOptions(
    screen.getByLabelText('Calificativ (obligatoriu)'),
    '5',
  );
  await user.type(screen.getByLabelText('Notă (obligatoriu)'), 'Bravo');
  await user.click(screen.getByRole('button', { name: 'Confirmă evaluarea' }));
  await act(async () => finish());
  view.rerender(<TaskEvaluationControl {...props} status="completed" />);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Evaluarea a fost salvată',
  );
  expect(screen.getByRole('status')).toHaveFocus();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  view.rerender(<TaskEvaluationControl {...props} />);
  expect(
    screen.getByRole('button', { name: 'Evaluează taskul' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

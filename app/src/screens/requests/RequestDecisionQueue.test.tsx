import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import axe from 'axe-core';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const state = vi.hoisted(() => ({
  queue: vi.fn(),
  mutate: vi.fn(),
  guide: {
    isPending: false,
    isError: false,
    data: {
      ratings: [{ rating: 5, multiplier: 4, label: 'Excelent', note: null }],
      difficulties: [{ stars: 2, note: 'Ușor' }],
    },
  },
}));
vi.mock('../../queries/request-decisions', async (original) => ({
  ...(await original<object>()),
  usePendingDecisions: state.queue,
  useRequestDecision: () => ({ mutateAsync: state.mutate, isPending: false }),
}));
vi.mock('../../queries/scoring-guide', () => ({
  useScoringGuide: () => state.guide,
}));
import { RequestDecisionQueue } from './RequestDecisionQueue';
const request = {
  id: 7,
  requester_id: 'ana',
  requester_name: 'Ana Pop',
  group_id: 3,
  group_name: 'Ateliere',
  description: 'Am pregătit materialele.',
  created_at: '2026-09-19T12:00:00Z',
};
beforeEach(() => {
  state.queue.mockReturnValue({ data: [request] });
  state.mutate.mockResolvedValue({ id: 7 });
});
it('shares evaluation fields and retains success after the queue refetches empty', async () => {
  const user = userEvent.setup();
  let resolve: (value: unknown) => void = () => {};
  state.mutate.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(<RequestDecisionQueue />);
  await user.click(screen.getByRole('button', { name: 'Evaluează cererea' }));
  await user.click(screen.getByRole('button', { name: 'Aprobă cererea' }));
  expect(state.mutate).not.toHaveBeenCalled();
  await user.selectOptions(
    screen.getByLabelText('Dificultate (obligatoriu)'),
    '2',
  );
  await user.selectOptions(
    screen.getByLabelText('Calificativ (obligatoriu)'),
    '5',
  );
  await user.type(screen.getByLabelText('Notă (obligatoriu)'), 'Bine făcut');
  await user.dblClick(screen.getByRole('button', { name: 'Aprobă cererea' }));
  expect(state.mutate).toHaveBeenCalledTimes(1);
  expect(state.mutate).toHaveBeenCalledWith({
    kind: 'approve',
    requestId: 7,
    difficulty: 2,
    rating: 5,
    note: 'Bine făcut',
  });
  state.queue.mockReturnValue({ data: [] });
  view.rerender(<RequestDecisionQueue />);
  await act(async () => resolve({ id: 7 }));
  expect(screen.getByRole('status')).toHaveTextContent(
    'Cererea a fost aprobată',
  );
  expect(screen.getByRole('status')).toHaveFocus();
});
it('requires a rejection note, calls rejection only, and has no axe violations', async () => {
  const user = userEvent.setup();
  const { container } = render(<RequestDecisionQueue />);
  await user.click(screen.getByRole('button', { name: 'Respinge' }));
  expect(
    screen.getByRole('button', { name: 'Respinge cererea' }),
  ).toBeDisabled();
  await user.type(
    screen.getByLabelText('Motivul respingerii (obligatoriu)'),
    'Mai sunt necesare detalii',
  );
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'Respinge cererea' }));
  expect(state.mutate).toHaveBeenCalledWith({
    kind: 'reject',
    requestId: 7,
    note: 'Mai sunt necesare detalii',
  });
  expect(await screen.findByRole('status')).toHaveTextContent('respinsă');
});
it('has no decision actions when the live server queue is empty', () => {
  state.queue.mockReturnValue({ data: [] });
  render(<RequestDecisionQueue />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getByText(/Nu ai cereri în așteptare/)).toBeInTheDocument();
});
it('keeps the request and note on unexpected failure without leaking details', async () => {
  state.mutate.mockRejectedValue(new Error('private SQL'));
  render(<RequestDecisionQueue />);
  await userEvent.click(screen.getByRole('button', { name: 'Respinge' }));
  await userEvent.type(
    screen.getByLabelText('Motivul respingerii (obligatoriu)'),
    'Notă',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Respinge cererea' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Nu am putut salva decizia',
  );
  expect(screen.queryByText(/private SQL/)).not.toBeInTheDocument();
  expect(
    screen.getByLabelText('Motivul respingerii (obligatoriu)'),
  ).toHaveValue('Notă');
});

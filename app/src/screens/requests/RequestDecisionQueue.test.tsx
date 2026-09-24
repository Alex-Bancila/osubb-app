import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import axe from 'axe-core';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const state = vi.hoisted(() => ({
  queue: vi.fn(),
  mutate: vi.fn(),
  scale: {
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    data: {
      ratings: [{ rating: 5, multiplier: 4, label: 'Excelent' }],
      difficulties: [{ stars: 2, note: 'Ușor' }],
    },
  },
}));
vi.mock('../../queries/request-decisions', async (original) => ({
  ...(await original<object>()),
  usePendingDecisions: state.queue,
  useRequestDecision: () => ({ mutateAsync: state.mutate, isPending: false }),
}));
vi.mock('../../queries/reference', () => ({
  useEvaluationScale: () => state.scale,
}));
import { RequestDecisionQueue } from './RequestDecisionQueue';
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
vi.mock('../../lib/capabilities', () => ({
  useCapability: () => ({ data: false }),
}));
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
  await user.click(screen.getByRole('radio', { name: '2 — Ușor' }));
  await user.click(screen.getByRole('radio', { name: '5 — Excepțional' }));
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
  // Nothing is disabled before the first try; the rule shows under the field.
  await user.click(screen.getByRole('button', { name: 'Respinge cererea' }));
  expect(
    screen.getByLabelText('Motivul respingerii (obligatoriu)'),
  ).toHaveAccessibleDescription('Scrie o notă.');
  expect(state.mutate).not.toHaveBeenCalled();
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
it('stays hidden for a member with nothing to decide, including while it loads', () => {
  state.queue.mockReturnValue({ data: [] });
  const view = render(<RequestDecisionQueue />);
  expect(view.container).toBeEmptyDOMElement();
  state.queue.mockReturnValue({ isPending: true });
  view.rerender(<RequestDecisionQueue />);
  expect(view.container).toBeEmptyDOMElement();
});
it('offers a retry when the decision queue cannot be read', async () => {
  const refetch = vi.fn();
  state.queue.mockReturnValue({ isError: true, refetch });
  render(<RequestDecisionQueue />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Nu am putut încărca cererile de evaluat.',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }));
  expect(refetch).toHaveBeenCalled();
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
it('names the Requester by Nickname as a button that opens their Member Card', async () => {
  state.queue.mockReturnValue({
    data: [{ ...request, requester_nickname: 'Ani' }],
  });
  render(<RequestDecisionQueue />);
  const name = screen.getByRole('button', { name: 'Profilul membrului Ani' });
  expect(name.closest('p')).toHaveTextContent(/Ani\s*·\s*Ateliere$/);
  expect(name).not.toHaveTextContent('Ana Pop');
  await userEvent.click(name);
  expect(await screen.findByRole('dialog', { name: 'Ani' })).toBeVisible();
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import axe from 'axe-core';
const state = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock('../../queries/leadership', () => ({
  useLeadershipMemberTasks: state.history,
  useLeadershipMemberName: () => ({ data: 'Ioana Popescu' }),
}));
vi.mock('../../queries/task-tabs', () => ({
  useTaskLeadership: () => ({ data: true }),
}));
import MemberTrackerScreen from './MemberTrackerScreen';
const uid = '35400000-0000-0000-0000-000000000001';
function view(id = uid) {
  return render(
    <MemoryRouter initialEntries={[`/tracker/membru/${id}`]}>
      <main>
        <Routes>
          <Route path="/tracker/membru/:id" element={<MemberTrackerScreen />} />
        </Routes>
      </main>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  state.history.mockReturnValue({
    data: [
      {
        assignment_id: 1,
        title: 'Pregătește atelierul',
        status: 'completed',
        group_name: 'Educație',
        assigned_at: '2026-09-10T10:00:00Z',
        deadline: null,
        assignment_ended_at: '2026-09-12T10:00:00Z',
        assignment_end_reason: 'completed',
        evaluation_history: [
          {
            id: 2,
            outcome: 'completed',
            points: 12,
            difficulty: 3,
            rating: 4,
            note: 'Bine pregătit',
            evaluated_at: '2026-09-12T10:00:00Z',
            reversed_at: '2026-09-13T10:00:00Z',
            reversal_reason: 'Corecție',
          },
        ],
        subtasks: [{ id: 5, title: 'Materiale', status: 'completed' }],
      },
    ],
  });
});
it('uses the route member id and shows ended assignment plus reversed evaluation', async () => {
  const user = userEvent.setup();
  const { container } = view();
  expect(state.history).toHaveBeenCalledWith(uid);
  expect(
    screen.getByText(/Finalizat ·/, { selector: 'dd' }),
  ).toBeInTheDocument();
  await user.click(screen.getByText('Evaluări (1)'));
  expect(screen.getByText(/12 puncte · Evaluare anulată/)).toBeVisible();
  expect(screen.getByText(/Corecție/)).toBeVisible();
  await user.click(screen.getByText('Subtaskuri (1)'));
  expect(screen.getByText(/Materiale · Finalizat/)).toBeVisible();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});
it('does not query malformed member ids', () => {
  view('not-a-uuid');
  expect(screen.getByRole('heading')).toHaveTextContent('Membru indisponibil');
  expect(state.history).not.toHaveBeenCalled();
});
it('shows an ordinary empty history and a safe retriable error', async () => {
  state.history.mockReturnValue({ data: [] });
  const { unmount } = view();
  expect(screen.getByText(/Nu există atribuiri/)).toBeInTheDocument();
  unmount();
  const retry = vi.fn();
  state.history.mockReturnValue({
    isError: true,
    error: new Error('private SQL'),
    refetch: retry,
  });
  view();
  expect(screen.queryByText('private SQL')).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Reîncarcă istoricul' }),
  );
  expect(retry).toHaveBeenCalled();
});

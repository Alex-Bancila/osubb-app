import * as axe from 'axe-core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn() }));
vi.mock('../../queries/task-form-options', () => ({
  useTaskFormOptions: state.query,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import { ManagedTaskForm } from './ManagedTaskForm';
it('distinguishes loading, safe retryable failures, and no managed origins', async () => {
  state.query.mockReturnValue({ isPending: true });
  const view = render(<ManagedTaskForm onDraft={vi.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('Se încarcă');
  state.query.mockReturnValue({
    isError: true,
    error: new Error('internal detail'),
    refetch: state.refetch,
  });
  view.rerender(<ManagedTaskForm onDraft={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Nu am putut încărca');
  expect(screen.queryByText('internal detail')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }));
  expect(state.refetch).toHaveBeenCalledOnce();
  state.query.mockReturnValue({
    data: { groups: [], campaigns: [], umbrellas: [] },
  });
  view.rerender(<ManagedTaskForm onDraft={vi.fn()} />);
  expect(
    screen.getByText('Nu ai grupuri în care poți pregăti taskuri.'),
  ).toBeInTheDocument();
});

it('rechecks current origins before releasing a draft and preserves entered content on rejection', async () => {
  const options = {
    groups: [
      { id: 3, name: 'Origin', path: [3], min_level: 0, category: 'team' },
    ],
    campaigns: [],
    umbrellas: [],
  };
  state.query.mockReturnValue({ data: options, refetch: state.refetch });
  state.refetch.mockResolvedValue({ data: { ...options, groups: [] } });
  const onDraft = vi.fn();
  render(<ManagedTaskForm onDraft={onDraft} />);
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText('Titlu (obligatoriu)'),
    'Draft păstrat',
  );
  fireEvent.change(screen.getByLabelText(/Termen/), {
    target: { value: '2026-10-01T12:30' },
  });
  await user.selectOptions(screen.getByLabelText('Mod de atribuire'), 'public');
  await user.selectOptions(
    screen.getByLabelText('Grup de origine (obligatoriu)'),
    '3',
  );
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Nu mai poți pregăti');
  expect(screen.getByLabelText('Titlu (obligatoriu)')).toHaveValue(
    'Draft păstrat',
  );
});
it('maps authoritative submission errors and prevents duplicate commands while rechecking', async () => {
  const options = {
    groups: [
      { id: 3, name: 'Origin', path: [3], min_level: 0, category: 'team' },
    ],
    campaigns: [],
    umbrellas: [],
  };
  state.query.mockReturnValue({ data: options, refetch: state.refetch });
  let finish!: (value: { data: typeof options }) => void;
  state.refetch.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const onDraft = vi.fn().mockRejectedValue({
    code: '42501',
    message: 'task_manage_forbidden',
    details: 'private authority SQL',
  });
  const { container } = render(<ManagedTaskForm onDraft={onDraft} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Titlu (obligatoriu)'), 'Task');
  fireEvent.change(screen.getByLabelText(/Termen/), {
    target: { value: '2026-10-01T12:30' },
  });
  await user.selectOptions(screen.getByLabelText('Mod de atribuire'), 'public');
  await user.selectOptions(
    screen.getByLabelText('Grup de origine (obligatoriu)'),
    '3',
  );
  await user.dblClick(screen.getByRole('button', { name: 'Continuă' }));
  expect(state.refetch).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Continuă' })).toBeDisabled();
  await act(async () => finish({ data: options }));
  expect(onDraft).toHaveBeenCalledOnce();
  expect(screen.getByRole('alert')).toHaveTextContent('Nu mai ai permisiunea');
  expect(screen.queryByText('private authority SQL')).not.toBeInTheDocument();
  expect((await axe.run(container)).violations).toEqual([]);
  expect(screen.getByLabelText('Titlu (obligatoriu)')).toHaveValue('Task');
});
it('retains a draft while a background options read reports an error', async () => {
  const options = {
    groups: [
      { id: 3, name: 'Origin', path: [3], min_level: 0, category: 'team' },
    ],
    campaigns: [],
    umbrellas: [],
  };
  state.query.mockReturnValue({ data: options, refetch: state.refetch });
  const view = render(<ManagedTaskForm onDraft={vi.fn()} />);
  await userEvent.type(
    screen.getByLabelText('Titlu (obligatoriu)'),
    'Nu pierde textul',
  );
  state.query.mockReturnValue({
    data: options,
    isError: true,
    refetch: state.refetch,
  });
  view.rerender(<ManagedTaskForm onDraft={vi.fn()} />);
  expect(screen.getByLabelText('Titlu (obligatoriu)')).toHaveValue(
    'Nu pierde textul',
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Nu am putut încărca');
});

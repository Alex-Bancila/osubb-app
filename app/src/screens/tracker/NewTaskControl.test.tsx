import * as axe from 'axe-core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  management: vi.fn(),
  formOptions: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: state.rpc } }));
vi.mock('../../queries/task-tabs', () => ({
  useTaskManagement: state.management,
}));
vi.mock('../../queries/task-form-options', () => ({
  useTaskFormOptions: state.formOptions,
}));
vi.mock('./DirectExecutorSelector', () => ({
  DirectExecutorSelector: ({
    value,
    onChange,
  }: {
    value: string | null;
    onChange: (id: string | null) => void;
  }) => (
    <button type="button" onClick={() => onChange('executor-1')}>
      {value ? `Executor ales: ${value}` : 'Alege Executorul'}
    </button>
  ),
}));
import { NewTaskControl } from './NewTaskControl';

const options = {
  groups: [
    { id: 3, name: 'Origin', path: [1, 3], min_level: 0 },
    { id: 4, name: 'Alt grup', path: [4], min_level: 0 },
  ],
  campaigns: [
    { id: 7, name: 'Campania de toamnă', group_id: 1 },
    { id: 8, name: 'Campanie străină', group_id: 4 },
  ],
  umbrellas: [],
  groupNames: [{ id: 1, name: 'Părinte' }],
};

function renderControl(onCreated = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <NewTaskControl onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return { onCreated, user: userEvent.setup() };
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Task nou' }));
  return screen.findByRole('dialog', { name: 'Task nou' });
}

async function pickOrigin(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('combobox', { name: 'Grup de origine (obligatoriu)' }),
  );
  await user.click(await screen.findByRole('option', { name: /^Origin/ }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

async function fillContent(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
  deadline: string | null = '2026-10-01T12:30',
) {
  await user.type(screen.getByLabelText('Titlu (obligatoriu)'), title);
  if (deadline)
    fireEvent.change(screen.getByLabelText(/Termen/), {
      target: { value: deadline },
    });
}

describe('Task nou', () => {
  beforeEach(() => {
    state.management.mockReturnValue({ data: true });
    state.formOptions.mockReturnValue({
      data: options,
      refetch: state.refetch,
    });
    state.refetch.mockResolvedValue({ data: options });
  });

  it.each([
    ['while the check loads', { isPending: true }],
    ['when the check fails', { isError: true }],
    ['for a member who manages no Group', { data: false }],
  ])('is hidden %s', (_label, result) => {
    state.management.mockReturnValue(result);
    renderControl();
    expect(screen.queryByRole('button', { name: 'Task nou' })).toBeNull();
  });

  it('offers a Task or an Umbrella, never a Subtask, in an accessible Dialog', async () => {
    const { user } = renderControl();
    const dialog = await openDialog(user);
    expect(screen.getByRole('radio', { name: 'Task' })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Task-umbrelă' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Subtask' })).toBeNull();
    const results = await axe.run(dialog, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it('returns focus to "Task nou" when the Dialog is cancelled', async () => {
    const { user } = renderControl();
    await openDialog(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Task nou' })).toHaveFocus();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('creates a direct Task with its Executor and Campaign, then opens it', async () => {
    state.rpc.mockResolvedValue({ data: { id: 41 }, error: null });
    const { user, onCreated } = renderControl();
    await openDialog(user);
    await pickOrigin(user);
    await fillContent(user, 'Afișe pentru târg');
    await user.click(screen.getByRole('button', { name: 'Alege Executorul' }));
    await user.selectOptions(
      screen.getByLabelText('Campanie (opțional)'),
      'Campania de toamnă',
    );
    expect(
      screen.queryByRole('option', { name: 'Campanie străină' }),
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Creează taskul' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(41));
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc).toHaveBeenCalledWith('create_task', {
      p_group_id: 3,
      p_kind: 'task',
      p_parent_task_id: null,
      p_executor_id: 'executor-1',
      p_campaign_id: 7,
      p_audience: 'local',
      p_assignment_mode: 'direct',
      p_title: 'Afișe pentru târg',
      p_description: null,
      p_deadline: expect.any(String),
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('creates a public Task for all eligible OSUBB members', async () => {
    state.rpc.mockResolvedValue({ data: { id: 42 }, error: null });
    const { user, onCreated } = renderControl();
    await openDialog(user);
    await pickOrigin(user);
    await fillContent(user, 'Voluntari la stand');
    await user.selectOptions(
      screen.getByLabelText('Mod de atribuire'),
      'public',
    );
    await user.selectOptions(screen.getByLabelText('Audiență'), 'org');
    await user.click(screen.getByRole('button', { name: 'Creează taskul' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(42));
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_group_id: 3,
      p_kind: 'task',
      p_assignment_mode: 'public',
      p_audience: 'org',
      p_executor_id: null,
    });
  });

  it('creates an Umbrella without a mode, audience or deadline', async () => {
    state.rpc.mockResolvedValue({ data: { id: 43 }, error: null });
    const { user, onCreated } = renderControl();
    await openDialog(user);
    await user.click(screen.getByRole('radio', { name: 'Task-umbrelă' }));
    await pickOrigin(user);
    await fillContent(user, 'Târgul de cariere', null);
    await user.click(screen.getByRole('button', { name: 'Creează taskul' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(43));
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc.mock.calls[0]?.[1]).toEqual({
      p_group_id: 3,
      p_kind: 'umbrella',
      p_parent_task_id: null,
      p_executor_id: null,
      p_campaign_id: null,
      p_audience: null,
      p_assignment_mode: null,
      p_title: 'Târgul de cariere',
      p_description: null,
      p_deadline: null,
    });
  });

  it('keeps the Dialog open with the draft intact when the server refuses', async () => {
    state.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'PT400',
        message: 'invalid_executor',
        details: 'private SQL detail',
      },
    });
    const { user, onCreated } = renderControl();
    await openDialog(user);
    await pickOrigin(user);
    await fillContent(user, 'Draft păstrat');
    await user.click(screen.getByRole('button', { name: 'Alege Executorul' }));
    await user.click(screen.getByRole('button', { name: 'Creează taskul' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Executorul nu mai este eligibil',
    );
    expect(screen.queryByText('private SQL detail')).toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Task nou' })).toBeVisible();
    expect(screen.getByLabelText('Titlu (obligatoriu)')).toHaveValue(
      'Draft păstrat',
    );
    expect(
      screen.getByRole('button', { name: 'Executor ales: executor-1' }),
    ).toBeInTheDocument();
  });

  it('blocks a draft the UI can already tell is invalid, without calling the server', async () => {
    const { user } = renderControl();
    await openDialog(user);
    await fillContent(user, 'Fără grup');
    await user.click(screen.getByRole('button', { name: 'Creează taskul' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Alege exact un grup de origine.',
    );
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

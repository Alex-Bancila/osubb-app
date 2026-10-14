import * as axe from 'axe-core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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
    label = 'Executor',
    value,
    onChange,
  }: {
    label?: string;
    value: string | null;
    onChange: (id: string | null) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange(label === 'Executor' ? 'executor-1' : `${label}-ales`)
      }
    >
      {value ? `${label} ales: ${value}` : `Alege ${label}`}
    </button>
  ),
}));
import { pickDate } from '../../test/date-picker';
import { NewTaskControl } from './NewTaskControl';
// A deadline next month: always in the future, and one page away in the
// date picker.
const nextMonth = new Date();
nextMonth.setUTCDate(1);
nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
const DEADLINE = `${nextMonth.toISOString().slice(0, 7)}-15T12:30`;

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
  await user.click(screen.getByRole('combobox', { name: 'Grup principal' }));
  await user.click(await screen.findByRole('option', { name: /^Origin/ }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

async function fillContent(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
  deadline: string | null = DEADLINE,
) {
  await user.type(screen.getByLabelText('Titlu'), title);
  if (deadline) await pickDate(user, screen.getByLabelText(/Termen/), deadline);
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

  it('offers a Task or an Umbrella, never a Subtask, in an accessible form sheet', async () => {
    const { user } = renderControl();
    const dialog = await openDialog(user);
    // A form sheet titled by what it makes, with no intro paragraph…
    expect(dialog).toHaveAttribute('data-slot', 'form-sheet');
    expect(dialog).not.toHaveTextContent(/Creează un task sau/);
    expect(dialog).not.toHaveAccessibleDescription();
    // …and its actions pinned: Renunță first, the primary last.
    const footer = dialog.querySelector<HTMLElement>(
      '[data-slot="sheet-footer"][data-pinned]',
    );
    expect(footer).not.toBeNull();
    expect(
      within(footer as HTMLElement)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Renunță', 'Creează taskul']);
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

  it('returns focus to "Task nou" when the sheet is cancelled', async () => {
    const { user } = renderControl();
    await openDialog(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Task nou' })).toHaveFocus();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('creates a direct Task with its Executor and Campaign, then opens it', async () => {
    state.rpc.mockResolvedValue({ data: [{ id: 41 }], error: null });
    const { user, onCreated } = renderControl();
    await openDialog(user);
    await pickOrigin(user);
    await fillContent(user, 'Afișe pentru târg');
    await user.click(screen.getByRole('button', { name: 'Alege Executor' }));
    // Another Group's Campaign is not in the list.
    await user.click(screen.getByLabelText('Campanie (opțional)'));
    expect(
      (await screen.findAllByRole('option')).map(
        (option) => option.textContent,
      ),
    ).toEqual(['Fără campanie', 'Campania de toamnă']);
    await user.click(
      screen.getByRole('option', { name: 'Campania de toamnă' }),
    );
    await user.click(screen.getByRole('button', { name: 'Creează taskul' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ ids: [41] }));
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc).toHaveBeenCalledWith('create_tasks', {
      p_group_id: 3,
      p_kind: 'task',
      p_parent_task_id: null,
      // R46: the links only, never the old pair.
      p_links: [],
      p_executor_ids: ['executor-1'],
      p_copies: 1,
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
    state.rpc.mockResolvedValue({ data: [{ id: 42 }], error: null });
    const { user, onCreated } = renderControl();
    await openDialog(user);
    await pickOrigin(user);
    await fillContent(user, 'Voluntari la stand');
    await user.click(screen.getByRole('radio', { name: 'Public' }));
    await user.click(screen.getByRole('radio', { name: 'Toți membrii OSUBB' }));
    await user.click(screen.getByRole('button', { name: 'Creează taskul' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ ids: [42] }));
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_group_id: 3,
      p_kind: 'task',
      p_assignment_mode: 'public',
      p_audience: 'org',
      p_executor_ids: null,
      p_copies: 1,
    });
  });

  it('creates an Umbrella without a mode, audience or deadline', async () => {
    state.rpc.mockResolvedValue({ data: [{ id: 43 }], error: null });
    const { user, onCreated } = renderControl();
    await openDialog(user);
    await user.click(screen.getByRole('radio', { name: 'Task-umbrelă' }));
    await pickOrigin(user);
    await fillContent(user, 'Târgul de cariere', null);
    await user.click(screen.getByRole('button', { name: 'Creează taskul' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ ids: [43] }));
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc.mock.calls[0]?.[1]).toEqual({
      p_group_id: 3,
      p_kind: 'umbrella',
      p_parent_task_id: null,
      // R46: the links only, never the old pair.
      p_links: [],
      p_executor_ids: null,
      p_copies: 1,
      p_campaign_id: null,
      p_audience: null,
      p_assignment_mode: null,
      p_title: 'Târgul de cariere',
      p_description: null,
      p_deadline: null,
    });
  });

  it('keeps the sheet open with the draft intact when the server refuses', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Alege Executor' }));
    await user.click(screen.getByRole('button', { name: 'Creează taskul' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Executorul nu mai este eligibil',
    );
    expect(screen.queryByText('private SQL detail')).toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Task nou' })).toBeVisible();
    expect(screen.getByLabelText('Titlu')).toHaveValue('Draft păstrat');
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

describe('Task nou, n copies (spec 2026-10-11)', () => {
  beforeEach(() => {
    state.management.mockReturnValue({ data: true });
    state.formOptions.mockReturnValue({
      data: options,
      refetch: state.refetch,
    });
    state.refetch.mockResolvedValue({ data: options });
    state.rpc.mockReset();
  });

  it('creates three public copies and reports them without opening one', async () => {
    state.rpc.mockResolvedValue({
      data: [{ id: 51 }, { id: 52 }, { id: 53 }],
      error: null,
    });
    const { user, onCreated } = renderControl();
    await openDialog(user);
    await pickOrigin(user);
    await fillContent(user, 'Voluntari la trei standuri');
    await user.click(screen.getByRole('radio', { name: 'Public' }));
    const copies = screen.getByLabelText('Exemplare');
    await user.clear(copies);
    await user.type(copies, '3');
    await user.click(screen.getByRole('button', { name: 'Creează 3 taskuri' }));
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({ ids: [51, 52, 53] }),
    );
    expect(state.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_copies: 3,
      p_executor_ids: null,
      p_assignment_mode: 'public',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('asks for one Executor per direct copy, then creates them all at once', async () => {
    state.rpc.mockResolvedValue({
      data: [{ id: 61 }, { id: 62 }],
      error: null,
    });
    const { user, onCreated } = renderControl();
    await openDialog(user);
    await pickOrigin(user);
    await fillContent(user, 'Două afișe');
    const copies = screen.getByLabelText('Exemplare');
    await user.clear(copies);
    await user.type(copies, '2');
    expect(screen.queryByRole('button', { name: 'Alege Executor' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Continuă' }));
    const step = await screen.findByRole('dialog', {
      name: 'Executorii celor 2 taskuri',
    });
    expect(state.rpc).not.toHaveBeenCalled();
    await user.click(
      within(step).getByRole('button', { name: 'Alege Exemplarul 1' }),
    );
    await user.click(
      within(step).getByRole('button', { name: 'Alege Exemplarul 2' }),
    );
    await user.click(
      within(step).getByRole('button', { name: 'Creează 2 taskuri' }),
    );
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({ ids: [61, 62] }),
    );
    expect(state.rpc).toHaveBeenCalledWith(
      'create_tasks',
      expect.objectContaining({
        p_copies: 2,
        p_assignment_mode: 'direct',
        p_executor_ids: ['Exemplarul 1-ales', 'Exemplarul 2-ales'],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('returns to the form with the draft intact when the executors step is dismissed', async () => {
    const { user, onCreated } = renderControl();
    await openDialog(user);
    await pickOrigin(user);
    await fillContent(user, 'Draft cu două exemplare');
    const copies = screen.getByLabelText('Exemplare');
    await user.clear(copies);
    await user.type(copies, '2');
    await user.click(screen.getByRole('button', { name: 'Continuă' }));
    const step = await screen.findByRole('dialog', {
      name: 'Executorii celor 2 taskuri',
    });
    // The step takes Escape once it holds the focus; on a slow runner it is
    // in the DOM a moment before that.
    await waitFor(() =>
      expect(step.contains(document.activeElement)).toBe(true),
    );
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Executorii/ })).toBeNull(),
    );
    expect(screen.getByRole('dialog', { name: 'Task nou' })).toBeVisible();
    expect(screen.getByLabelText('Titlu')).toHaveValue(
      'Draft cu două exemplare',
    );
    expect(screen.getByLabelText('Exemplare')).toHaveValue(2);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('shows a refusal inside the executors step and keeps it open', async () => {
    state.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PT400', message: 'invalid_executor' },
    });
    const { user } = renderControl();
    await openDialog(user);
    await pickOrigin(user);
    await fillContent(user, 'Refuzat');
    const copies = screen.getByLabelText('Exemplare');
    await user.clear(copies);
    await user.type(copies, '2');
    await user.click(screen.getByRole('button', { name: 'Continuă' }));
    const step = await screen.findByRole('dialog', {
      name: 'Executorii celor 2 taskuri',
    });
    await user.click(
      within(step).getByRole('button', { name: 'Alege Exemplarul 1' }),
    );
    await user.click(
      within(step).getByRole('button', { name: 'Alege Exemplarul 2' }),
    );
    await user.click(
      within(step).getByRole('button', { name: 'Creează 2 taskuri' }),
    );
    expect(await within(step).findByRole('alert')).toHaveTextContent(
      'Executorul nu mai este eligibil',
    );
    expect(
      screen.getByRole('dialog', { name: 'Executorii celor 2 taskuri' }),
    ).toBeVisible();
  });
});

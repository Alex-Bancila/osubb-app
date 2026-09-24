vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { expect, it, vi } from 'vitest';
import { TaskForm } from './TaskForm';
// Each case walks several dropdowns end to end; on a loaded machine that can
// pass the 5 s default without anything being wrong.
vi.setConfig({ testTimeout: 15_000 });
import type { TaskFormOptions } from './task-form-model';
vi.mock('../../queries/direct-executors', async (original) => ({
  ...(await original<typeof import('../../queries/direct-executors')>()),
  useDirectExecutors: () => ({
    isSuccess: true,
    data: {
      members: [{ id: 'ana', name: 'Ana Pop', level: 3, avatarColor: null }],
      groups: [
        {
          id: 3,
          name: 'Echipa afișe',
          path: [1, 2, 3],
          min_level: 1,
          automatic_membership: false,
          status: 'active',
        },
        {
          id: 4,
          name: 'Tineret',
          path: [4],
          min_level: 0,
          automatic_membership: false,
          status: 'active',
        },
      ],
      memberships: [],
    },
  }),
}));
const options: TaskFormOptions = {
  groups: [
    { id: 2, name: 'Conferință', path: [1, 2], min_level: 1 },
    { id: 3, name: 'Echipa afișe', path: [1, 2, 3], min_level: 1 },
    { id: 4, name: 'Tineret', path: [4], min_level: 0 },
  ],
  campaigns: [
    { id: 10, name: 'Campanie părinte', group_id: 1 },
    { id: 11, name: 'Campanie proprie', group_id: 3 },
    { id: 12, name: 'Altă origine', group_id: 4 },
  ],
  umbrellas: [
    { id: 30, title: 'Pregătește conferința', group_id: 3 },
    { id: 31, title: 'Tabăra de vară', group_id: 4 },
  ],
  // Educațional is readable but not managed: it still names its child.
  groupNames: [{ id: 1, name: 'Educațional' }],
};
type User = ReturnType<typeof userEvent.setup>;
const groupBox = () =>
  screen.getByRole('combobox', { name: 'Grup principal (obligatoriu)' });
const subgroupBox = () =>
  screen.getByRole('combobox', { name: 'Subgrup (opțional)' });
const parentBox = () =>
  screen.getByRole('combobox', { name: 'Task-umbrelă (obligatoriu)' });
const optionTexts = () =>
  within(screen.getByRole('listbox'))
    .getAllByRole('option')
    .map((option) => option.textContent);
async function pick(user: User, box: HTMLElement, name: RegExp | string) {
  await user.click(box);
  await user.click(await screen.findByRole('option', { name }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}
/** The Origin through the cascade: a root, then optionally a Group below. */
async function chooseOrigin(user: User, root: string, below?: RegExp) {
  await pick(user, groupBox(), new RegExp(`^${root}`));
  if (below) await pick(user, subgroupBox(), below);
}
async function content() {
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText('Titlu (obligatoriu)'),
    '  Pregătește afișele  ',
  );
  fireEvent.change(screen.getByLabelText(/Termen/), {
    target: { value: '2030-10-01T12:30' },
  });
  return user;
}
it('picks the Origin as a root Group, then a Group below it, and emits a trimmed direct draft', async () => {
  const onDraft = vi.fn();
  const { container } = render(
    <TaskForm options={options} onDraft={onDraft} />,
  );
  const user = await content();
  // Only Groups with no managed ancestor are roots; nothing below yet.
  expect(
    screen.queryByRole('combobox', { name: 'Subgrup (opțional)' }),
  ).not.toBeInTheDocument();
  await user.click(groupBox());
  await screen.findByRole('listbox');
  expect(optionTexts()).toEqual(['Conferință· Educațional', 'Tineret']);
  await user.type(
    await screen.findByRole('combobox', { name: 'Caută un grup principal' }),
    'conf',
  );
  await waitFor(() =>
    expect(optionTexts()).toEqual(['Conferință· Educațional']),
  );
  await user.click(screen.getByRole('option', { name: /^Conferință/ }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  expect(groupBox()).toHaveTextContent('Conferință');
  expect(subgroupBox()).toHaveTextContent('Doar grupul principal');
  await user.click(subgroupBox());
  await screen.findByRole('listbox');
  expect(optionTexts()).toEqual([
    'Doar grupul principal',
    'Echipa afișe· Conferință',
  ]);
  await user.click(screen.getByRole('option', { name: /^Echipa afișe/ }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  expect(subgroupBox()).toHaveTextContent('Echipa afișe');
  expect(groupBox()).toHaveTextContent('Conferință');
  const campaign = screen.getByLabelText('Campanie (opțional)');
  expect(campaign).toHaveAccessibleDescription(/etichetă pentru raportare/i);
  expect(
    screen.getByRole('option', { name: 'Campanie părinte' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('option', { name: 'Altă origine' }),
  ).not.toBeInTheDocument();
  await user.selectOptions(campaign, '10');
  await pick(
    user,
    screen.getByRole('combobox', { name: 'Executor' }),
    'Ana Pop',
  );
  expect(screen.queryByLabelText(/Dificultate/)).not.toBeInTheDocument();
  expect((await axe.run(container)).violations).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledWith({
    title: 'Pregătește afișele',
    description: null,
    deadline: '2030-10-01T09:30:00.000Z',
    groupId: 3,
    kind: 'task',
    parentTaskId: null,
    audience: 'local',
    assignmentMode: 'direct',
    executorId: 'ana',
    campaignId: 10,
    link: { label: null, url: null },
  });
});
it("disables the organization-wide Audience for a Private Group's Task, with the reason (#757)", async () => {
  const onDraft = vi.fn();
  const { container } = render(
    <TaskForm
      options={{
        ...options,
        groupNames: [
          { id: 1, name: 'Educațional' },
          { id: 4, name: 'Tineret', is_private: true },
        ],
      }}
      onDraft={onDraft}
    />,
  );
  const user = await content();
  // A public Origin first, with the organization-wide Audience chosen.
  await chooseOrigin(user, 'Conferință');
  const audience = screen.getByLabelText('Audiență');
  expect(
    within(audience).getByRole('option', {
      name: 'Toți membrii eligibili OSUBB',
    }),
  ).toBeEnabled();
  await user.selectOptions(audience, 'org');

  await chooseOrigin(user, 'Tineret');
  const org = within(audience).getByRole('option', {
    name: 'Toți membrii eligibili OSUBB',
  });
  expect(org).toBeDisabled();
  expect(audience).toHaveValue('local');
  expect(
    screen.getByText(
      'Grupul este privat: taskurile lui sunt doar pentru membrii grupului.',
    ),
  ).toBeVisible();
  expect((await axe.run(container)).violations).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({ groupId: 4, audience: 'local' }),
  );
});
it('sends only the root when no Group below is chosen, and starts on the one root there is', async () => {
  const onDraft = vi.fn();
  const view = render(<TaskForm options={options} onDraft={onDraft} />);
  const user = await content();
  await chooseOrigin(user, 'Conferință', /^Echipa afișe/);
  await pick(user, subgroupBox(), 'Doar grupul principal');
  await user.selectOptions(screen.getByLabelText('Mod de atribuire'), 'public');
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenLastCalledWith(
    expect.objectContaining({ groupId: 2 }),
  );
  view.unmount();

  // A Responsible of one Team sees that Team as their root, already chosen.
  const team = {
    ...options,
    groups: options.groups.filter((group) => group.id === 3),
  };
  render(<TaskForm options={team} onDraft={onDraft} />);
  expect(groupBox()).toHaveTextContent('Echipa afișe');
  expect(
    screen.queryByRole('combobox', { name: 'Subgrup (opțional)' }),
  ).not.toBeInTheDocument();
});
it('keeps a Campaign that can still tag the new Group and clears one that cannot', async () => {
  const onDraft = vi.fn();
  render(<TaskForm options={options} onDraft={onDraft} />);
  const user = await content();
  await chooseOrigin(user, 'Conferință', /^Echipa afișe/);
  const campaign = () => screen.getByLabelText('Campanie (opțional)');
  expect(
    within(campaign())
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['Fără campanie', 'Campanie părinte', 'Campanie proprie']);
  await user.selectOptions(campaign(), '10');
  await pick(user, subgroupBox(), 'Doar grupul principal');
  expect(campaign()).toHaveValue('10');
  await pick(user, subgroupBox(), /^Echipa afișe/);
  await user.selectOptions(campaign(), '11');
  await pick(user, subgroupBox(), 'Doar grupul principal');
  expect(campaign()).toHaveValue('');
});
it('sends the Attached Link, checks it as a pair on blur and submit, and puts the server’s reason under it', async () => {
  const onDraft = vi
    .fn()
    .mockRejectedValueOnce({ code: 'PT400', message: 'link_url_invalid' })
    .mockResolvedValue(undefined);
  const { container } = render(
    <TaskForm options={options} onDraft={onDraft} />,
  );
  const user = await content();
  await chooseOrigin(user, 'Tineret');
  await user.selectOptions(screen.getByLabelText('Mod de atribuire'), 'public');
  const label = screen.getByLabelText('Etichetă link');
  const url = screen.getByLabelText('Adresă link');
  await user.type(label, 'l'.repeat(61));
  await user.tab();
  expect(label).toHaveAccessibleDescription(
    'Numele linkului are cel mult 60 de caractere.',
  );
  await user.clear(label);
  await user.type(label, 'Brief');
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).not.toHaveBeenCalled();
  expect(url).toHaveAccessibleDescription(
    /Scrie adresa linkului sau lasă linkul gol./,
  );
  expect(url).toHaveFocus();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
  await user.type(url, 'ftp://example.org');
  await user.tab();
  expect(url).toHaveAccessibleDescription(
    /Adresa trebuie să înceapă cu http:\/\/ sau https:\/\//,
  );
  await user.clear(url);
  await user.type(url, 'https://example.org/brief');
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({
      link: { label: 'Brief', url: 'https://example.org/brief' },
    }),
  );
  // The server's refusal of the same rule lands under the same field.
  await waitFor(() =>
    expect(url).toHaveAccessibleDescription(
      /Adresa trebuie să înceapă cu http:\/\/ sau https:\/\//,
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledTimes(2);
});
it('clears the Executor on public mode and clears incompatible Campaigns after Origin changes', async () => {
  const onDraft = vi.fn();
  render(<TaskForm options={options} onDraft={onDraft} />);
  const user = await content();
  await chooseOrigin(user, 'Conferință', /^Echipa afișe/);
  await user.selectOptions(screen.getByLabelText('Campanie (opțional)'), '10');
  await pick(
    user,
    screen.getByRole('combobox', { name: 'Executor' }),
    'Ana Pop',
  );
  await user.selectOptions(screen.getByLabelText('Mod de atribuire'), 'public');
  expect(
    screen.queryByRole('combobox', { name: 'Executor' }),
  ).not.toBeInTheDocument();
  await pick(user, groupBox(), 'Tineret');
  expect(screen.getByLabelText('Campanie (opțional)')).toHaveValue('');
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
it('tells a Task-umbrelă (a parent of Subtasks) apart from a Campaign (a reporting label)', async () => {
  render(<TaskForm options={options} onDraft={vi.fn()} />);
  const user = userEvent.setup();
  const kind = screen.getByRole('radiogroup', { name: 'Ce fel de task?' });
  expect(kind).toBeInTheDocument();
  expect(
    screen.getByRole('radio', { name: 'Task-umbrelă' }),
  ).toHaveAccessibleDescription(/task părinte care grupează subtaskuri/i);
  expect(
    screen.getByRole('radio', { name: 'Subtask' }),
  ).toHaveAccessibleDescription(/parte dintr-un task-umbrelă/i);
  await user.click(screen.getByRole('radio', { name: 'Task-umbrelă' }));
  expect(
    screen.queryByLabelText('Campanie (opțional)'),
  ).not.toBeInTheDocument();
});
it('offers only the chosen Group’s Umbrellas as Subtask parents, and a parent sets the Group', async () => {
  const onDraft = vi.fn();
  render(<TaskForm options={options} onDraft={onDraft} />);
  const user = await content();
  await user.click(screen.getByRole('radio', { name: 'Subtask' }));
  await user.click(parentBox());
  await screen.findByRole('listbox');
  expect(optionTexts()).toEqual([
    'Pregătește conferința· Echipa afișe',
    'Tabăra de vară· Tineret',
  ]);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());

  await pick(user, groupBox(), 'Tineret');
  await user.click(parentBox());
  await screen.findByRole('listbox');
  expect(optionTexts()).toEqual(['Tabăra de vară']);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());

  await chooseOrigin(user, 'Conferință', /^Echipa afișe/);
  await pick(user, parentBox(), 'Pregătește conferința');
  await pick(user, groupBox(), 'Tineret');
  expect(parentBox()).toHaveTextContent('Alege taskul-umbrelă');
  await pick(user, parentBox(), 'Tabăra de vară');
  expect(groupBox()).toHaveTextContent('Tineret');
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'task', parentTaskId: 31, groupId: 4 }),
  );
});
it('locks Subtask Origin to a live parent and cannot create nested Umbrellas', async () => {
  const onDraft = vi.fn();
  render(<TaskForm options={options} onDraft={onDraft} parentTaskId={30} />);
  const user = await content();
  expect(screen.getByRole('radio', { name: 'Task-umbrelă' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  expect(parentBox()).toBeDisabled();
  expect(parentBox()).toHaveTextContent('Pregătește conferința');
  expect(groupBox()).toBeDisabled();
  expect(groupBox()).toHaveTextContent('Conferință');
  expect(subgroupBox()).toBeDisabled();
  expect(subgroupBox()).toHaveTextContent('Echipa afișe');
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
  await chooseOrigin(user, 'Conferință', /^Echipa afișe/);
  await user.click(screen.getByRole('radio', { name: 'Task-umbrelă' }));
  expect(screen.queryByLabelText('Mod de atribuire')).not.toBeInTheDocument();
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
  const deadline = screen.getByLabelText(/Termen/);
  fireEvent.change(deadline, { target: { value: '2027-03-28T03:30' } });
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(deadline).toHaveAccessibleDescription(
    'Alege un termen valid, în ora României.',
  );
  fireEvent.change(deadline, { target: { value: '2030-10-01T12:30' } });
  view.rerender(
    <TaskForm
      options={{ ...options, umbrellas: [] }}
      onDraft={onDraft}
      parentTaskId={30}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(
    screen.getByText(
      'Taskul-umbrelă nu mai este disponibil. Alege alt părinte.',
    ),
  ).toHaveAttribute('role', 'alert');
  expect(onDraft).not.toHaveBeenCalled();
});
it('checks a field when it loses focus, without disabling anything first', async () => {
  const onDraft = vi.fn();
  render(<TaskForm options={options} onDraft={onDraft} />);
  const user = userEvent.setup();
  const title = screen.getByLabelText('Titlu (obligatoriu)');
  // Nothing is judged, and nothing disabled, before the member tries.
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continuă' })).toBeEnabled();
  await user.type(title, 'ab');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await user.tab();
  expect(title).toHaveAttribute('aria-invalid', 'true');
  expect(title).toHaveAccessibleDescription(
    'Titlul are cel puțin 3 caractere.',
  );
  // Editing hides the verdict on the old value; the next blur judges again.
  await user.type(title, 'c');
  expect(title).not.toHaveAttribute('aria-invalid');
  await user.tab();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('checks the whole draft on submit, focuses the first broken field and never sends 121 characters', async () => {
  const onDraft = vi.fn();
  const { container } = render(
    <TaskForm options={options} onDraft={onDraft} />,
  );
  const user = userEvent.setup();
  const title = screen.getByLabelText('Titlu (obligatoriu)');
  fireEvent.change(title, { target: { value: 't'.repeat(121) } });
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).not.toHaveBeenCalled();
  // Every rule broken, each under its own field; the first one has focus.
  expect(
    screen.getByText('Alege exact un grup de origine.'),
  ).toBeInTheDocument();
  expect(title).toHaveAccessibleDescription(
    'Titlul are cel mult 120 de caractere.',
  );
  expect(screen.getByLabelText(/Termen/)).toHaveAccessibleDescription(
    'Alege termenul taskului.',
  );
  expect(groupBox()).toHaveFocus();
  expect(groupBox()).toHaveAttribute('aria-invalid', 'true');
  expect(groupBox()).toHaveAccessibleDescription(
    'Alege exact un grup de origine.',
  );
  expect((await axe.run(container)).violations).toEqual([]);

  fireEvent.change(title, { target: { value: '  Titlu  ' } });
  fireEvent.change(screen.getByLabelText(/Termen/), {
    target: { value: '2030-10-01T12:30' },
  });
  await pick(user, groupBox(), 'Tineret');
  await user.selectOptions(screen.getByLabelText('Mod de atribuire'), 'public');
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Titlu', groupId: 4 }),
  );
});
it('puts a server refusal under the field it names, and the rest above the button', async () => {
  const onDraft = vi
    .fn()
    .mockRejectedValueOnce({
      code: 'PT400',
      message: 'title_too_long',
      details: 'private SQL',
    })
    .mockRejectedValueOnce({ code: '42501', message: 'task_manage_forbidden' });
  render(<TaskForm options={options} onDraft={onDraft} />);
  const user = await content();
  await pick(user, groupBox(), 'Tineret');
  await user.selectOptions(screen.getByLabelText('Mod de atribuire'), 'public');
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  const title = screen.getByLabelText('Titlu (obligatoriu)');
  await waitFor(() =>
    expect(title).toHaveAccessibleDescription(
      'Titlul are cel mult 120 de caractere.',
    ),
  );
  expect(title).toHaveFocus();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Titlul are cel mult 120 de caractere.',
  );
  expect(screen.queryByText(/private|title_too_long/)).not.toBeInTheDocument();
  // A reason that names no field lands in the form-level slot.
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nu mai ai permisiunea să gestionezi taskurile acestui grup.',
    ),
  );
  expect(title).not.toHaveAttribute('aria-invalid');
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
it('drops a Campaign that a refreshed read no longer offers, instead of refusing the draft', async () => {
  const onDraft = vi.fn();
  const view = render(<TaskForm options={options} onDraft={onDraft} />);
  const user = await content();
  await chooseOrigin(user, 'Conferință', /^Echipa afișe/);
  await user.selectOptions(screen.getByLabelText('Campanie (opțional)'), '11');
  view.rerender(
    <TaskForm
      options={{
        ...options,
        campaigns: options.campaigns.filter((campaign) => campaign.id !== 11),
      }}
      onDraft={onDraft}
    />,
  );
  expect(screen.getByLabelText('Campanie (opțional)')).toHaveValue('');
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({ groupId: 3, campaignId: null }),
  );
});
it('marks both cascade steps invalid when the server refuses the chosen Group', async () => {
  const onDraft = vi.fn().mockRejectedValueOnce({
    code: 'PT400',
    message: 'task_group_unavailable',
  });
  render(<TaskForm options={options} onDraft={onDraft} />);
  const user = await content();
  await chooseOrigin(user, 'Conferință', /^Echipa afișe/);
  await user.selectOptions(screen.getByLabelText('Mod de atribuire'), 'public');
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  const refusal =
    'Nu mai poți pregăti taskuri pentru grupul ales. Alege un grup disponibil.';
  await waitFor(() =>
    expect(subgroupBox()).toHaveAttribute('aria-invalid', 'true'),
  );
  expect(groupBox()).toHaveAttribute('aria-invalid', 'true');
  expect(groupBox()).toHaveAccessibleDescription(refusal);
  expect(subgroupBox()).toHaveAccessibleDescription(
    expect.stringContaining(refusal),
  );
});

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chooseOption, optionNames } from '../../test/select';
import * as axe from 'axe-core';
import { expect, it, vi } from 'vitest';
import { pickDate } from '../../test/date-picker';
import { findFormattedText } from '../../test/formatted-text';
import { bucharestWallTimeToIso } from '../../lib/calendar-time';
import { TaskForm } from './TaskForm';
// A deadline next month: always in the future, and one page away in the
// date picker.
const nextMonth = new Date();
nextMonth.setUTCDate(1);
nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
const DEADLINE = `${nextMonth.toISOString().slice(0, 7)}-15T12:30`;
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
const groupBox = () => screen.getByRole('combobox', { name: 'Grup principal' });
const subgroupBox = () =>
  screen.getByRole('combobox', { name: 'Subgrup (opțional)' });
const parentBox = () => screen.getByRole('combobox', { name: 'Task-umbrelă' });
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
const modeGroup = () =>
  screen.getByRole('radiogroup', { name: 'Mod de atribuire' });
const audienceGroup = () =>
  screen.getByRole('radiogroup', { name: 'Audiență' });
/** A segment of Mod de atribuire or Audiență, by its label. */
const choose = (user: User, group: HTMLElement, name: string) =>
  user.click(within(group).getByRole('radio', { name }));
async function content() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Titlu'), '  Pregătește afișele  ');
  await pickDate(user, screen.getByLabelText(/Termen/), DEADLINE);
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
  // Only the Campaigns that can tag the chosen Group are offered.
  await user.click(campaign);
  expect(
    (await screen.findAllByRole('option')).map((option) => option.textContent),
  ).toEqual(['Fără campanie', 'Campanie părinte', 'Campanie proprie']);
  await user.click(screen.getByRole('option', { name: 'Campanie părinte' }));
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
    deadline: bucharestWallTimeToIso(DEADLINE),
    groupId: 3,
    kind: 'task',
    parentTaskId: null,
    audience: 'local',
    assignmentMode: 'direct',
    executorId: 'ana',
    campaignId: 10,
    links: [],
    copies: 1,
    minLevel: 0,
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
  await choose(user, modeGroup(), 'Public');
  const org = () =>
    within(audienceGroup()).getByRole('radio', { name: 'Toți membrii OSUBB' });
  expect(org()).not.toHaveAttribute('aria-disabled', 'true');
  await user.click(org());
  expect(org()).toBeChecked();

  await chooseOrigin(user, 'Tineret');
  expect(org()).toHaveAttribute('aria-disabled', 'true');
  expect(
    within(audienceGroup()).getByRole('radio', { name: 'Membrii grupului' }),
  ).toBeChecked();
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
it('shows Audiență only on a public Task, sends local while Direct and restores the choice (R26)', async () => {
  const onDraft = vi.fn().mockResolvedValue(undefined);
  const { container } = render(
    <TaskForm options={options} onDraft={onDraft} />,
  );
  const user = await content();
  await chooseOrigin(user, 'Conferință');
  // Two options: a segmented choice, not a select. Direct is the default,
  // and a direct Task has no Audience.
  expect(modeGroup()).toHaveAttribute('data-slot', 'segmented-radio');
  expect(
    within(modeGroup())
      .getAllByRole('radio')
      .map((option) => option.textContent),
  ).toEqual(['Direct', 'Public']);
  expect(
    within(modeGroup()).getByRole('radio', { name: 'Direct' }),
  ).toBeChecked();
  // What each mode means is behind the "i", still the group's description.
  expect(modeGroup()).toHaveAccessibleDescription(/lista de candidați/);
  expect(screen.getByText(/lista de candidați/)).not.toBeVisible();
  expect(screen.queryByRole('radiogroup', { name: 'Audiență' })).toBeNull();

  await choose(user, modeGroup(), 'Public');
  expect(audienceGroup()).toHaveAttribute('data-slot', 'segmented-radio');
  expect(audienceGroup()).toHaveAccessibleDescription(
    'Cine vede taskul și se poate înscrie.',
  );
  expect(
    within(audienceGroup())
      .getAllByRole('radio')
      .map((option) => option.textContent),
  ).toEqual(['Membrii grupului', 'Toți membrii OSUBB']);
  await choose(user, audienceGroup(), 'Toți membrii OSUBB');
  expect((await axe.run(container)).violations).toEqual([]);

  // Back to Direct: the field goes and the draft is local.
  await choose(user, modeGroup(), 'Direct');
  expect(screen.queryByRole('radiogroup', { name: 'Audiență' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  await waitFor(() =>
    expect(onDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ assignmentMode: 'direct', audience: 'local' }),
    ),
  );

  // Public again: the earlier choice is back, and sent.
  await choose(user, modeGroup(), 'Public');
  expect(
    within(audienceGroup()).getByRole('radio', { name: 'Toți membrii OSUBB' }),
  ).toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  await waitFor(() =>
    expect(onDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ assignmentMode: 'public', audience: 'org' }),
    ),
  );
});
it('puts a direct_task_local_only refusal on Mod de atribuire (R26)', async () => {
  const onDraft = vi.fn().mockRejectedValueOnce({
    code: 'PT400',
    message: 'direct_task_local_only',
  });
  render(<TaskForm options={options} onDraft={onDraft} />);
  const user = await content();
  await chooseOrigin(user, 'Tineret');
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  const mode = modeGroup();
  await waitFor(() =>
    expect(mode).toHaveAccessibleDescription(
      expect.stringContaining(
        'Un task atribuit direct este doar pentru grupul lui. Alege modul public ca să-l deschizi întregului OSUBB.',
      ),
    ),
  );
  expect(mode).toHaveAttribute('aria-invalid', 'true');
});
it('sends only the root when no Group below is chosen, and starts on the one root there is', async () => {
  const onDraft = vi.fn();
  const view = render(<TaskForm options={options} onDraft={onDraft} />);
  const user = await content();
  await chooseOrigin(user, 'Conferință', /^Echipa afișe/);
  await pick(user, subgroupBox(), 'Doar grupul principal');
  await choose(user, modeGroup(), 'Public');
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
  await user.click(campaign());
  expect(
    (await screen.findAllByRole('option')).map((option) => option.textContent),
  ).toEqual(['Fără campanie', 'Campanie părinte', 'Campanie proprie']);
  await user.click(screen.getByRole('option', { name: 'Campanie părinte' }));
  await pick(user, subgroupBox(), 'Doar grupul principal');
  expect(campaign()).toHaveAttribute('data-value', '10');
  await pick(user, subgroupBox(), /^Echipa afișe/);
  await chooseOption(user, campaign(), 'Campanie proprie');
  await pick(user, subgroupBox(), 'Doar grupul principal');
  expect(campaign()).toHaveAttribute('data-value', '');
});
it('sends the Attached Links, checks each as a pair on blur and submit, and puts the server’s reason on the list (R46)', async () => {
  const onDraft = vi
    .fn()
    .mockRejectedValueOnce({ code: 'PT400', message: 'link_url_invalid' })
    .mockResolvedValue(undefined);
  const { container } = render(
    <TaskForm options={options} onDraft={onDraft} />,
  );
  const user = await content();
  await chooseOrigin(user, 'Tineret');
  await choose(user, modeGroup(), 'Public');
  await user.click(screen.getByRole('button', { name: 'Adaugă link' }));
  const label = screen.getByLabelText('Etichetă link 1');
  const url = screen.getByLabelText('Adresă link 1');
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
      links: [{ label: 'Brief', url: 'https://example.org/brief' }],
    }),
  );
  // The server's refusal cannot name the row: it lands on the list.
  await waitFor(() =>
    expect(
      screen.getByRole('group', { name: /Linkuri atașate/ }),
    ).toHaveAccessibleDescription(
      /Adresa trebuie să înceapă cu http:\/\/ sau https:\/\//,
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledTimes(2);
  // Much typing: slow under the full parallel run.
}, 20_000);
it('clears the Executor on public mode and clears incompatible Campaigns after Origin changes', async () => {
  const onDraft = vi.fn();
  render(<TaskForm options={options} onDraft={onDraft} />);
  const user = await content();
  await chooseOrigin(user, 'Conferință', /^Echipa afișe/);
  await chooseOption(
    user,
    screen.getByLabelText('Campanie (opțional)'),
    'Campanie părinte',
  );
  await pick(
    user,
    screen.getByRole('combobox', { name: 'Executor' }),
    'Ana Pop',
  );
  await choose(user, modeGroup(), 'Public');
  expect(
    screen.queryByRole('combobox', { name: 'Executor' }),
  ).not.toBeInTheDocument();
  await pick(user, groupBox(), 'Tineret');
  expect(screen.getByLabelText('Campanie (opțional)')).toHaveAttribute(
    'data-value',
    '',
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
it('tells a Task-umbrelă (a parent of Subtasks) apart from a Campaign (a reporting label)', async () => {
  render(<TaskForm options={options} onDraft={vi.fn()} />);
  const user = userEvent.setup();
  const kind = screen.getByRole('radiogroup', { name: 'Ce fel de task?' });
  expect(kind).toBeInTheDocument();
  // A segmented choice of names alone: no hint line under each option…
  expect(kind).toHaveAttribute('data-slot', 'segmented-radio');
  expect(
    within(kind)
      .getAllByRole('radio')
      .map((option) => option.textContent),
  ).toEqual(['Task', 'Task-umbrelă', 'Subtask']);
  expect(screen.queryByText('Grupează subtaskuri.')).toBeNull();
  // …the explanation waits behind the "i": hidden, yet still the group's
  // description for a screen reader.
  expect(kind).toHaveAccessibleDescription(
    /task părinte care grupează subtaskuri/i,
  );
  expect(
    screen.getByText(/task părinte care grupează subtaskuri/i),
  ).not.toBeVisible();
  // The "i" opens it in a pop-over.
  await user.click(
    screen.getByRole('button', { name: 'Despre felurile de task' }),
  );
  expect(
    await screen.findByRole('dialog', { name: 'Despre felurile de task' }),
  ).toHaveTextContent(/task părinte care grupează subtaskuri/i);
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('radio', { name: 'Task-umbrelă' }));
  expect(
    screen.queryByLabelText('Campanie (opțional)'),
  ).not.toBeInTheDocument();
});
it('marks only the optional fields; a required one says so to assistive technology', async () => {
  render(<TaskForm options={options} onDraft={vi.fn()} />);
  const user = userEvent.setup();
  const form = screen.getByRole('form');
  expect(form).not.toHaveTextContent('(obligatoriu)');
  expect(screen.getByLabelText('Titlu')).toBeRequired();
  expect(groupBox()).toHaveAttribute('aria-required', 'true');
  expect(screen.getByLabelText('Descriere (opțional)')).not.toBeRequired();
  // The time field is the one place that names Romania's time.
  // The deadline is the date picker, never the browser's own field.
  const deadline = screen.getByLabelText('Termen — ora României');
  expect(deadline).toHaveAttribute('data-slot', 'date-picker');
  expect(deadline).toHaveAttribute('data-required', 'true');
  expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
  // The Campaign's explanation is behind its "i", still its description.
  const campaign = screen.getByLabelText('Campanie (opțional)');
  expect(campaign).toHaveAccessibleDescription(/etichetă pentru raportare/i);
  expect(screen.getByText(/etichetă pentru raportare/i)).not.toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Despre campanie' }));
  expect(
    await screen.findByRole('dialog', { name: 'Despre campanie' }),
  ).toHaveTextContent(/etichetă pentru raportare/i);
  await user.keyboard('{Escape}');
  // An Umbrella may have no deadline: the label says the field is optional.
  await user.click(screen.getByRole('radio', { name: 'Task-umbrelă' }));
  expect(
    screen.getByLabelText('Termen (opțional) — ora României'),
  ).not.toHaveAttribute('data-required');
  await user.click(screen.getByRole('radio', { name: 'Subtask' }));
  expect(parentBox()).toHaveAttribute('aria-required', 'true');
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
  await user.type(screen.getByLabelText('Titlu'), 'Eveniment');
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
  await pickDate(user, deadline, '2027-03-28T03:30');
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(deadline).toHaveAccessibleDescription(
    'Alege un termen valid, în ora României.',
  );
  await pickDate(user, deadline, DEADLINE);
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
  const title = screen.getByLabelText('Titlu');
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
  const title = screen.getByLabelText('Titlu');
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
  await pickDate(user, screen.getByLabelText(/Termen/), DEADLINE);
  await pick(user, groupBox(), 'Tineret');
  await choose(user, modeGroup(), 'Public');
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
  await choose(user, modeGroup(), 'Public');
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  const title = screen.getByLabelText('Titlu');
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
it('puts a server refusal of the Descriere under it (R60)', async () => {
  const onDraft = vi
    .fn()
    .mockRejectedValueOnce({ code: 'PT400', message: 'description_too_long' });
  render(<TaskForm options={options} onDraft={onDraft} />);
  const user = await content();
  await pick(user, groupBox(), 'Tineret');
  await choose(user, modeGroup(), 'Public');
  const description = await findFormattedText('Descriere (opțional)');
  await user.type(description, 'Plan');
  await user.click(screen.getByRole('button', { name: 'Continuă' }));

  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({ description: 'Plan' }),
  );
  await waitFor(() =>
    expect(description).toHaveAccessibleDescription(
      /Descrierea are cel mult 2000 de caractere\./,
    ),
  );
  await waitFor(() => expect(description).toHaveFocus());
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
  await chooseOption(
    user,
    screen.getByLabelText('Campanie (opțional)'),
    'Campanie proprie',
  );
  view.rerender(
    <TaskForm
      options={{
        ...options,
        campaigns: options.campaigns.filter((campaign) => campaign.id !== 11),
      }}
      onDraft={onDraft}
    />,
  );
  expect(screen.getByLabelText('Campanie (opțional)')).toHaveAttribute(
    'data-value',
    '',
  );
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
  await choose(user, modeGroup(), 'Public');
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

it('offers Exemplare to a Task, not to an Umbrella, and labels the button by the count', async () => {
  const user = userEvent.setup();
  render(
    <TaskForm
      options={options}
      onDraft={vi.fn()}
      submitLabel="Creează taskul"
    />,
  );
  const copies = screen.getByLabelText('Exemplare');
  expect(copies).toHaveValue(1);
  expect(copies).toHaveAttribute('max', '100');
  expect(
    screen.getByRole('button', { name: 'Creează taskul' }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('radio', { name: 'Public' }));
  await user.clear(copies);
  await user.type(copies, '3');
  expect(
    screen.getByRole('button', { name: 'Creează 3 taskuri' }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('radio', { name: 'Task-umbrelă' }));
  expect(screen.queryByLabelText('Exemplare')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Creează taskul' }),
  ).toBeInTheDocument();
});

it('hands direct copies to the next step: no Executor picker, the button says Continuă', async () => {
  const user = userEvent.setup();
  const onDraft = vi.fn();
  render(
    <TaskForm
      options={options}
      onDraft={onDraft}
      submitLabel="Creează taskul"
    />,
  );
  await chooseOrigin(user, 'Tineret');
  expect(
    screen.getByRole('combobox', { name: 'Executor' }),
  ).toBeInTheDocument();
  const copies = screen.getByLabelText('Exemplare');
  await user.clear(copies);
  await user.type(copies, '2');
  expect(screen.queryByRole('combobox', { name: 'Executor' })).toBeNull();
  expect(screen.getByText(/Executorii se aleg la pasul următor/)).toBeVisible();
  await user.type(screen.getByLabelText('Titlu'), 'Două afișe');
  await pickDate(user, screen.getByLabelText(/Termen/), DEADLINE);
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  await waitFor(() => expect(onDraft).toHaveBeenCalledTimes(1));
  expect(onDraft.mock.calls[0]?.[0]).toMatchObject({
    copies: 2,
    assignmentMode: 'direct',
    executorId: null,
  });
});

it.each([
  ['', 'Numărul de exemplare nu e valid'],
  ['abc', 'Numărul de exemplare nu e valid'],
  ['2.5', 'Numărul de exemplare nu e valid'],
  ['0', 'Numărul de exemplare nu e valid'],
  ['101', 'Cel mult 100 de exemplare'],
])('refuses "%s" copies in the browser', async (typed, message) => {
  const user = userEvent.setup();
  const onDraft = vi.fn();
  render(
    <TaskForm
      options={options}
      onDraft={onDraft}
      submitLabel="Creează taskul"
    />,
  );
  await chooseOrigin(user, 'Tineret');
  await user.type(screen.getByLabelText('Titlu'), 'Fără număr');
  await pickDate(user, screen.getByLabelText(/Termen/), DEADLINE);
  const copies = screen.getByLabelText('Exemplare');
  await user.clear(copies);
  if (typed) fireEvent.change(copies, { target: { value: typed } });
  await user.click(screen.getByRole('button', { name: /Creează|Continuă/ }));
  expect(await screen.findByText(new RegExp(message))).toBeVisible();
  expect(onDraft).not.toHaveBeenCalled();
});
it('offers Cine îl vede on a public Task only, by Role from the Group floor up to the actor, and sends the choice (R57)', async () => {
  const onDraft = vi.fn().mockResolvedValue(undefined);
  render(<TaskForm options={options} onDraft={onDraft} actorLevel={2} />);
  const user = await content();
  await chooseOrigin(user, 'Conferință');
  // A direct Task has no queue to gate.
  expect(screen.queryByLabelText('Cine îl vede')).toBeNull();
  await choose(user, modeGroup(), 'Public');
  // Conferință sits at Voluntar: its own members start there, up to the
  // actor's own Voluntar Activ.
  expect(
    await optionNames(user, screen.getByLabelText('Cine îl vede')),
  ).toEqual(['Voluntar', 'Voluntar Activ']);
  // Organisation-wide, it reaches below the Group's floor (R26).
  await choose(user, audienceGroup(), 'Toți membrii OSUBB');
  expect(
    await optionNames(user, screen.getByLabelText('Cine îl vede')),
  ).toEqual(['Recrut', 'Voluntar', 'Voluntar Activ']);
  await chooseOption(
    user,
    screen.getByLabelText('Cine îl vede'),
    'Voluntar Activ',
  );
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  await waitFor(() =>
    expect(onDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        assignmentMode: 'public',
        audience: 'org',
        minLevel: 2,
      }),
    ),
  );
  // Back to Direct: the field goes and nothing is gated.
  await choose(user, modeGroup(), 'Direct');
  expect(screen.queryByLabelText('Cine îl vede')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  await waitFor(() =>
    expect(onDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ assignmentMode: 'direct', minLevel: 0 }),
    ),
  );
});

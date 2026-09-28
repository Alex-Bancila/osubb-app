import * as axe from 'axe-core';
import {
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  options: vi.fn(),
  create: vi.fn(),
  auth: vi.fn(),
  mutateAsync: vi.fn(),
}));

vi.mock('../../queries/event-creation', () => ({
  useEventFormOptions: state.options,
  useCreateEvent: state.create,
  eventCreationErrorMessage: (error: { message?: string }) =>
    error.message === 'calendar_manage_forbidden'
      ? 'Nu mai ai permisiunea să creezi evenimente în acest grup.'
      : 'Nu am putut crea evenimentul. Reîncearcă.',
}));
vi.mock('../../lib/auth', () => ({ useAuth: state.auth }));

import { NewEventControl } from './NewEventControl';
import { clearEventReceipts, useEventReceipt } from './event-receipts';

const formOptions = {
  groups: [
    {
      id: 1,
      name: 'OSUBB',
      path: [1],
      minLevel: 0,
      isOrganization: true,
    },
    {
      id: 7,
      name: 'Educațional',
      path: [7],
      minLevel: 0,
      isOrganization: false,
    },
    {
      id: 12,
      name: 'Social Media',
      path: [7, 12],
      minLevel: 0,
      isOrganization: false,
    },
  ],
  groupNames: [
    { id: 1, name: 'OSUBB' },
    { id: 7, name: 'Educațional' },
    { id: 12, name: 'Social Media' },
  ],
  campaigns: [
    { id: 3, name: 'Bun venit', group_id: 7 },
    { id: 4, name: 'Zilele OSUBB', group_id: 1 },
    { id: 5, name: 'Doar Social Media', group_id: 12 },
  ],
};

function setup() {
  const user = userEvent.setup();
  render(<NewEventControl />);
  return user;
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Eveniment nou' }));
  return screen.findByRole('dialog', { name: 'Eveniment nou' });
}

async function chooseGroup(
  user: ReturnType<typeof userEvent.setup>,
  name: string | RegExp = 'Educațional',
) {
  await user.click(screen.getByRole('combobox', { name: 'Grup' }));
  await user.click(await screen.findByRole('option', { name }));
}

function campaignOptions() {
  return Array.from(
    (screen.getByLabelText('Campanie (opțional)') as HTMLSelectElement).options,
  ).map((option) => option.text);
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await chooseGroup(user);
  await user.type(screen.getByLabelText('Titlu'), 'Ședință de toamnă');
  fireEvent.change(screen.getByLabelText(/Începe/), {
    target: { value: '2030-10-01T18:00' },
  });
}

describe('NewEventControl', () => {
  beforeEach(() => {
    state.options.mockReturnValue({ data: formOptions });
    state.create.mockReturnValue({
      mutateAsync: state.mutateAsync,
      isPending: false,
    });
    state.auth.mockReturnValue({
      session: { user: { id: 'manager-1' } },
      claims: { member_level: 6 },
    });
    state.mutateAsync.mockReset();
  });

  it.each([
    ['while options load', { isPending: true }],
    ['when options fail', { isError: true }],
    [
      'without a manageable Group',
      { data: { groups: [], groupNames: [], campaigns: [] } },
    ],
  ])('is hidden %s', (_label, result) => {
    state.options.mockReturnValue(result);
    setup();
    expect(screen.queryByRole('button', { name: 'Eveniment nou' })).toBeNull();
  });

  it('opens an accessible responsive Event form', async () => {
    const user = setup();
    const dialog = await open(user);
    expect(screen.getByLabelText('Titlu')).toBeInTheDocument();
    expect(screen.getByLabelText('Tip')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Grup' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Începe/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Se încheie/)).toBeInTheDocument();
    const results = await axe.run(dialog, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  // X11, X12: one select look (#842) and the kit footer.
  it('draws Tip, Cine îl vede and Campanie with the shared select and footer', async () => {
    const user = setup();
    const dialog = await open(user);
    for (const label of ['Tip', 'Cine îl vede', 'Campanie (opțional)'])
      expect(screen.getByLabelText(label)).toHaveAttribute(
        'data-slot',
        'native-select',
      );
    const submit = screen.getByRole('button', { name: 'Creează evenimentul' });
    expect(submit.parentElement).toHaveAttribute('data-slot', 'dialog-footer');
    expect(dialog.querySelector('[data-slot=dialog-header]')).not.toBeNull();
  });

  it('offers "Cine îl vede" by Role name: the Event subset of the ladder, in order (R29b)', async () => {
    const user = setup();
    await open(user);
    await chooseGroup(user);
    expect(
      Array.from(
        (screen.getByLabelText('Cine îl vede') as HTMLSelectElement).options,
      ).map((option) => option.text),
    ).toEqual(['Recrut', 'Voluntar cu Drept de Vot', 'BCE', 'BC']);
  });

  it('creates through the normalized RPC draft and closes', async () => {
    state.mutateAsync.mockResolvedValue({ id: 44 });
    const user = setup();
    await open(user);
    await fillRequired(user);
    await user.click(
      screen.getByRole('button', { name: 'Creează evenimentul' }),
    );

    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalledOnce());
    expect(state.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Ședință de toamnă',
        groupId: 7,
        startsAt: '2030-10-01T15:00:00.000Z',
        campaignId: null,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('offers only the active Campaigns on the chosen Group path', async () => {
    const user = setup();
    await open(user);
    expect(screen.getByLabelText('Campanie (opțional)')).toBeDisabled();

    await chooseGroup(user);
    expect(campaignOptions()).toEqual(['Fără campanie', 'Bun venit']);

    await chooseGroup(user, /^Social Media/);
    // A Child Group reaches its parent's Campaigns, and its own.
    expect(campaignOptions()).toEqual([
      'Fără campanie',
      'Bun venit',
      'Doar Social Media',
    ]);

    await chooseGroup(user, 'OSUBB');
    expect(campaignOptions()).toEqual(['Fără campanie', 'Zilele OSUBB']);
  });

  it('resets the Campaign when the Group changes', async () => {
    const user = setup();
    await open(user);
    await chooseGroup(user);
    await user.selectOptions(
      screen.getByLabelText('Campanie (opțional)'),
      'Bun venit',
    );
    expect(screen.getByLabelText('Campanie (opțional)')).toHaveValue('3');

    await chooseGroup(user, /^Social Media/);
    expect(screen.getByLabelText('Campanie (opțional)')).toHaveValue('');
  });

  it('sends the chosen Campaign with the draft', async () => {
    state.mutateAsync.mockResolvedValue({ id: 45 });
    const user = setup();
    await open(user);
    await fillRequired(user);
    await user.selectOptions(
      screen.getByLabelText('Campanie (opțional)'),
      'Bun venit',
    );
    await user.click(
      screen.getByRole('button', { name: 'Creează evenimentul' }),
    );

    await waitFor(() =>
      expect(state.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 7, campaignId: 3 }),
      ),
    );
  });

  it("shows the server's invalid_campaign under the Campaign field", async () => {
    state.mutateAsync.mockRejectedValue({
      code: 'PT400',
      message: 'invalid_campaign',
    });
    const user = setup();
    await open(user);
    await fillRequired(user);
    await user.selectOptions(
      screen.getByLabelText('Campanie (opțional)'),
      'Bun venit',
    );
    await user.click(
      screen.getByRole('button', { name: 'Creează evenimentul' }),
    );

    const field = screen.getByLabelText('Campanie (opțional)');
    await waitFor(() =>
      expect(field).toHaveAccessibleDescription(
        expect.stringContaining('Campania nu mai este disponibilă'),
      ),
    );
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps the draft and shows safe Romanian feedback after refusal', async () => {
    state.mutateAsync.mockRejectedValue({
      code: '42501',
      message: 'calendar_manage_forbidden',
      details: 'private SQL detail',
    });
    const user = setup();
    await open(user);
    await fillRequired(user);
    await user.click(
      screen.getByRole('button', { name: 'Creează evenimentul' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nu mai ai permisiunea',
    );
    expect(screen.queryByText('private SQL detail')).toBeNull();
    expect(screen.getByLabelText('Titlu')).toHaveValue('Ședință de toamnă');
    expect(screen.getByRole('dialog', { name: 'Eveniment nou' })).toBeVisible();
  });

  it('blocks a locally invalid draft without calling the RPC', async () => {
    const user = setup();
    await open(user);
    await user.type(screen.getByLabelText('Titlu'), 'Fără grup');
    await user.click(
      screen.getByRole('button', { name: 'Creează evenimentul' }),
    );
    expect(
      await screen.findByText('Alege grupul evenimentului.'),
    ).toHaveAttribute('role', 'alert');
    expect(
      screen.getByLabelText('Începe — ora României'),
    ).toHaveAccessibleDescription('Alege ora de început.');
    expect(state.mutateAsync).not.toHaveBeenCalled();
  });

  it('resets an explicitly cancelled draft on the next opening', async () => {
    const user = setup();
    await open(user);
    await user.type(screen.getByLabelText('Titlu'), 'Draft abandonat');
    await user.click(screen.getByRole('button', { name: 'Renunță' }));
    await open(user);
    expect(screen.getByLabelText('Titlu')).toHaveValue('');
  });
});

/* Audit D-11: the new card confirms the create, as #849's edit and cancel
   receipts do, and the Calendar learns which Event to show. */
describe('NewEventControl receipt', () => {
  beforeEach(() => {
    state.options.mockReturnValue({ data: formOptions });
    state.create.mockReturnValue({
      mutateAsync: state.mutateAsync,
      isPending: false,
    });
    state.auth.mockReturnValue({
      session: { user: { id: 'manager-1' } },
      claims: { member_level: 6 },
    });
    state.mutateAsync.mockReset();
  });

  it('leaves a receipt on the new card and hands its id to the Calendar', async () => {
    state.mutateAsync.mockResolvedValue({
      id: 44,
      title: 'Ședință de toamnă',
      starts_at: '2030-10-01T15:00:00+00:00',
    });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<NewEventControl onCreated={onCreated} />);
    await open(user);
    await fillRequired(user);
    await user.click(
      screen.getByRole('button', { name: 'Creează evenimentul' }),
    );

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(44));
    const receipt = renderHook(() => useEventReceipt(44));
    expect(receipt.result.current).toBe('Evenimentul a fost creat.');
    clearEventReceipts();
  });
});

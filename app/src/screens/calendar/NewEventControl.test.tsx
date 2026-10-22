import * as axe from 'axe-core';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseOption } from '../../test/select';

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

import {
  bucharestDayKey,
  bucharestWallTimeToIso,
} from '../../lib/calendar-time';
import { pickDate } from '../../test/date-picker';
import { findFormattedText } from '../../test/formatted-text';
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

/** What a `Select` offers: its list is opened, read and closed again. */
async function optionNames(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) {
  await user.click(screen.getByLabelText(label));
  const names = (await screen.findAllByRole('option')).map(
    (option) => option.textContent,
  );
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  return names;
}

function campaignOptions(user: ReturnType<typeof userEvent.setup>) {
  return optionNames(user, 'Campanie (opțional)');
}

/**
 * The 15th of a month near today, as a picker value: one press of "Luna
 * următoare" / "Luna anterioară" away, where a fixed far date is dozens.
 */
function nearDate(months: number, time: string) {
  const [year = 1970, month = 1] = (bucharestDayKey(new Date()) ?? '')
    .split('-')
    .map(Number);
  const day = new Date(Date.UTC(year, month - 1 + months, 15));
  return `${day.toISOString().slice(0, 10)}T${time}`;
}

const START = nearDate(1, '18:00');

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await chooseGroup(user);
  await user.type(screen.getByLabelText('Titlu'), 'Ședință de toamnă');
  await pickDate(user, screen.getByLabelText(/Începe/), START);
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

  // X11, X12: one select look, the app's own; the form is a sheet with a pinned footer.
  it('draws Tip, Cine îl vede and Campanie with the shared select, in a form sheet with a pinned footer', async () => {
    const user = setup();
    const dialog = await open(user);
    for (const label of ['Tip', 'Cine îl vede', 'Campanie (opțional)'])
      expect(screen.getByLabelText(label)).toHaveAttribute(
        'data-slot',
        'select',
      );
    const submit = screen.getByRole('button', { name: 'Creează evenimentul' });
    expect(submit.parentElement).toHaveAttribute('data-slot', 'sheet-footer');
    expect(submit.parentElement).toHaveAttribute('data-pinned', 'true');
    // Renunță first, the one filled button last.
    expect(submit.previousElementSibling).toHaveTextContent('Renunță');
    expect(dialog).toHaveAttribute('data-slot', 'form-sheet');
    // A sheet's header holds the title alone: no intro paragraph.
    expect(screen.queryByText(/Orele sunt interpretate/)).toBeNull();
    expect(dialog).not.toHaveAttribute('aria-describedby');
  });

  it('draws the text fields and both times with the shared field and picker', async () => {
    const user = setup();
    const dialog = await open(user);
    for (const label of ['Titlu', 'Loc (opțional)', 'Capacitate (opțional)'])
      expect(screen.getByLabelText(label)).toHaveAttribute(
        'data-slot',
        'input',
      );
    expect(
      (await findFormattedText('Descriere (opțional)')).closest('[data-slot]'),
    ).toHaveAttribute('data-slot', 'formatted-text-input');
    for (const label of [
      'Începe — ora României',
      'Se încheie (opțional) — ora României',
    ])
      expect(screen.getByLabelText(label)).toHaveAttribute(
        'data-slot',
        'date-picker',
      );
    expect(dialog.querySelector('input[type="datetime-local"]')).toBeNull();
  });

  it('opens "Începe" on an evening hour and "Se încheie" two hours later, never before the start', async () => {
    const user = setup();
    await open(user);
    const start = screen.getByLabelText('Începe — ora României');
    await user.click(start);
    expect(await screen.findByLabelText('Ora')).toHaveValue('18:00');
    await user.keyboard('{Escape}');
    const morning = nearDate(1, '10:30');
    await pickDate(user, start, morning);
    expect(start).toHaveAttribute('data-value', morning);

    await user.click(screen.getByLabelText(/Se încheie/));
    expect(await screen.findByLabelText('Ora')).toHaveValue('12:30');
    // An empty end opens on the start's month, not today's.
    const day = morning.slice(0, 10);
    expect(
      document.querySelector(`[data-day="${day.slice(0, 8)}14"]`),
    ).toBeDisabled();
    expect(document.querySelector(`[data-day="${day}"]`)).not.toBeDisabled();
  });

  it('does not judge "Începe" when its calendar opens, only once the member leaves the field', async () => {
    const user = setup();
    await open(user);
    const start = screen.getByLabelText('Începe — ora României');
    await user.click(start);
    await screen.findByLabelText('Ora');
    expect(screen.queryByText('Alege ora de început.')).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(start).toHaveFocus());
    await user.tab();
    expect(await screen.findByText('Alege ora de început.')).toBeVisible();
  });

  it('keeps the Campaign explanation behind the hint beside its label', async () => {
    const user = setup();
    await open(user);
    const field = screen.getByLabelText('Campanie (opțional)');
    expect(field).toHaveAccessibleDescription(
      'Alege întâi grupul: campaniile vin din grupul evenimentului și din cele de deasupra lui.',
    );
    // The sentence is not on the form until the hint is opened.
    expect(screen.getByText(/Alege întâi grupul/)).not.toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Despre campanie' }));
    expect(
      await screen.findByRole('dialog', { name: 'Despre campanie' }),
    ).toHaveTextContent('Alege întâi grupul');
  });

  it('offers "Cine îl vede" by Role name: the whole ladder, in order (R29b, R57)', async () => {
    const user = setup();
    await open(user);
    await chooseGroup(user);
    expect(await optionNames(user, 'Cine îl vede')).toEqual([
      'Recrut',
      'Voluntar',
      'Voluntar Activ',
      'Voluntar cu Drept de Vot',
      'BCE',
      'BC',
    ]);
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
        // Read in Romania, sent as an instant.
        startsAt: bucharestWallTimeToIso(START),
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
    expect(await campaignOptions(user)).toEqual(['Fără campanie', 'Bun venit']);

    await chooseGroup(user, /^Social Media/);
    // A Child Group reaches its parent's Campaigns, and its own.
    expect(await campaignOptions(user)).toEqual([
      'Fără campanie',
      'Bun venit',
      'Doar Social Media',
    ]);

    await chooseGroup(user, 'OSUBB');
    expect(await campaignOptions(user)).toEqual([
      'Fără campanie',
      'Zilele OSUBB',
    ]);
  });

  it('resets the Campaign when the Group changes', async () => {
    const user = setup();
    await open(user);
    await chooseGroup(user);
    await chooseOption(
      user,
      screen.getByLabelText('Campanie (opțional)'),
      'Bun venit',
    );
    expect(screen.getByLabelText('Campanie (opțional)')).toHaveAttribute(
      'data-value',
      '3',
    );

    await chooseGroup(user, /^Social Media/);
    expect(screen.getByLabelText('Campanie (opțional)')).toHaveAttribute(
      'data-value',
      '',
    );
  });

  it('lets a chosen Campaign be taken off again with "Fără campanie"', async () => {
    const user = setup();
    await open(user);
    await chooseGroup(user);
    const campaign = screen.getByLabelText('Campanie (opțional)');
    expect(campaign).toHaveTextContent('Fără campanie');
    await chooseOption(user, campaign, 'Bun venit');
    expect(campaign).toHaveTextContent('Bun venit');
    await chooseOption(user, campaign, 'Fără campanie');
    expect(campaign).toHaveAttribute('data-value', '');
    expect(campaign).toHaveTextContent('Fără campanie');
  });

  it('sends the chosen Campaign with the draft', async () => {
    state.mutateAsync.mockResolvedValue({ id: 45 });
    const user = setup();
    await open(user);
    await fillRequired(user);
    await chooseOption(
      user,
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
    await chooseOption(
      user,
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

  it('puts a server refusal of the Descriere under it (R60)', async () => {
    state.mutateAsync.mockRejectedValue({
      code: 'PT400',
      message: 'description_too_long',
    });
    const user = setup();
    await open(user);
    await fillRequired(user);
    const description = await findFormattedText('Descriere (opțional)');
    await user.type(description, 'Agenda');
    await user.click(
      screen.getByRole('button', { name: 'Creează evenimentul' }),
    );

    await waitFor(() =>
      expect(description).toHaveAccessibleDescription(
        expect.stringContaining('Descrierea are cel mult 2000 de caractere'),
      ),
    );
    expect(description).toHaveAttribute('aria-invalid', 'true');
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

  it('shows every missing field on the first empty submit and focuses Titlu (F-16)', async () => {
    const user = setup();
    await open(user);
    await user.click(
      screen.getByRole('button', { name: 'Creează evenimentul' }),
    );
    expect(
      await screen.findByText('Scrie titlul evenimentului.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Alege grupul evenimentului.')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Începe — ora României'),
    ).toHaveAccessibleDescription('Alege ora de început.');
    await waitFor(() => expect(screen.getByLabelText('Titlu')).toHaveFocus());
    expect(state.mutateAsync).not.toHaveBeenCalled();
  });

  it('asks for the Group before "Cine îl vede", whose choices depend on it (F-16)', async () => {
    const user = setup();
    await open(user);
    const group = screen.getByRole('combobox', { name: 'Grup' });
    const audience = screen.getByLabelText('Cine îl vede');
    expect(
      group.compareDocumentPosition(audience) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

  describe('"Creează și un anunț" (#909)', () => {
    const announceBox = () =>
      screen.queryByRole('checkbox', { name: 'Creează și un anunț' });

    beforeEach(() => {
      state.options.mockReturnValue({
        data: { ...formOptions, announceGroupIds: [1, 7] },
      });
      state.mutateAsync.mockResolvedValue({ id: 45 });
    });

    it('starts unticked and publishes no Announcement unless ticked', async () => {
      const user = setup();
      await open(user);
      await fillRequired(user);
      expect(announceBox()).not.toBeChecked();
      // What the tick does sits behind the hint beside it.
      expect(announceBox()).toHaveAccessibleDescription(
        expect.stringContaining('Publică în Anunțuri titlul, data, locul'),
      );
      expect(
        screen.getByRole('button', { name: 'Despre anunțul evenimentului' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Publică în Anunțuri titlul, data, locul/),
      ).not.toBeVisible();
      await user.click(
        screen.getByRole('button', { name: 'Creează evenimentul' }),
      );
      await waitFor(() =>
        expect(state.mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ announce: false }),
        ),
      );
    });

    it('asks for the Announcement when ticked and says both were created', async () => {
      const user = setup();
      await open(user);
      await fillRequired(user);
      await user.click(announceBox() as HTMLElement);
      await user.click(
        screen.getByRole('button', { name: 'Creează evenimentul' }),
      );
      await waitFor(() =>
        expect(state.mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ groupId: 7, announce: true }),
        ),
      );
      const receipt = renderHook(() => useEventReceipt(45));
      expect(receipt.result.current).toBe(
        'Evenimentul și anunțul au fost create.',
      );
      clearEventReceipts();
    });

    it('is hidden for a Group the viewer may not publish from', async () => {
      const user = setup();
      await open(user);
      expect(announceBox()).not.toBeNull();
      await chooseGroup(user, /Social Media/);
      expect(announceBox()).toBeNull();
    });

    it('is hidden when the viewer may publish from no Group', async () => {
      state.options.mockReturnValue({ data: formOptions });
      const user = setup();
      await open(user);
      expect(announceBox()).toBeNull();
    });

    it("stays available for an Event above its Group's Minimum Level: the Announcement takes that level", async () => {
      const user = setup();
      await open(user);
      await fillRequired(user);
      await user.click(announceBox() as HTMLElement);
      await chooseOption(
        user,
        screen.getByLabelText('Cine îl vede'),
        'Voluntar cu Drept de Vot',
      );
      expect(announceBox()).not.toHaveAttribute('aria-disabled', 'true');
      expect(announceBox()).toBeChecked();
      await user.click(
        screen.getByRole('button', { name: 'Creează evenimentul' }),
      );
      await waitFor(() =>
        expect(state.mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ minLevel: 3, announce: true }),
        ),
      );
    });
  });
});

describe('NewEventControl receipt — a request (spec 2026-10-11)', () => {
  beforeEach(() => {
    state.options.mockReturnValue({
      data: { ...formOptions, announceGroupIds: [1, 7] },
    });
    state.create.mockReturnValue({
      mutateAsync: state.mutateAsync,
      isPending: false,
    });
    state.auth.mockReturnValue({
      session: { user: { id: 'bce-1' } },
      claims: { member_level: 5 },
    });
    state.mutateAsync.mockReset();
    clearEventReceipts();
  });

  it('says the Event waits for BC when the server left it pending', async () => {
    state.mutateAsync.mockResolvedValue({ id: 46, approval_status: 'pending' });
    const user = setup();
    await open(user);
    await fillRequired(user);
    await user.click(
      screen.getByRole('button', { name: 'Creează evenimentul' }),
    );

    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalledOnce());
    const receipt = renderHook(() => useEventReceipt(46));
    expect(receipt.result.current).toBe('Evenimentul așteaptă aprobarea BC.');
  });

  it('adds that its Announcement follows the approval when one was asked for', async () => {
    state.mutateAsync.mockResolvedValue({ id: 47, approval_status: 'pending' });
    const user = setup();
    await open(user);
    await fillRequired(user);
    await user.click(
      screen.getByRole('checkbox', { name: 'Creează și un anunț' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Creează evenimentul' }),
    );

    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalledOnce());
    const receipt = renderHook(() => useEventReceipt(47));
    expect(receipt.result.current).toBe(
      'Evenimentul așteaptă aprobarea BC. Anunțul lui va fi publicat odată cu el.',
    );
  });
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: vi.fn(),
  capabilities: vi.fn(),
  options: vi.fn(),
  campaigns: vi.fn(),
  update: vi.fn(),
  cancel: vi.fn(),
  updateAsync: vi.fn(),
  cancelAsync: vi.fn(),
  deleteAsync: vi.fn(),
  attendance: vi.fn(),
  // Spec 2026-10-11: the two decisions of a review.
  approveAsync: vi.fn(),
  rejectAsync: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/auth', () => ({ useAuth: state.auth }));
vi.mock('../../lib/capabilities', () => ({
  useCapabilities: state.capabilities,
}));
vi.mock('../../queries/event-creation', () => ({
  useEventFormOptions: state.options,
}));
vi.mock('../../queries/campaigns', () => ({ useCampaigns: state.campaigns }));
vi.mock('../../queries/delete-for-good', () => ({
  useDeleteEvent: () => ({ mutateAsync: state.deleteAsync, isPending: false }),
}));
vi.mock('../../queries/event-attendance', () => ({
  useEventAttendance: state.attendance,
}));
vi.mock('../../queries/event-edit', async (importActual) => ({
  ...(await importActual<typeof import('../../queries/event-edit')>()),
  useUpdateEvent: state.update,
  useCancelEvent: state.cancel,
}));
vi.mock('../../queries/approvals', () => ({
  useApproveEvent: () => ({
    mutateAsync: state.approveAsync,
    isPending: false,
  }),
  useRejectEvent: () => ({ mutateAsync: state.rejectAsync, isPending: false }),
}));

import type { EventPresentation } from '../../queries/events';
import { CommandError } from '../../lib/command-reasons';
import { EditEventSheet, EventManageControls } from './EventManageControls';
import { clearEventReceipts, useCalendarReceipt } from './event-receipts';

const MEMBER = 'd0000000-0000-0000-0000-000000000006';

const managerOptions = {
  groups: [
    { id: 5, name: 'OSUBB', path: [5], minLevel: 0, isOrganization: true },
    {
      id: 7,
      name: 'Educațional',
      path: [7],
      minLevel: 0,
      isOrganization: false,
    },
  ],
  groupNames: [
    { id: 5, name: 'OSUBB' },
    { id: 7, name: 'Educațional' },
  ],
  campaigns: [{ id: 3, name: 'Bun venit', group_id: 7 }],
  // #909: even where the viewer may publish, editing offers no Announcement.
  announceGroupIds: [5, 7],
};

function event(overrides: Partial<EventPresentation> = {}): EventPresentation {
  return {
    id: 31,
    title: 'Ședință Educațional',
    type: 'sedinta',
    groupId: 7,
    group: {
      name: 'Educațional',
      short: 'EDU',
      color: '#284C93',
      category: 'department',
      path: [7],
      is_organization: false,
    },
    campaignId: 3,
    startsAt: '2030-10-01T15:00:00.000Z',
    endsAt: '2030-10-01T17:00:00.000Z',
    dayKey: '2030-10-01',
    dayLabel: 'marți, 1 octombrie 2030',
    startTime: '18:00',
    endTime: '20:00',
    location: 'Sala 305',
    capacity: 25,
    description: 'Planificarea lunii.',
    minLevel: 0,
    createdBy: 'someone-else',
    cancelledAt: null,
    cancelReason: null,
    approvalStatus: 'approved',
    rejectionReason: null,
    ...overrides,
  };
}

function setup(shown: EventPresentation = event()) {
  const user = userEvent.setup();
  const view = render(<EventManageControls event={shown} groups={undefined} />);
  return { user, ...view };
}

describe('EventManageControls', () => {
  beforeEach(() => {
    clearEventReceipts();
    state.auth.mockReturnValue({
      session: { user: { id: MEMBER } },
      claims: { member_level: 5 },
    });
    state.capabilities.mockReturnValue({
      data: { createTopLevelGroups: false, managesAnyGroup: true },
    });
    state.options.mockReturnValue({ data: managerOptions });
    state.campaigns.mockReturnValue({ data: [] });
    state.updateAsync.mockReset().mockResolvedValue({ id: 31 });
    state.cancelAsync.mockReset().mockResolvedValue({ id: 31 });
    state.deleteAsync.mockReset().mockResolvedValue({ rsvps: 4 });
    state.attendance.mockReset().mockReturnValue({
      data: { going: ['a', 'b', 'c'], declined: ['d'] },
    });
    state.update.mockReturnValue({
      mutateAsync: state.updateAsync,
      isPending: false,
    });
    state.cancel.mockReturnValue({
      mutateAsync: state.cancelAsync,
      isPending: false,
    });
  });

  it('shows Editează and Anulează evenimentul to a manager of the Group', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Editează' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Anulează evenimentul' }),
    ).toBeVisible();
  });

  it('shows nothing to a Voluntar with no Group Role', () => {
    state.capabilities.mockReturnValue({
      data: { createTopLevelGroups: false, managesAnyGroup: false },
    });
    state.options.mockReturnValue({
      data: { groups: [], groupNames: [], campaigns: [] },
    });
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing on another Group's Event, or an Organization Event someone else created", () => {
    const { container, rerender } = setup(event({ groupId: 20 }));
    expect(container).toBeEmptyDOMElement();
    rerender(
      <EventManageControls
        event={event({
          groupId: 5,
          group: {
            name: 'OSUBB',
            short: 'ORG',
            color: null,
            category: 'organization',
            path: [5],
            is_organization: true,
          },
        })}
        groups={undefined}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing while the gate is still loading', () => {
    state.options.mockReturnValue({ isPending: true });
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it('edits in the Eveniment nou form, prefilled, and sends every field', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Editează' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Editează evenimentul',
    });
    const title = within(dialog).getByLabelText('Titlu');
    expect(title).toHaveValue('Ședință Educațional');
    // A form sheet: no intro, the times in the picker, the actions pinned.
    expect(dialog).toHaveAttribute('data-slot', 'form-sheet');
    expect(within(dialog).queryByText(/Orele sunt interpretate/)).toBeNull();
    expect(within(dialog).getByLabelText(/Începe/)).toHaveAttribute(
      'data-value',
      '2030-10-01T18:00',
    );
    expect(within(dialog).getByLabelText(/Începe/)).toHaveTextContent(
      'mar., 1 oct. 2030 · 18:00',
    );
    expect(
      within(dialog).getByRole('button', { name: 'Salvează modificările' })
        .parentElement,
    ).toHaveAttribute('data-pinned', 'true');
    // What a save sets off stays readable above the actions.
    expect(
      within(dialog).getByText(/îi anunță pe membrii grupului/),
    ).toBeVisible();
    expect(within(dialog).getByLabelText('Loc (opțional)')).toHaveValue(
      'Sala 305',
    );
    expect(
      within(dialog).queryByRole('checkbox', { name: 'Creează și un anunț' }),
    ).toBeNull();
    await user.clear(title);
    await user.type(title, 'Ședință mutată');
    await user.clear(within(dialog).getByLabelText('Loc (opțional)'));
    await user.type(within(dialog).getByLabelText('Loc (opțional)'), 'Online');
    await user.click(
      within(dialog).getByRole('button', { name: 'Salvează modificările' }),
    );

    expect(state.updateAsync).toHaveBeenCalledWith({
      eventId: 31,
      draft: {
        title: 'Ședință mutată',
        type: 'sedinta',
        groupId: 7,
        startsAt: '2030-10-01T15:00:00.000Z',
        endsAt: '2030-10-01T17:00:00.000Z',
        location: 'Online',
        capacity: 25,
        description: 'Planificarea lunii.',
        minLevel: 0,
        campaignId: 3,
        // #909: an edit never publishes an Announcement.
        announce: false,
      },
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Modificările sunt salvate.',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('accepts a past start when editing (update_event takes one)', async () => {
    const { user } = setup(
      event({
        startsAt: '2020-10-01T15:00:00.000Z',
        endsAt: null,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Editează' }));
    await user.click(
      await screen.findByRole('button', { name: 'Salvează modificările' }),
    );
    expect(state.updateAsync).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'calendar_manage_forbidden',
      'Nu mai ai permisiunea să gestionezi evenimentele acestui grup. Reîncarcă pagina și încearcă din nou.',
    ],
    [
      'event_not_found',
      'Evenimentul nu mai este disponibil. Reîncarcă pagina.',
    ],
    [
      'event_cancelled',
      'Evenimentul a fost deja anulat și nu mai poate fi modificat.',
    ],
  ])(
    'shows the Romanian reason for %s and keeps the values',
    async (reason, copy) => {
      state.updateAsync.mockRejectedValue({ message: reason });
      const { user } = setup();
      await user.click(screen.getByRole('button', { name: 'Editează' }));
      const dialog = await screen.findByRole('dialog', {
        name: 'Editează evenimentul',
      });
      const title = within(dialog).getByLabelText('Titlu');
      await user.clear(title);
      await user.type(title, 'Titlu păstrat');
      await user.click(
        within(dialog).getByRole('button', { name: 'Salvează modificările' }),
      );

      expect(await within(dialog).findByText(copy)).toBeVisible();
      expect(within(dialog).getByLabelText('Titlu')).toHaveValue(
        'Titlu păstrat',
      );
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    },
  );

  it('puts a field refusal under its field', async () => {
    state.updateAsync.mockRejectedValue({ message: 'invalid_event_interval' });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Editează' }));
    await user.click(
      await screen.findByRole('button', { name: 'Salvează modificările' }),
    );
    expect(
      await screen.findByText(
        'Ora de încheiere trebuie să fie după ora de început.',
      ),
    ).toBeVisible();
    expect(screen.getByLabelText(/Se încheie/)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('cannot be submitted twice: the buttons are disabled while saving', async () => {
    state.update.mockReturnValue({
      mutateAsync: state.updateAsync,
      isPending: true,
    });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Editează' }));
    expect(
      await screen.findByRole('button', { name: 'Se salvează…' }),
    ).toBeDisabled();
  });

  it('asks for a reason before cancelling, then sends cancel_event', async () => {
    const { user } = setup();
    await user.click(
      screen.getByRole('button', { name: 'Anulează evenimentul' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Anulează evenimentul',
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Confirmă anularea' }),
    );
    expect(await within(dialog).findByText('Scrie motivul.')).toBeVisible();
    expect(state.cancelAsync).not.toHaveBeenCalled();

    await user.type(
      within(dialog).getByLabelText('Motiv'),
      '  Sala nu mai este liberă.  ',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Confirmă anularea' }),
    );
    expect(state.cancelAsync).toHaveBeenCalledWith({
      eventId: 31,
      reason: 'Sala nu mai este liberă.',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Evenimentul este anulat.',
    );
  });

  it('keeps the receipt once the card turns cancelled, without the actions', async () => {
    const { user, rerender } = setup();
    await user.click(
      screen.getByRole('button', { name: 'Anulează evenimentul' }),
    );
    await user.type(
      await screen.findByLabelText('Motiv'),
      'Sala nu mai este liberă.',
    );
    await user.click(screen.getByRole('button', { name: 'Confirmă anularea' }));
    await screen.findByRole('status');

    rerender(
      <EventManageControls
        event={event({
          cancelledAt: '2030-09-01T10:00:00Z',
          cancelReason: 'Sala nu mai este liberă.',
          approvalStatus: 'approved',
          rejectionReason: null,
        })}
        groups={undefined}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Evenimentul este anulat.',
    );
    expect(screen.queryByRole('button', { name: 'Editează' })).toBeNull();
  });

  // An edit that moves the Event to another day moves its card to that day's
  // list, which mounts it afresh: the receipt must still be there.
  it('keeps the edit receipt when the card is mounted afresh', async () => {
    const { user, unmount } = setup();
    await user.click(screen.getByRole('button', { name: 'Editează' }));
    await user.click(
      await screen.findByRole('button', { name: 'Salvează modificările' }),
    );
    await screen.findByRole('status');
    unmount();

    setup(event({ startsAt: '2030-10-02T15:00:00.000Z' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Modificările sunt salvate.',
    );
    expect(screen.getByRole('status')).toHaveFocus();
  });

  it('shows a cancel refusal in Romanian inside the dialog', async () => {
    state.cancelAsync.mockRejectedValue({ message: 'event_cancelled' });
    const { user } = setup();
    await user.click(
      screen.getByRole('button', { name: 'Anulează evenimentul' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Anulează evenimentul',
    });
    await user.type(within(dialog).getByLabelText('Motiv'), 'Motiv');
    await user.click(
      within(dialog).getByRole('button', { name: 'Confirmă anularea' }),
    );
    expect(
      await within(dialog).findByText(
        'Evenimentul a fost deja anulat și nu mai poate fi modificat.',
      ),
    ).toBeVisible();
    expect(within(dialog).getByLabelText('Motiv')).toHaveValue('Motiv');
  });

  /* #1017: Șterge definitiv, for the same managers, cancelled Events too. */
  describe('Șterge definitiv', () => {
    function CalendarLine() {
      const receipt = useCalendarReceipt();
      return <p data-testid="calendar-receipt">{receipt?.text ?? ''}</p>;
    }

    it('sits apart from Editează, for a manager of the Group', () => {
      setup();
      const remove = screen.getByRole('button', { name: 'Șterge definitiv' });
      expect(remove).toHaveClass('event-manage-delete');
      expect(remove).toHaveClass('text-destructive');
    });

    it('stays on a cancelled Event, without Editează or Anulează', () => {
      setup(
        event({
          cancelledAt: '2030-09-01T10:00:00Z',
          cancelReason: 'Sala nu mai este liberă.',
          approvalStatus: 'approved',
          rejectionReason: null,
        }),
      );
      expect(
        screen.getByRole('button', { name: 'Șterge definitiv' }),
      ).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Editează' })).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Anulează evenimentul' }),
      ).toBeNull();
    });

    it('is not offered to a non-manager', () => {
      const { container } = setup(event({ groupId: 20 }));
      expect(container).toBeEmptyDOMElement();
    });

    it('names the answers that go and the Announcement that stays, then sends delete_event', async () => {
      const { user } = setup();
      render(<CalendarLine />);
      await user.click(
        screen.getByRole('button', { name: 'Șterge definitiv' }),
      );
      const dialog = await screen.findByRole('dialog', {
        name: 'Ștergi definitiv evenimentul?',
      });
      expect(dialog).toHaveAccessibleDescription(
        '„Ședință Educațional” dispare din Calendar pentru toți. Nu poate fi recuperat.',
      );
      expect(state.attendance).toHaveBeenCalledWith(31, true);
      expect(
        within(dialog).getByText(
          'Se șterg și răspunsurile membrilor: 3 confirmări și 1 refuz.',
        ),
      ).toBeVisible();
      expect(
        within(dialog).getByText(
          'Un anunț publicat odată cu evenimentul rămâne.',
        ),
      ).toBeVisible();
      await user.click(
        within(dialog).getByRole('button', { name: 'Șterge definitiv' }),
      );
      expect(state.deleteAsync).toHaveBeenCalledWith(31);
      expect(await screen.findByTestId('calendar-receipt')).toHaveTextContent(
        'Evenimentul „Ședință Educațional” a fost șters definitiv.',
      );
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('reads no answers for a deadline', async () => {
      const { user } = setup(event({ type: 'deadline' }));
      await user.click(
        screen.getByRole('button', { name: 'Șterge definitiv' }),
      );
      const dialog = await screen.findByRole('dialog');
      expect(state.attendance).toHaveBeenCalledWith(31, false);
      expect(within(dialog).queryByText(/răspunsurile/)).toBeNull();
    });

    it('shows a refusal in Romanian and keeps the dialog', async () => {
      state.deleteAsync.mockRejectedValue({
        code: '42501',
        message: 'calendar_manage_forbidden',
      });
      const { user } = setup();
      await user.click(
        screen.getByRole('button', { name: 'Șterge definitiv' }),
      );
      const dialog = await screen.findByRole('dialog');
      await user.click(
        within(dialog).getByRole('button', { name: 'Șterge definitiv' }),
      );
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Nu mai ai permisiunea să gestionezi evenimentele acestui grup.',
      );
    });
  });
});

describe('EditEventSheet in review mode (spec 2026-10-11)', () => {
  const pending = () =>
    event({
      id: 40,
      title: 'Gala OSUBB',
      groupId: 5,
      group: {
        name: 'OSUBB',
        short: 'OSUBB',
        color: '#000000',
        category: 'organization',
        path: [5],
        is_organization: true,
      },
      campaignId: null,
      createdBy: 'a-volunteer',
      approvalStatus: 'pending',
    });

  function setupReview() {
    const user = userEvent.setup();
    const onDecided = vi.fn();
    render(
      <EditEventSheet
        event={pending()}
        groups={undefined}
        options={managerOptions}
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        review={{ onDecided }}
      />,
    );
    const sheet = screen.getByRole('dialog', {
      name: 'Revizuiește evenimentul',
    });
    return { user, onDecided, sheet };
  }

  beforeEach(() => {
    state.auth.mockReturnValue({
      session: { user: { id: MEMBER } },
      claims: { member_level: 7 },
    });
    state.campaigns.mockReturnValue({ data: [] });
    state.updateAsync.mockReset().mockResolvedValue({ id: 40 });
    state.approveAsync.mockReset().mockResolvedValue({ id: 40 });
    state.rejectAsync.mockReset().mockResolvedValue({ id: 40 });
    state.update.mockReturnValue({
      mutateAsync: state.updateAsync,
      isPending: false,
    });
  });

  it('offers Respinge and Aprobă și publică over the prefilled form', () => {
    const { sheet } = setupReview();
    expect(within(sheet).getByLabelText('Titlu')).toHaveValue('Gala OSUBB');
    expect(
      within(sheet).getByRole('button', { name: 'Respinge' }),
    ).toBeVisible();
    expect(
      within(sheet).getByRole('button', { name: 'Aprobă și publică' }),
    ).toBeVisible();
    expect(
      within(sheet).queryByRole('button', { name: 'Salvează modificările' }),
    ).toBeNull();
  });

  it('saves a changed field first, then approves, and reports approved', async () => {
    const { user, onDecided, sheet } = setupReview();
    await user.type(within(sheet).getByLabelText('Titlu'), ' 2027');
    await user.click(
      within(sheet).getByRole('button', { name: 'Aprobă și publică' }),
    );

    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('approved'));
    expect(state.updateAsync).toHaveBeenCalledWith({
      eventId: 40,
      draft: expect.objectContaining({ title: 'Gala OSUBB 2027' }),
    });
    expect(state.approveAsync).toHaveBeenCalledWith({ id: 40 });
    expect(state.updateAsync.mock.invocationCallOrder[0]).toBeLessThan(
      state.approveAsync.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('approves as it stands when nothing was changed', async () => {
    const { user, onDecided, sheet } = setupReview();
    await user.click(
      within(sheet).getByRole('button', { name: 'Aprobă și publică' }),
    );

    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('approved'));
    expect(state.updateAsync).not.toHaveBeenCalled();
    expect(state.approveAsync).toHaveBeenCalledWith({ id: 40 });
  });

  it('rejects only with a written reason, and reports rejected', async () => {
    const { user, onDecided, sheet } = setupReview();
    await user.click(within(sheet).getByRole('button', { name: 'Respinge' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Respinge evenimentul',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Respinge' }));
    expect(
      await within(dialog).findByText('Scrie motivul respingerii.'),
    ).toBeInTheDocument();
    expect(state.rejectAsync).not.toHaveBeenCalled();
    expect(state.approveAsync).not.toHaveBeenCalled();

    await user.type(
      within(dialog).getByRole('textbox', { name: 'Motivul respingerii' }),
      'Data se suprapune cu Adunarea Generală.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Respinge' }));

    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('rejected'));
    expect(state.rejectAsync).toHaveBeenCalledWith({
      id: 40,
      reason: 'Data se suprapune cu Adunarea Generală.',
    });
    expect(state.updateAsync).not.toHaveBeenCalled();
  });

  it('shows the refusal when the request was already decided', async () => {
    state.approveAsync.mockRejectedValueOnce(
      new CommandError(
        { code: 'PT409', message: 'event_not_pending' },
        'Nu am putut salva decizia. Încearcă din nou.',
      ),
    );
    const { user, onDecided, sheet } = setupReview();
    await user.click(
      within(sheet).getByRole('button', { name: 'Aprobă și publică' }),
    );

    expect(
      await within(sheet).findByText('Cererea a fost deja decisă.'),
    ).toBeInTheDocument();
    expect(onDecided).not.toHaveBeenCalled();
  });
});

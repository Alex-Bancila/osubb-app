import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Group } from '../../queries/reference';
import type {
  SendResult,
  UninvitedMember,
} from '../../queries/volunteer-import';

const api = vi.hoisted(() => ({
  uninvited: vi.fn(),
  send: vi.fn(),
  contact: vi.fn(),
  groupCommand: vi.fn(),
  changeMember: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
vi.mock('../../queries/volunteer-import', async (original) => ({
  ...(await original<object>()),
  useUninvitedMembers: api.uninvited,
  sendInvitationBatch: api.send,
  updateUninvitedContact: api.contact,
}));
vi.mock('../../queries/groups-admin', async (original) => ({
  ...(await original<object>()),
  runGroupCommand: api.groupCommand,
}));
vi.mock('../../queries/member-role-management', () => ({
  changeMember: api.changeMember,
}));
vi.mock('../../queries/reference', async (original) => {
  const group = (
    id: number,
    name: string,
    category: Group['category'],
  ): [number, Group] => [
    id,
    {
      id,
      name,
      category,
      short: null,
      color: null,
      path: [id],
      parent_id: null,
      min_level: 0,
      status: 'active',
      is_organization: false,
    } as Group,
  ];
  const groups = new Map([
    group(1, 'Educațional', 'department'),
    group(2, 'Tineret', 'department'),
    group(3, 'Financiar', 'department'),
    group(9, 'Gala Voluntarilor', 'project'),
  ]);
  const roles = new Map([
    ['voluntar', { name: 'Voluntar', level: 1 }],
    ['vot', { name: 'Voluntar cu Drept de Vot', level: 3 }],
    ['bce', { name: 'BCE', level: 5 }],
    ['moderator', { name: 'Moderator', level: 7 }],
  ]);
  return {
    ...(await original<object>()),
    useGroups: () => ({ data: groups }),
    useRoles: () => ({ data: roles }),
  };
});
import { CommandError } from '../../lib/command-reasons';
import { UninvitedGrid } from './UninvitedGrid';

// Fake people only.
function person(
  index: number,
  extra: Partial<UninvitedMember> = {},
): UninvitedMember {
  return {
    memberId: `m${index}`,
    name: `Exemplu ${String(index).padStart(2, '0')}`,
    email: `v${index}@example.test`,
    phone: '+40712000000',
    role: 'voluntar',
    groups: [
      {
        groupId: 1,
        groupName: 'Educațional',
        groupRole: 'member',
        positionTitle: null,
      },
    ],
    problems: [],
    ...extra,
  };
}

function listed(members: UninvitedMember[]) {
  api.uninvited.mockReturnValue({
    isPending: false,
    isError: false,
    data: members,
  });
}

function sentAll(ids: readonly string[]): SendResult {
  return {
    rateLimited: false,
    results: ids.map((memberId) => ({
      memberId,
      status: 'sent',
      invitedAt: '2026-10-02T10:00:00Z',
      message: null,
    })),
  };
}

function show() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <UninvitedGrid />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const grid = () => screen.getByRole('region', { name: 'Membri de invitat' });

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.contact.mockResolvedValue(undefined);
  api.groupCommand.mockResolvedValue(null);
  api.changeMember.mockResolvedValue(null);
});

describe('the grid', () => {
  it('lists every never-invited Member with Departments, positions and the import notes', () => {
    listed([
      person(1, {
        role: 'bce',
        groups: [
          {
            groupId: 2,
            groupName: 'Tineret',
            groupRole: 'manager',
            positionTitle: null,
          },
          {
            groupId: 3,
            groupName: 'Financiar',
            groupRole: 'member',
            positionTitle: null,
          },
          {
            groupId: 9,
            groupName: 'Gala Voluntarilor',
            groupRole: 'responsible',
            positionTitle: 'Responsabil Logistică',
          },
        ],
        problems: [
          { code: 'note', message: 'BCE fără poziție', blocking: false },
        ],
      }),
    ]);
    show();
    const row = within(grid())
      .getByText('Exemplu 01')
      .closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('v1@example.test');
    expect(row).toHaveTextContent('+40712000000');
    expect(row).toHaveTextContent('BCE');
    // The principal Department (earliest joined) first, in bold.
    expect(within(row).getByText('Tineret')).toHaveClass('font-medium');
    expect(row).toHaveTextContent('Tineret, Financiar');
    expect(row).toHaveTextContent(
      'Manager · Tineret; Responsabil Logistică · Gala Voluntarilor',
    );
    expect(row).toHaveTextContent('BCE fără poziție');
    expect(
      within(row).getByRole('link', {
        name: 'Deschide pagina membrului Exemplu 01',
      }),
    ).toHaveAttribute('href', '/administrare/membri/m1');
  });

  it('filters by name or email and by "Cu probleme"', async () => {
    const user = userEvent.setup();
    listed([
      person(1),
      person(2, {
        problems: [
          { code: 'note', message: 'proiect lipsă: Gala', blocking: false },
        ],
      }),
    ]);
    show();
    await user.type(screen.getByLabelText('Caută după nume sau email'), 'v1@');
    expect(within(grid()).getByText('Exemplu 01')).toBeVisible();
    expect(within(grid()).queryByText('Exemplu 02')).toBeNull();
    await user.clear(screen.getByLabelText('Caută după nume sau email'));
    await user.click(screen.getByRole('button', { name: 'Cu probleme (1)' }));
    expect(within(grid()).queryByText('Exemplu 01')).toBeNull();
    expect(within(grid()).getByText('Exemplu 02')).toBeVisible();
  });

  it('falls back to every row once the last row with problems is sent', async () => {
    const user = userEvent.setup();
    listed([
      person(1),
      person(2, {
        problems: [
          { code: 'note', message: 'proiect lipsă: Gala', blocking: false },
        ],
      }),
    ]);
    api.send.mockImplementation((ids: string[]) =>
      Promise.resolve(sentAll(ids)),
    );
    show();
    await user.click(screen.getByRole('button', { name: 'Cu probleme (1)' }));
    await user.click(
      screen.getByRole('button', { name: 'Trimite invitațiile (2)' }),
    );
    await user.click(screen.getByRole('button', { name: 'Trimite' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Cu probleme/ })).toBeNull(),
    );
    expect(within(grid()).getByText('Exemplu 01')).toBeVisible();
  });

  it('says so when nobody is left to invite', () => {
    listed([]);
    show();
    expect(screen.getByText(/Nu e nimeni de invitat/)).toBeVisible();
  });
});

describe('inline edits', () => {
  it('saves a name and a phone through the profile write, normalised', async () => {
    const user = userEvent.setup();
    listed([person(1)]);
    show();
    await user.click(
      screen.getByRole('button', { name: 'Editează numele pentru Exemplu 01' }),
    );
    const name = screen.getByRole('textbox', {
      name: 'Numele pentru Exemplu 01',
    });
    await user.clear(name);
    await user.type(name, '  Pop Ana {Enter}');
    expect(api.contact).toHaveBeenCalledWith({
      memberId: 'm1',
      field: 'fullName',
      value: 'Pop Ana',
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: /Numele pentru/ }),
      ).toBeNull(),
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Editează telefonul pentru Exemplu 01',
      }),
    );
    const phone = screen.getByRole('textbox', {
      name: 'Telefonul pentru Exemplu 01',
    });
    await user.clear(phone);
    await user.type(phone, '0722 333 444{Enter}');
    expect(api.contact).toHaveBeenLastCalledWith({
      memberId: 'm1',
      field: 'phone',
      value: '+40722333444',
    });
  });

  it('corrects a never-invited address through the profile write, normalised (#997)', async () => {
    const user = userEvent.setup();
    listed([person(1)]);
    show();
    await user.click(
      screen.getByRole('button', {
        name: 'Editează emailul pentru Exemplu 01',
      }),
    );
    const email = screen.getByRole('textbox', {
      name: 'Emailul pentru Exemplu 01',
    });
    expect(email).toHaveAttribute('type', 'email');
    await user.clear(email);
    await user.type(email, '  Ana.Pop@Example.TEST {Enter}');
    expect(api.contact).toHaveBeenCalledWith({
      memberId: 'm1',
      field: 'email',
      value: 'ana.pop@example.test',
    });
  });

  it('refuses an invalid address in place and saves nothing', async () => {
    const user = userEvent.setup();
    listed([person(1)]);
    show();
    await user.click(
      screen.getByRole('button', {
        name: 'Editează emailul pentru Exemplu 01',
      }),
    );
    const email = screen.getByRole('textbox', {
      name: 'Emailul pentru Exemplu 01',
    });
    await user.clear(email);
    await user.type(email, 'ana.example.test{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Scrie o adresă de email validă.',
    );
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(api.contact).not.toHaveBeenCalled();
  });

  it("shows the server's reason for a taken address, the input still open", async () => {
    const user = userEvent.setup();
    api.contact.mockRejectedValue(
      new CommandError({ message: 'email_taken' }, 'fallback'),
    );
    listed([person(1)]);
    show();
    await user.click(
      screen.getByRole('button', {
        name: 'Editează emailul pentru Exemplu 01',
      }),
    );
    const email = screen.getByRole('textbox', {
      name: 'Emailul pentru Exemplu 01',
    });
    await user.clear(email);
    await user.type(email, 'luat@example.test{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Adresa este folosită deja de alt cont. Verifică adresa.',
    );
    expect(
      screen.getByRole('textbox', { name: 'Emailul pentru Exemplu 01' }),
    ).toBeVisible();
  });

  it('makes the address read-only once the invitation is sent', async () => {
    const user = userEvent.setup();
    listed([person(1), person(2)]);
    api.send.mockImplementation((ids: string[]) =>
      Promise.resolve(sentAll(ids)),
    );
    show();
    await user.click(
      screen.getByRole('checkbox', { name: 'Selectează Exemplu 01' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Trimite invitațiile (1)' }),
    );
    await user.click(screen.getByRole('button', { name: 'Trimite' }));
    await waitFor(() => expect(api.send).toHaveBeenCalledWith(['m1']));
    const sent = within(grid())
      .getByText('v1@example.test')
      .closest('tr') as HTMLElement;
    await waitFor(() => expect(sent).toHaveTextContent(/Invitație trimisă/));
    expect(
      screen.queryByRole('button', {
        name: 'Editează emailul pentru Exemplu 01',
      }),
    ).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Editează emailul pentru Exemplu 02',
      }),
    ).toBeVisible();
  });

  it('refuses an invalid phone in place and saves nothing; Escape puts it back', async () => {
    const user = userEvent.setup();
    listed([person(1)]);
    show();
    await user.click(
      screen.getByRole('button', {
        name: 'Editează telefonul pentru Exemplu 01',
      }),
    );
    const phone = screen.getByRole('textbox', {
      name: 'Telefonul pentru Exemplu 01',
    });
    await user.clear(phone);
    await user.type(phone, '12{Enter}');
    expect(screen.getByRole('alert')).toBeVisible();
    expect(phone).toHaveAttribute('aria-invalid', 'true');
    expect(api.contact).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(api.contact).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', {
        name: 'Editează telefonul pentru Exemplu 01',
      }),
    ).toHaveTextContent('+40712000000');
  });

  it('shows a refused save under the cell, the input still open', async () => {
    const user = userEvent.setup();
    api.contact.mockRejectedValue(new Error('full_name_too_long'));
    listed([person(1)]);
    show();
    await user.click(
      screen.getByRole('button', { name: 'Editează numele pentru Exemplu 01' }),
    );
    const name = screen.getByRole('textbox', {
      name: 'Numele pentru Exemplu 01',
    });
    await user.clear(name);
    await user.type(name, 'Alt Nume{Enter}');
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: 'Numele pentru Exemplu 01' }),
    ).toBeVisible();
  });

  it('changes the rank through set_member_role and never offers Moderator', async () => {
    const user = userEvent.setup();
    listed([person(1)]);
    show();
    await user.click(
      screen.getByRole('button', { name: 'Editează rangul pentru Exemplu 01' }),
    );
    const select = screen.getByRole('combobox', {
      name: 'Rangul pentru Exemplu 01',
    });
    expect(
      within(select).queryByRole('option', { name: 'Moderator' }),
    ).toBeNull();
    await user.selectOptions(select, 'vot');
    expect(api.changeMember).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'role', memberId: 'm1', role: 'vot' }),
    );
  });

  it('changes Departments through the Group commands', async () => {
    const user = userEvent.setup();
    listed([person(1)]);
    show();
    await user.click(
      screen.getByRole('button', {
        name: 'Editează departamentele pentru Exemplu 01',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Departamente' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Tineret' }));
    await user.click(within(dialog).getByRole('button', { name: 'Salvează' }));
    await waitFor(() =>
      expect(api.groupCommand).toHaveBeenCalledWith({
        kind: 'addMember',
        groupId: 2,
        memberId: 'm1',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('an editor beside the pinned Nume column (phone, 375 px)', () => {
  // The real grid at 375 px: the view runs 16–340, the pinned checkbox and
  // Nume end at 218, and an Email/Telefon/Rang editor opens at 222–438 —
  // wider than the 122 px beside Nume, so before the fix it opened half under
  // Nume and half past the edge.
  function phoneGeometry() {
    const rect = (left: number, right: number) =>
      ({
        left,
        right,
        x: left,
        width: right - left,
        top: 0,
        bottom: 32,
        y: 0,
        height: 32,
        toJSON: () => ({}),
      }) as DOMRect;
    return vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        if (this.getAttribute('role') === 'region') return rect(16, 340);
        if (this.matches('td') && this.querySelector('[role=checkbox]'))
          return rect(16, 56);
        if (this.matches('td') && this.textContent?.startsWith('Exemplu'))
          return rect(56, 218);
        if (this.querySelector('input,select')) return rect(222, 438);
        return rect(0, 0);
      });
  }

  function scrollSpy() {
    const scrollTo = vi.fn();
    Object.assign(grid(), { scrollTo });
    Object.defineProperty(grid(), 'clientWidth', { value: 324 });
    return scrollTo;
  }

  it.each([
    ['Editează emailul pentru Exemplu 01', 'Emailul pentru Exemplu 01'],
    ['Editează telefonul pentru Exemplu 01', 'Telefonul pentru Exemplu 01'],
    ['Editează rangul pentru Exemplu 01', 'Rangul pentru Exemplu 01'],
  ])(
    '%s: scrolls the grid so the whole editor shows, lifted over the pinned columns',
    async (button, field) => {
      const user = userEvent.setup();
      listed([person(1)]);
      show();
      const geometry = phoneGeometry();
      const scrollTo = scrollSpy();
      await user.click(screen.getByRole('button', { name: button }));
      // The right edge comes to the grid's edge: 438 - 340.
      expect(scrollTo).toHaveBeenCalledWith({ left: 98, behavior: 'instant' });
      // Lifted over the pinned body cells (z-[1]), under the header.
      const layer = screen
        .getByLabelText(field)
        .closest('[data-cell-editor]') as HTMLElement;
      expect(layer).toHaveClass('relative', 'z-[3]', 'bg-card');
      expect(grid().querySelector('thead')).toHaveClass('z-[4]');
      // While it is open, the grid drops the scroll padding that would push
      // the editor back out from under the pinned columns.
      expect(grid()).toHaveClass('has-[[data-cell-editor]]:scroll-pl-0');
      geometry.mockRestore();
    },
  );

  it('leaves the grid where it is for the pinned name editor', async () => {
    const user = userEvent.setup();
    listed([person(1)]);
    show();
    const geometry = phoneGeometry();
    const scrollTo = scrollSpy();
    await user.click(
      screen.getByRole('button', { name: 'Editează numele pentru Exemplu 01' }),
    );
    expect(
      screen.getByRole('textbox', { name: 'Numele pentru Exemplu 01' }),
    ).toHaveFocus();
    expect(scrollTo).not.toHaveBeenCalled();
    geometry.mockRestore();
  });
});

describe('Trimite invitațiile', () => {
  it('sends to the ticked rows only, after a confirmation, and marks them sent', async () => {
    const user = userEvent.setup();
    listed([person(1), person(2), person(3)]);
    api.send.mockImplementation((ids: string[]) =>
      Promise.resolve(sentAll(ids)),
    );
    show();
    await user.click(
      screen.getByRole('checkbox', { name: 'Selectează Exemplu 01' }),
    );
    await user.click(
      screen.getByRole('checkbox', { name: 'Selectează Exemplu 03' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Trimite invitațiile (2)' }),
    );
    expect(api.send).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Trimiți 2 invitații, câte 50 pe lot\?/),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Trimite' }));
    await waitFor(() => expect(api.send).toHaveBeenCalledWith(['m1', 'm3']));
    const sent = within(grid())
      .getByText('Exemplu 01')
      .closest('tr') as HTMLElement;
    expect(sent).toHaveTextContent(/Invitație trimisă · 2 oct/);
    // A sent row cannot be ticked again; the rest can.
    expect(within(sent).queryByRole('checkbox')).toBeNull();
    expect(
      screen.getByRole('progressbar', { name: 'Progresul trimiterii' }),
    ).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByText(/2 trimise din 2/)).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Trimite invitațiile (1)' }),
    ).toBeVisible();
  });

  it('selects every shown row at once from the header', async () => {
    const user = userEvent.setup();
    listed([person(1), person(2)]);
    show();
    await user.click(
      screen.getByRole('checkbox', { name: 'Selectează toți membrii afișați' }),
    );
    expect(
      screen.getByRole('checkbox', { name: 'Selectează Exemplu 02' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('button', { name: 'Trimite invitațiile (2)' }),
    ).toBeVisible();
  });

  it('sends everyone in batches, stops on the email rate limit and resumes from there', async () => {
    const user = userEvent.setup();
    const members = Array.from({ length: 30 }, (_, i) => person(i + 1));
    listed(members);
    api.send
      .mockImplementationOnce((ids: string[]) => Promise.resolve(sentAll(ids)))
      .mockImplementationOnce((ids: string[]) =>
        Promise.resolve({
          rateLimited: true,
          results: [
            ...sentAll(ids.slice(0, 2)).results,
            {
              memberId: ids[2],
              status: 'rate_limited',
              invitedAt: null,
              message: null,
            },
          ],
        }),
      )
      .mockImplementationOnce((ids: string[]) => Promise.resolve(sentAll(ids)));
    show();
    await user.selectOptions(screen.getByLabelText('Mărimea lotului'), '25');
    await user.click(
      screen.getByRole('button', { name: 'Trimite invitațiile (30)' }),
    );
    await user.click(screen.getByRole('button', { name: 'Trimite' }));
    expect(await screen.findByText(/Limita de emailuri pe oră/)).toBeVisible();
    expect(api.send).toHaveBeenCalledTimes(2);
    expect(api.send.mock.calls[0]?.[0]).toHaveLength(25);
    expect(api.send.mock.calls[1]?.[0]).toHaveLength(5);
    expect(screen.getByText(/27 trimise din 30/)).toBeVisible();
    const limited = within(grid())
      .getByText('Exemplu 28')
      .closest('tr') as HTMLElement;
    expect(limited).toHaveTextContent('limită atinsă');

    // "Reia" sends the three the limit stopped, nobody twice.
    await user.click(screen.getByRole('button', { name: 'Reia (3)' }));
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(3));
    expect(api.send.mock.calls[2]?.[0]).toEqual(['m28', 'm29', 'm30']);
    expect(await screen.findByText(/30 trimise din 30 · gata/)).toBeVisible();
  });

  it('pauses after the batch in flight and resumes with the rest', async () => {
    const user = userEvent.setup();
    listed(Array.from({ length: 30 }, (_, i) => person(i + 1)));
    let release: (value: SendResult) => void = () => {};
    api.send
      .mockImplementationOnce(
        () => new Promise<SendResult>((resolve) => (release = resolve)),
      )
      .mockImplementation((ids: string[]) => Promise.resolve(sentAll(ids)));
    show();
    await user.selectOptions(screen.getByLabelText('Mărimea lotului'), '25');
    await user.click(
      screen.getByRole('button', { name: 'Trimite invitațiile (30)' }),
    );
    await user.click(screen.getByRole('button', { name: 'Trimite' }));
    await user.click(
      await screen.findByRole('button', { name: 'Pune pe pauză' }),
    );
    expect(
      screen.getByRole('button', { name: 'Se oprește după lot…' }),
    ).toBeDisabled();
    release(sentAll((api.send.mock.calls[0]?.[0] ?? []) as string[]));
    expect(
      await screen.findByText(/25 trimise din 30 · pe pauză/),
    ).toBeVisible();
    expect(api.send).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Reia (5)' }));
    expect(await screen.findByText(/30 trimise din 30 · gata/)).toBeVisible();
  });

  it('re-sends whoever the sender did not reach in time, and names the skipped', async () => {
    const user = userEvent.setup();
    listed([person(1), person(2), person(3)]);
    api.send
      .mockImplementationOnce((ids: string[]) =>
        Promise.resolve({
          // The function's own time budget: stopped, not rate-limited.
          rateLimited: false,
          results: [
            ...sentAll(ids.slice(0, 1)).results,
            {
              memberId: ids[1],
              status: 'skipped',
              invitedAt: null,
              message: 'Membrul s-a autentificat deja.',
            },
            {
              memberId: ids[2],
              status: 'not_attempted',
              invitedAt: null,
              message: null,
            },
          ],
        }),
      )
      .mockImplementationOnce((ids: string[]) => Promise.resolve(sentAll(ids)));
    show();
    await user.click(
      screen.getByRole('button', { name: 'Trimite invitațiile (3)' }),
    );
    await user.click(screen.getByRole('button', { name: 'Trimite' }));
    expect(
      await screen.findByText(/2 trimise din 3 · 1 sărite · gata/),
    ).toBeVisible();
    expect(api.send).toHaveBeenNthCalledWith(2, ['m3']);
    const skipped = within(grid())
      .getByText('Exemplu 02')
      .closest('tr') as HTMLElement;
    expect(skipped).toHaveTextContent('sărit: Membrul s-a autentificat deja.');
  });

  it('marks a failed batch as errors and pauses instead of going on', async () => {
    const user = userEvent.setup();
    listed([person(1), person(2)]);
    api.send.mockRejectedValue(new Error('Nu am putut trimite acest lot.'));
    show();
    await user.click(
      screen.getByRole('button', { name: 'Trimite invitațiile (2)' }),
    );
    await user.click(screen.getByRole('button', { name: 'Trimite' }));
    expect(
      await screen.findByText('Nu am putut trimite acest lot.'),
    ).toBeVisible();
    const row = within(grid())
      .getByText('Exemplu 01')
      .closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('eroare');
    expect(
      screen.getByText(/0 trimise din 2 · 2 cu eroare · pe pauză/),
    ).toBeVisible();
  });

  it('reminds the dashboard settings and links the runbook', () => {
    listed([person(1)]);
    show();
    expect(screen.getByRole('note')).toHaveTextContent(/Rate limits/);
    expect(
      screen.getByRole('link', { name: 'Deschide runbook-ul' }),
    ).toHaveAttribute('href', expect.stringContaining('docs/ops/'));
  });
});

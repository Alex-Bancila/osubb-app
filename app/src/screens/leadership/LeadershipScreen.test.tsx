import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import axe from 'axe-core';
const state = vi.hoisted(() => ({
  board: vi.fn(),
  cup: vi.fn(),
  options: vi.fn(),
  access: vi.fn(),
  identities: vi.fn(),
  groups: vi.fn(),
}));
vi.mock('../../queries/leadership', () => ({
  useLeadershipLeaderboard: state.board,
  useLeadershipCup: state.cup,
  useLeadershipFilters: state.options,
  useLeaderboardIdentities: state.identities,
}));
vi.mock('../../queries/reference', () => ({ useGroups: state.groups }));
const viewer = '35400000-0000-0000-0000-000000000009';
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: viewer } } }),
}));
vi.mock('../../queries/task-tabs', () => ({ useTaskLeadership: state.access }));
import LeadershipScreen from './LeadershipScreen';
import { CLASAMENT_VIEW_STORAGE_KEY } from './clasament-view';
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
// A leadership viewer: the Member Card carries the tracker link.
vi.mock('../../lib/capabilities', () => ({
  useCapability: (name: string) => ({ data: name === 'seeLeadership' }),
}));
import { useMemberCard } from '../../test/member-card-mock';
const uid = '35400000-0000-0000-0000-000000000001';

/** The page's query string, so a test can read what the URL keeps. */
function Search() {
  return <span data-testid="search">{useLocation().search}</span>;
}
function search() {
  return new URLSearchParams(screen.getByTestId('search').textContent ?? '');
}
function renderPage(query = '') {
  return render(
    <MemoryRouter initialEntries={[`/clasament${query}`]}>
      <main>
        <Routes>
          <Route
            path="/clasament"
            element={
              <>
                <LeadershipScreen />
                <Search />
              </>
            }
          />
          <Route path="/tracker/membru/:id" element={<h1>Istoric membru</h1>} />
          <Route path="/" element={<h1>Acasă</h1>} />
        </Routes>
      </main>
    </MemoryRouter>,
  );
}
const toggle = () => screen.getByRole('group', { name: 'Vizualizare' });
const choose = (label: 'Clasament' | 'Cupa Departamentelor') =>
  within(toggle()).getByRole('button', { name: label });
const membersPanel = () =>
  screen.queryByRole('region', { name: 'Clasamentul membrilor' });
const cupPanel = () =>
  screen.queryByRole('region', { name: 'Cupa Departamentelor' });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  state.access.mockReturnValue({ data: true });
  state.identities.mockReturnValue({ data: undefined });
  state.board.mockImplementation((filters) => ({
    data: [
      {
        member_id: uid,
        full_name: 'Ioana Popescu',
        points: filters?.p_group_id ? 12 : -1234,
      },
    ],
  }));
  state.cup.mockReturnValue({
    data: [{ group_id: 7, name: 'Educație', points: -1200, members: 8 }],
  });
  state.groups.mockReturnValue({
    isPending: false,
    data: new Map([
      [7, { id: 7, name: 'Educațional', short: 'EDU', color: '#284C93' }],
      [11, { id: 11, name: 'Financiar', short: 'FIN', color: '#007F33' }],
    ]),
  });
  state.options.mockReturnValue({
    data: {
      groups: [
        { id: 7, name: 'Educație', path: [7], status: 'active' },
        { id: 9, name: 'Mentorat', path: [7, 9], status: 'active' },
      ],
      campaigns: [{ id: 3, name: 'Bun venit', group_id: 7 }],
    },
  });
});

it('opens on the members’ Clasament at full width, reading only that board', () => {
  renderPage();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Clasament',
  );
  expect(
    screen.getByText('Punctele taskurilor, pe membri și pe departamente.'),
  ).toBeInTheDocument();
  expect(choose('Clasament')).toHaveAttribute('aria-pressed', 'true');
  expect(choose('Cupa Departamentelor')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(membersPanel()).toBeInTheDocument();
  // One board at a time: the Cup is not beside it.
  expect(cupPanel()).toBeNull();
  expect(state.board).toHaveBeenLastCalledWith({});
  expect(state.cup).toHaveBeenLastCalledWith(null);
  expect(state.cup).not.toHaveBeenCalledWith(expect.anything());
  expect(state.groups).not.toHaveBeenCalled();
  expect(screen.getByText('1 membru')).toBeInTheDocument();
});

it('switches to the Cup and back, keeping the filter, the URL and this device’s choice', async () => {
  const user = userEvent.setup();
  renderPage('?campanie=3');
  await user.click(choose('Cupa Departamentelor'));
  expect(choose('Cupa Departamentelor')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(cupPanel()).toBeInTheDocument();
  expect(membersPanel()).toBeNull();
  expect(state.cup).toHaveBeenLastCalledWith({ p_campaign_id: 3 });
  expect(state.board).toHaveBeenLastCalledWith(null);
  expect(search().get('vedere')).toBe('cupa');
  expect(search().get('campanie')).toBe('3');
  expect(localStorage.getItem(CLASAMENT_VIEW_STORAGE_KEY)).toBe('cup');

  await user.click(choose('Clasament'));
  expect(membersPanel()).toBeInTheDocument();
  expect(cupPanel()).toBeNull();
  expect(state.board).toHaveBeenLastCalledWith({ p_campaign_id: 3 });
  expect(state.cup).toHaveBeenLastCalledWith(null);
  expect(search().has('vedere')).toBe(false);
  expect(search().get('campanie')).toBe('3');
  expect(localStorage.getItem(CLASAMENT_VIEW_STORAGE_KEY)).toBe('members');
});

it('opens the Cup from a ?vedere=cupa link, and from this device’s last choice', () => {
  const { unmount } = renderPage('?vedere=cupa');
  expect(cupPanel()).toBeInTheDocument();
  expect(membersPanel()).toBeNull();
  expect(state.board).not.toHaveBeenCalledWith(expect.anything());
  unmount();
  localStorage.setItem(CLASAMENT_VIEW_STORAGE_KEY, 'cup');
  renderPage();
  expect(cupPanel()).toBeInTheDocument();
  expect(choose('Cupa Departamentelor')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

it('still works when this device cannot store the choice', async () => {
  const user = userEvent.setup();
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  renderPage();
  expect(membersPanel()).toBeInTheDocument();
  await user.click(choose('Cupa Departamentelor'));
  expect(cupPanel()).toBeInTheDocument();
  get.mockRestore();
  set.mockRestore();
});

it('hides Grup principal and Subgrup in the Cup view and keeps the Group in the URL for the way back', async () => {
  const user = userEvent.setup();
  renderPage('?vedere=cupa&grup=7&subgrup=9&campanie=3');
  expect(screen.queryByRole('combobox', { name: 'Grup principal' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Subgrup' })).toBeNull();
  expect(screen.getByRole('combobox', { name: 'Campanie' })).toHaveTextContent(
    'Bun venit',
  );
  expect(state.cup).toHaveBeenLastCalledWith({ p_campaign_id: 3 });
  // No chip for a level the view hides; clearing keeps it for Clasament.
  expect(
    screen.queryByRole('button', { name: /Elimină filtrul Grup principal/ }),
  ).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Șterge filtrele' }));
  expect(state.cup).toHaveBeenLastCalledWith({});
  expect(search().get('grup')).toBe('7');
  expect(search().get('subgrup')).toBe('9');
  expect(search().has('campanie')).toBe(false);

  await user.click(choose('Clasament'));
  expect(state.board).toHaveBeenLastCalledWith({ p_group_id: 9 });
  expect(
    screen.getByRole('combobox', { name: 'Grup principal' }),
  ).toHaveTextContent('Educație');
  expect(screen.getByRole('combobox', { name: 'Subgrup' })).toHaveTextContent(
    'Mentorat',
  );
});

it('keeps no explanatory hint or intro on the page', () => {
  renderPage();
  expect(screen.queryByText(/Un membru apare sub grupul/)).toBeNull();
  expect(screen.queryByText(/Grupul include toate subgrupurile/)).toBeNull();
  expect(screen.queryByText(/Alege un rând/)).toBeNull();
});

it('sends no Work Filter argument with no level set, then the chosen ones', async () => {
  const user = userEvent.setup();
  renderPage();
  expect(state.board).toHaveBeenLastCalledWith({});
  expect(screen.getByText('−1.234')).toBeInTheDocument();
  await user.click(screen.getByRole('combobox', { name: 'Grup principal' }));
  await user.click(await screen.findByRole('option', { name: 'Educație' }));
  expect(state.board).toHaveBeenLastCalledWith({ p_group_id: 7 });
  expect(screen.getByText('12')).toBeInTheDocument();
  await user.click(screen.getByRole('combobox', { name: 'Campanie' }));
  await user.click(await screen.findByRole('option', { name: /^Bun venit/ }));
  expect(state.board).toHaveBeenLastCalledWith({
    p_group_id: 7,
    p_campaign_id: 3,
  });
  // The Group narrows only the members' board, never the Cup.
  await user.click(choose('Cupa Departamentelor'));
  expect(state.cup).toHaveBeenLastCalledWith({ p_campaign_id: 3 });
  await user.click(choose('Clasament'));
  await user.click(
    screen.getByRole('button', {
      name: 'Elimină filtrul Grup principal: Educație',
    }),
  );
  // Removing the root removes the Campaign that depended on it.
  expect(state.board).toHaveBeenLastCalledWith({});
});

it('restores all four levels from the URL and sends the midnight bounds', () => {
  renderPage(
    '?grup=7&subgrup=9&campanie=3&de_la=2026-09-01&pana_la=2026-09-30',
  );
  expect(state.board).toHaveBeenLastCalledWith({
    p_group_id: 9,
    p_campaign_id: 3,
    p_from: '2026-08-31T21:00:00.000Z',
    p_to: '2026-09-30T21:00:00.000Z',
  });
  expect(
    screen.getByRole('combobox', { name: 'Grup principal' }),
  ).toHaveTextContent('Educație');
  expect(screen.getByRole('combobox', { name: 'Subgrup' })).toHaveTextContent(
    'Mentorat',
  );
  expect(screen.getByRole('combobox', { name: 'Campanie' })).toHaveTextContent(
    'Bun venit',
  );
});

it('sends the Cup its Campaign and range from the URL, never the Group', () => {
  renderPage(
    '?vedere=cupa&grup=7&campanie=3&de_la=2026-09-01&pana_la=2026-09-30',
  );
  expect(state.cup).toHaveBeenLastCalledWith({
    p_campaign_id: 3,
    p_from: '2026-08-31T21:00:00.000Z',
    p_to: '2026-09-30T21:00:00.000Z',
  });
  expect(
    screen.getByText(
      'Campania Bun venit · puncte acordate între 1 septembrie 2026 și 30 septembrie 2026',
    ),
  ).toBeInTheDocument();
});

it('sends nothing while Până la is before De la, on either board', () => {
  const { unmount } = renderPage('?de_la=2026-09-30&pana_la=2026-09-01');
  expect(state.board).toHaveBeenLastCalledWith(null);
  expect(state.cup).toHaveBeenLastCalledWith(null);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Data de sfârșit nu poate fi înaintea celei de început.',
  );
  expect(
    screen.getByText('Corectează perioada din filtre ca să vezi rezultatele.'),
  ).toBeInTheDocument();
  unmount();
  renderPage('?vedere=cupa&de_la=2026-09-30&pana_la=2026-09-01');
  expect(state.cup).toHaveBeenLastCalledWith(null);
  expect(
    screen.getByText('Corectează perioada din filtre ca să vezi rezultatele.'),
  ).toBeInTheDocument();
});

it('draws the Cup rows with the Group’s tag, colour bar, points and member count', async () => {
  state.cup.mockReturnValue({
    data: [
      { group_id: 7, name: 'Educație', points: 26, members: 8 },
      { group_id: 11, name: 'Financiar', points: 13, members: 1 },
      { group_id: 12, name: 'Ascuns', points: -2, members: 0 },
    ],
  });
  const { container } = renderPage('?vedere=cupa');
  const rows = within(
    screen.getByRole('list', { name: 'Cupa Departamentelor' }),
  ).getAllByRole('listitem');
  expect(rows).toHaveLength(3);
  const [first, second, third] = rows as [
    HTMLElement,
    HTMLElement,
    HTMLElement,
  ];
  const bar = (row: HTMLElement) =>
    (row.querySelector('[aria-hidden="true"] > div') as HTMLElement).style
      .width;
  expect(first).toHaveTextContent('EDU');
  // The Group's own name wins over the RPC's copy.
  expect(first).toHaveTextContent('Educațional');
  expect(first).toHaveAttribute('data-slot', 'list-row');
  expect(first.querySelector('[data-slot="list-row-value"]')).toHaveTextContent(
    '26 pct.',
  );
  // The count sits beside the points, and under the bar below 640 px.
  expect(within(first).getAllByText('8 membri')).toHaveLength(2);
  expect(within(second).getAllByText('1 membru')).toHaveLength(2);
  expect(bar(first)).toBe('100%');
  expect(bar(second)).toBe('50%');
  // A Group the viewer cannot read: the RPC's name, a neutral tag, no bar.
  expect(third).toHaveTextContent('—');
  expect(third).toHaveTextContent('Ascuns');
  expect(bar(third)).toBe('0%');
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it('names each Member by Nickname as a card button whose card links to their history, with no axe violations', async () => {
  const user = userEvent.setup();
  state.board.mockReturnValue({
    data: [
      {
        member_id: uid,
        full_name: 'Ioana Popescu',
        nickname: 'Ioana',
        points: 30,
        rank: 1,
      },
    ],
  });
  useMemberCard.mockReturnValue({
    data: {
      memberId: uid,
      nickname: 'Ioana',
      fullName: 'Ioana Popescu',
      roleLabel: null,
      joinedAt: null,
      avatarColor: null,
      primaryGroup: null,
      otherMemberships: 0,
      groups: [],
      contact: null,
    },
    isPending: false,
    isError: false,
    refetch: async () => {},
  } as never);
  const { container } = renderPage();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
  const name = screen.getByRole('button', { name: 'Profilul membrului Ioana' });
  name.focus();
  await user.keyboard('{Enter}');
  const card = await screen.findByRole('dialog', { name: 'Ioana' });
  // Clicking inside the card is not a click on the row behind it.
  await user.click(within(card).getByText('Ioana Popescu'));
  expect(screen.queryByRole('heading', { name: 'Istoric membru' })).toBeNull();
  await user.click(within(card).getByRole('link', { name: 'Vezi trackerul' }));
  expect(
    screen.getByRole('heading', { name: 'Istoric membru' }),
  ).toBeInTheDocument();
});

it('says when a board fails and offers the read again', async () => {
  const retry = vi.fn();
  const cupRetry = vi.fn();
  state.board.mockReturnValue({ isError: true, refetch: retry });
  const { unmount } = renderPage();
  await userEvent.click(
    screen.getByRole('button', { name: 'Reîncarcă clasamentul' }),
  );
  expect(retry).toHaveBeenCalled();
  unmount();
  state.cup.mockReturnValue({ isError: true, refetch: cupRetry });
  renderPage('?vedere=cupa');
  await userEvent.click(screen.getByRole('button', { name: 'Reîncarcă Cupa' }));
  expect(cupRetry).toHaveBeenCalled();
});

it('shows loading and empty states without inventing totals', () => {
  state.board.mockReturnValue({ isPending: true });
  const { unmount } = renderPage();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Se încarcă clasamentul',
  );
  unmount();
  state.board.mockReturnValue({ data: [] });
  const second = renderPage();
  expect(
    screen.getByText('Nu există puncte pentru filtrele alese'),
  ).toBeInTheDocument();
  second.unmount();
  state.cup.mockReturnValue({ data: [] });
  renderPage('?vedere=cupa');
  expect(
    screen.getByText('Nu există grupuri înscrise în Cupă.'),
  ).toBeInTheDocument();
});

it('mounts no metric queries when the live leadership gate denies stale claims', () => {
  state.access.mockReturnValue({ data: false });
  renderPage();
  expect(screen.getByRole('heading', { name: 'Acasă' })).toBeInTheDocument();
  expect(state.board).not.toHaveBeenCalled();
  expect(state.cup).not.toHaveBeenCalled();
});

it('opens the same member from the non-link portion of a row', async () => {
  renderPage();
  await userEvent.click(screen.getByText('−1.234'));
  expect(
    screen.getByRole('heading', { name: 'Istoric membru' }),
  ).toBeInTheDocument();
});

it('offers the filters again when they fail to load', async () => {
  const filtersRetry = vi.fn();
  state.options.mockReturnValue({ isError: true, refetch: filtersRetry });
  renderPage();
  await userEvent.click(
    screen.getByRole('button', { name: 'Reîncarcă filtrele' }),
  );
  expect(filtersRetry).toHaveBeenCalled();
});

it('does not mount protected reads while live access is loading or failed', async () => {
  state.access.mockReturnValue({ isPending: true });
  const { unmount } = renderPage();
  expect(screen.getByRole('status')).toHaveTextContent('Se verifică accesul');
  expect(state.board).not.toHaveBeenCalled();
  unmount();
  const retry = vi.fn();
  state.access.mockReturnValue({ isError: true, refetch: retry });
  renderPage();
  await userEvent.click(
    screen.getByRole('button', { name: 'Încearcă din nou' }),
  );
  expect(retry).toHaveBeenCalled();
  expect(state.board).not.toHaveBeenCalled();
});

// The searchable Group Combobox's own "search by name or parent" behaviour
// is pinned once, on the shared component itself
// (components/group/GroupFilterCombobox.test.tsx, #646) -- this file only
// needs to prove the selection reaches the leaderboard's filters, which the
// Work Filter tests above already do.

const ana = '35400000-0000-0000-0000-000000000002';
function boardWithIdentities() {
  state.board.mockReturnValue({
    data: [
      {
        member_id: uid,
        full_name: 'Ioana Popescu',
        nickname: 'Ioana',
        points: 30,
        rank: 1,
      },
      {
        member_id: viewer,
        full_name: 'Mihai Ionescu',
        nickname: null,
        points: 30,
        rank: 1,
      },
      {
        member_id: ana,
        full_name: 'Ana Pop',
        nickname: 'Anuța',
        points: 4,
        rank: 4,
      },
    ],
  });
  state.identities.mockReturnValue({
    data: {
      [uid]: {
        avatarColor: '#284C93',
        primaryGroup: { id: 7, name: 'Educație', color: '#284C93' },
        otherMemberships: 2,
      },
      [viewer]: {
        avatarColor: null,
        primaryGroup: { id: 7, name: 'Educație', color: '#284C93' },
        otherMemberships: 0,
      },
      // An outsider: she earned points in Educație but belongs to Financiar.
      [ana]: {
        avatarColor: null,
        primaryGroup: { id: 11, name: 'Financiar', color: '#007F33' },
        otherMemberships: 0,
      },
    },
  });
}

it('draws rows on the shared list row: rank, avatar, Nickname, first Group chip and +n, points, the viewer marked tu', async () => {
  boardWithIdentities();
  const { container } = renderPage('?grup=7');
  expect(state.identities).toHaveBeenLastCalledWith([uid, viewer, ana]);
  expect(screen.getByText('3 membri')).toBeInTheDocument();
  const rows = within(
    screen.getByRole('list', { name: 'Clasamentul membrilor' }),
  ).getAllByRole('listitem');
  expect(rows).toHaveLength(3);
  const [first, second, third] = rows as [
    HTMLElement,
    HTMLElement,
    HTMLElement,
  ];
  const listRow = (row: HTMLElement) =>
    row.querySelector('[data-slot="list-row"]');
  for (const row of rows) expect(listRow(row)).not.toBeNull();
  expect(first).toHaveTextContent('Locul 1');
  // The top three are ranked in red; the rest in muted ink.
  expect(within(first).getByText('Locul').parentElement).toHaveClass(
    'text-primary',
  );
  expect(within(third).getByText('Locul').parentElement).toHaveClass(
    'text-muted-foreground',
  );
  expect(first.querySelector('[data-slot="list-row-value"]')).toHaveTextContent(
    '30 pct.',
  );
  expect(
    within(first).getByRole('button', { name: 'Profilul membrului Ioana' }),
  ).toHaveTextContent('IPIoana');
  expect(
    within(first).getByRole('button', {
      name: 'Grupul Educație. Vezi profilul membrului Ioana',
    }),
  ).toBeInTheDocument();
  expect(
    within(first).getByRole('button', {
      name: '+2 grupuri. Vezi profilul membrului Ioana',
    }),
  ).toBeInTheDocument();
  expect(within(first).queryByText('tu')).toBeNull();
  expect(listRow(first)).not.toHaveAttribute('data-mine');
  // A shared rank stays shared; the full name stands in for a missing Nickname.
  expect(second).toHaveTextContent('Locul 1');
  expect(
    within(second).getByRole('button', {
      name: 'Profilul membrului Mihai Ionescu',
    }),
  ).toBeInTheDocument();
  expect(within(second).getByText('tu')).toBeInTheDocument();
  expect(listRow(second)).toHaveAttribute('data-mine', 'true');
  // The Group filter counts the Task's Group: the outsider keeps her own chip.
  expect(state.board).toHaveBeenLastCalledWith({ p_group_id: 7 });
  expect(
    within(third).getByRole('button', {
      name: 'Grupul Financiar. Vezi profilul membrului Anuța',
    }),
  ).toBeInTheDocument();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it('gives every row its own keyboard link to the Member tracker', async () => {
  const user = userEvent.setup();
  boardWithIdentities();
  renderPage();
  const link = screen.getByRole('link', {
    name: 'Vezi trackerul membrului Anuța',
  });
  expect(link).toHaveAttribute('href', `/tracker/membru/${ana}`);
  link.focus();
  await user.keyboard('{Enter}');
  expect(
    screen.getByRole('heading', { name: 'Istoric membru' }),
  ).toBeInTheDocument();
});

it('opens the Member Card from the chip, not the tracker', async () => {
  const user = userEvent.setup();
  boardWithIdentities();
  renderPage();
  await user.click(
    screen.getByRole('button', {
      name: '+2 grupuri. Vezi profilul membrului Ioana',
    }),
  );
  expect(await screen.findByRole('dialog', { name: 'Ioana' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Istoric membru' })).toBeNull();
});

it('clearing the filter on the Clasament restores the full board and removes every URL key', async () => {
  const user = userEvent.setup();
  renderPage('?grup=7&campanie=3&de_la=2026-09-01');
  expect(state.board).toHaveBeenLastCalledWith({
    p_group_id: 7,
    p_campaign_id: 3,
    p_from: '2026-08-31T21:00:00.000Z',
  });
  await user.click(screen.getByRole('button', { name: 'Șterge filtrele' }));
  expect(state.board).toHaveBeenLastCalledWith({});
  expect(search().toString()).toBe('');
});

it('says when the row Groups failed to load and offers the read again', async () => {
  const retry = vi.fn();
  boardWithIdentities();
  state.identities.mockReturnValue({ isError: true, refetch: retry });
  renderPage();
  // The rows stay; only their chips are missing, and the page says why.
  expect(
    screen.getByRole('button', { name: 'Profilul membrului Ioana' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Grupul / })).toBeNull();
  await userEvent.click(
    screen.getByRole('button', { name: 'Reîncarcă grupurile' }),
  );
  expect(retry).toHaveBeenCalled();
});

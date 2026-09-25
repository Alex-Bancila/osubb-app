import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const api = vi.hoisted(() => ({
  campaigns: vi.fn(),
  mutate: vi.fn(),
  report: vi.fn(),
}));
vi.mock('../../queries/campaigns', async (original) => ({
  ...(await original<object>()),
  useCampaigns: api.campaigns,
  useCampaignChange: () => ({ mutateAsync: api.mutate, isPending: false }),
  useCampaignReport: api.report,
}));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
vi.mock('../../lib/capabilities', () => ({
  useCapability: () => ({ data: false }),
}));
import {
  CampaignError,
  type CampaignReportRange,
} from '../../queries/campaigns';
import { CampaignsPanel } from './CampaignsPanel';

// Axe runs over a whole list and report; give a loaded machine room.
vi.setConfig({ testTimeout: 15_000 });

/*
 * Echipa (2) under Educațional (1), with Subechipa (3) below it and a sibling
 * Tineret (4) beside it under the same parent.
 */
const groups = [
  { id: 1, name: 'Educațional', path: [1] },
  { id: 2, name: 'Echipa', path: [1, 2] },
  { id: 3, name: 'Subechipa', path: [1, 2, 3] },
  { id: 4, name: 'Tineret', path: [1, 4] },
];
const rows = [
  { id: 12, name: 'Mentorat', group_id: 3, is_active: true },
  { id: 10, name: 'Toamnă', group_id: 2, is_active: true },
  { id: 11, name: 'Vară', group_id: 2, is_active: false },
  { id: 13, name: 'Pe frate', group_id: 4, is_active: true },
  { id: 14, name: 'Pe părinte', group_id: 1, is_active: true },
];

function Where() {
  const { search } = useLocation();
  return <div data-testid="where">{search}</div>;
}
function show(
  query = '',
  range: CampaignReportRange | null | undefined = undefined,
) {
  return render(
    <MemoryRouter initialEntries={[`/administrare/grupuri/2/campanii${query}`]}>
      <CampaignsPanel
        group={{ id: 2, name: 'Echipa' }}
        label="Echipa · Educațional"
        groups={groups}
        range={range}
      />
      <Where />
    </MemoryRouter>,
  );
}
const rowNames = (list: HTMLElement) =>
  within(list)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.font-medium')?.textContent);
/** The first match, or a failed test when there is none. */
function first(elements: HTMLElement[]): HTMLElement {
  const [element] = elements;
  if (!element) throw new Error('no match');
  return element;
}
const noViolations = async (element: Element) =>
  expect(
    (
      await axe.run(element, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);

beforeEach(() => {
  api.campaigns.mockReset().mockReturnValue({ data: rows });
  api.mutate.mockReset().mockResolvedValue(rows[0]);
  api.report.mockReset().mockReturnValue({ isPending: true });
});

describe('CampaignsPanel', () => {
  it('lists the active Campaigns of the Group and every Group below it, each naming its owner', async () => {
    const { container } = show();
    const list = screen.getByRole('list', { name: 'Campanii active' });
    // The Group's own first; no sibling's or parent's Campaign; no inactive one.
    expect(rowNames(list)).toEqual(['Toamnă', 'Mentorat']);
    const [own, below] = within(list).getAllByRole('listitem');
    expect(own).toHaveTextContent('Grup: Echipa');
    expect(below).toHaveTextContent('Grup: Subechipa');
    await noViolations(container);
  });

  it('defaults the toggle to Active and keeps Inactive in the URL', async () => {
    const user = userEvent.setup();
    show();
    const active = screen.getByRole('button', { name: 'Active' });
    const inactive = screen.getByRole('button', { name: 'Inactive' });
    expect(active).toHaveAttribute('aria-pressed', 'true');
    expect(inactive).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('where')).toHaveTextContent('');

    await user.click(inactive);
    expect(screen.getByTestId('where')).toHaveTextContent('?stare=inactive');
    const list = screen.getByRole('list', { name: 'Campanii inactive' });
    expect(rowNames(list)).toEqual(['Vară']);
    expect(
      within(list).getByRole('button', { name: 'Activează' }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Active' }));
    expect(screen.getByTestId('where')).toHaveTextContent('');
  });

  it('restores Inactive from the URL and says when a state has no Campaign', () => {
    api.campaigns.mockReturnValue({
      data: rows.filter((row) => row.is_active),
    });
    show('?stare=inactive');
    expect(screen.getByRole('button', { name: 'Inactive' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByText(
        'Nicio campanie inactivă în acest grup sau în subgrupurile lui.',
      ),
    ).toBeVisible();
  });

  it('creates in the chosen Group and changes a row below it, showing the server refusal', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Campanie nouă' }));
    const create = await screen.findByRole('dialog', {
      name: 'Campanie nouă',
    });
    await user.type(within(create).getByLabelText('Numele campaniei'), 'Iarnă');
    await user.click(within(create).getByRole('button', { name: 'Creează' }));
    expect(api.mutate).toHaveBeenCalledWith({
      kind: 'create',
      groupId: 2,
      name: 'Iarnă',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    api.mutate.mockRejectedValueOnce(
      new CampaignError(
        { code: '42501', message: 'campaign_manage_forbidden' },
        'Nu am putut salva campania. Reîncearcă.',
      ),
    );
    const below = within(
      screen.getByRole('list', { name: 'Campanii active' }),
    ).getAllByRole('listitem')[1];
    if (!below) throw new Error('no second row');
    await user.click(
      within(below).getByRole('button', { name: 'Dezactivează' }),
    );
    expect(api.mutate).toHaveBeenLastCalledWith({
      kind: 'active',
      id: 12,
      active: false,
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nu mai ai permisiunea de a modifica această campanie.',
    );
  });

  it('passes the range to the report and names contributors as Member Card buttons', async () => {
    const user = userEvent.setup();
    const range = {
      p_from: '2026-08-31T21:00:00.000Z',
      p_to: '2026-09-30T21:00:00.000Z',
    };
    api.report.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        totals: { points: 12, tasksCompleted: 2, tasksTotal: 3 },
        members: [
          {
            memberId: 'ana',
            name: 'Ana Pop',
            nickname: 'Ani',
            points: 12,
            tasksCompleted: 2,
          },
        ],
      },
    });
    const { container } = show('', range);
    expect(api.report).not.toHaveBeenCalled();
    await user.click(
      first(screen.getAllByRole('button', { name: 'Vezi raportul' })),
    );
    expect(api.report).toHaveBeenCalledWith(10, range);
    expect(
      screen.getByText('Doar punctele acordate în perioada aleasă.'),
    ).toBeVisible();
    expect(screen.getByText(/din 3 taskuri finalizate/)).toBeVisible();
    await noViolations(container);
    const list = screen.getByRole('list', { name: 'Voluntari cu puncte' });
    await user.click(
      within(list).getByRole('button', { name: 'Profilul membrului Ani' }),
    );
    expect(await screen.findByRole('dialog', { name: 'Ani' })).toBeVisible();
  });

  it('reads the report undated by default and not at all while the range is inverted', async () => {
    const user = userEvent.setup();
    const { unmount } = show();
    await user.click(
      first(screen.getAllByRole('button', { name: 'Vezi raportul' })),
    );
    expect(api.report).toHaveBeenLastCalledWith(10, {});
    unmount();

    show('', null);
    await user.click(
      first(screen.getAllByRole('button', { name: 'Vezi raportul' })),
    );
    expect(api.report).toHaveBeenLastCalledWith(10, null);
    expect(screen.getByText(/Corectează perioada/)).toBeVisible();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectoryMember } from '../../queries/member-directory';
import VolunteersScreen from './VolunteersScreen';

const mock = vi.hoisted(() => ({ useMemberDirectory: vi.fn() }));
vi.mock('../../queries/member-directory', () => mock);
const members: DirectoryMember[] = [
  {
    id: 'a',
    name: 'Ștefan Pop',
    role: 'Voluntar',
    status: 'activ',
    departments: ['Educațional'],
    teams: ['Logistică'],
    points: -2,
    contact: { email: 'stefan@example.test', phone: null },
  },
  {
    id: 'b',
    name: 'Ana Ionescu',
    role: 'BC',
    status: 'inactiv',
    departments: ['Imagine & PR'],
    teams: [],
    points: 0,
    contact: undefined,
  },
];
function result(overrides = {}) {
  return {
    data: members,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  };
}
beforeEach(() => mock.useMemberDirectory.mockReturnValue(result()));
describe('Member directory', () => {
  it('searches Romanian names without requiring diacritics and combines the Department filter', async () => {
    const user = userEvent.setup();
    render(<VolunteersScreen />);
    await user.type(
      screen.getByRole('searchbox', { name: 'Caută după nume' }),
      'stefan',
    );
    expect(screen.getByText('Ștefan Pop')).toBeVisible();
    expect(screen.queryByText('Ana Ionescu')).not.toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Departament' }),
      'Imagine & PR',
    );
    expect(
      screen.getByText('Niciun membru nu corespunde filtrelor.'),
    ).toBeVisible();
  });
  it('shows named memberships, negative and zero Task points, and view-provided contacts', () => {
    render(<VolunteersScreen />);
    expect(screen.getByText('Logistică')).toBeVisible();
    expect(screen.getByText('-2')).toBeVisible();
    expect(screen.getByText('0')).toBeVisible();
    expect(screen.getByText('stefan@example.test')).toBeVisible();
    expect(screen.getByText('Inactiv')).toBeVisible();
  });
  it('does not invent contact columns when the protected view returns no contact rows', () => {
    mock.useMemberDirectory.mockReturnValue(
      result({
        data: members.map((member) => ({ ...member, contact: undefined })),
      }),
    );
    render(<VolunteersScreen />);
    expect(
      screen.queryByRole('columnheader', { name: /Email/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: /Telefon/ }),
    ).not.toBeInTheDocument();
  });
  it('offers retry on a failed read without displaying raw database errors', async () => {
    const query = result({ isError: true, data: undefined });
    mock.useMemberDirectory.mockReturnValue(query);
    render(<VolunteersScreen />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Încearcă din nou' }),
    );
    expect(query.refetch).toHaveBeenCalledOnce();
  });
  it('has loading and empty states', () => {
    mock.useMemberDirectory.mockReturnValue(result({ isPending: true }));
    const view = render(<VolunteersScreen />);
    expect(screen.getByText('Se încarcă membrii…')).toBeVisible();
    mock.useMemberDirectory.mockReturnValue(result({ data: [] }));
    view.rerender(<VolunteersScreen />);
    expect(screen.getByText('Niciun membru disponibil.')).toBeVisible();
  });
  it('sorts Task points numerically through the table controls', async () => {
    render(<VolunteersScreen />);
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Sortează Puncte din taskuri crescător',
      }),
    );
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Ștefan Pop');
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Sortează Puncte din taskuri descrescător',
      }),
    );
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Ana Ionescu');
  });
  it('has no automated accessibility violations', async () => {
    const { container } = render(<VolunteersScreen />);
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});

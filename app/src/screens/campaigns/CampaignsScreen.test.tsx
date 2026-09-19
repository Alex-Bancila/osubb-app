import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import axe from 'axe-core';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const api = vi.hoisted(() => ({
  options: vi.fn(),
  campaigns: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock('../../queries/task-form-options', () => ({
  useTaskFormOptions: api.options,
}));
vi.mock('../../queries/campaigns', async (original) => ({
  ...(await original<object>()),
  useCampaigns: api.campaigns,
  useCampaignChange: () => ({ mutateAsync: api.mutate, isPending: false }),
}));
import CampaignsScreen from './CampaignsScreen';
const campaign = { id: 10, name: 'Toamnă', group_id: 2, is_active: true };
beforeEach(() => {
  api.options.mockReturnValue({
    isSuccess: true,
    data: {
      groups: [{ id: 2, name: 'Echipa', path: [1, 2], min_level: 1 }],
      campaigns: [],
      umbrellas: [],
    },
  });
  api.campaigns.mockReturnValue({ data: [campaign] });
  api.mutate.mockResolvedValue(campaign);
});
function show(path = '/administrare/grupuri/2/campanii') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/administrare/grupuri/:groupId/campanii"
          element={<CampaignsScreen />}
        />
      </Routes>
    </MemoryRouter>,
  );
}
it('creates, renames and toggles using the owning Group and command IDs', async () => {
  const user = userEvent.setup();
  const { container } = show();
  await user.type(screen.getByLabelText('Campanie nouă'), '  Iarnă  ');
  await user.click(screen.getByRole('button', { name: 'Creează' }));
  expect(api.mutate).toHaveBeenCalledWith({
    kind: 'create',
    groupId: 2,
    name: '  Iarnă  ',
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Campanie nouă')).toHaveValue(''),
  );
  await user.clear(screen.getByLabelText('Numele campaniei'));
  await user.type(screen.getByLabelText('Numele campaniei'), 'Toamnă nouă');
  await user.click(screen.getByRole('button', { name: 'Redenumește' }));
  expect(api.mutate).toHaveBeenCalledWith({
    kind: 'rename',
    id: 10,
    name: 'Toamnă nouă',
  });
  await user.click(screen.getByRole('button', { name: 'Dezactivează' }));
  expect(api.mutate).toHaveBeenCalledWith({
    kind: 'active',
    id: 10,
    active: false,
  });
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Taskurile existente păstrează campania',
  );
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});
it('denies a typed URL outside live managed Groups and offers no mutation', () => {
  show('/administrare/grupuri/9/campanii');
  expect(screen.getByRole('alert')).toHaveTextContent('Nu ai permisiunea');
  expect(
    screen.queryByRole('button', { name: 'Creează' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Numele campaniei')).not.toBeInTheDocument();
});
it('offers activation for inactive Campaigns', async () => {
  api.campaigns.mockReturnValue({ data: [{ ...campaign, is_active: false }] });
  show();
  await userEvent.click(screen.getByRole('button', { name: 'Activează' }));
  expect(api.mutate).toHaveBeenCalledWith({
    kind: 'active',
    id: 10,
    active: true,
  });
});
it('keeps input for retry and hides unexpected server details', async () => {
  api.mutate.mockRejectedValue(new Error('private SQL detail'));
  show();
  await userEvent.type(screen.getByLabelText('Campanie nouă'), 'Iarnă');
  await userEvent.click(screen.getByRole('button', { name: 'Creează' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Nu am putut salva',
  );
  expect(screen.queryByText(/private SQL/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Campanie nouă')).toHaveValue('Iarnă');
});

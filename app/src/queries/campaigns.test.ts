import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
import {
  changeCampaign,
  fetchCampaignReport,
  fetchCampaigns,
} from './campaigns';
beforeEach(() => api.rpc.mockResolvedValue({ data: { id: 10 }, error: null }));
it('uses only the three Campaign commands and trims names', async () => {
  await changeCampaign({ kind: 'create', groupId: 2, name: ' Campanie ' });
  expect(api.rpc).toHaveBeenLastCalledWith('create_campaign', {
    p_group_id: 2,
    p_name: 'Campanie',
  });
  await changeCampaign({ kind: 'rename', id: 10, name: ' Nume ' });
  expect(api.rpc).toHaveBeenLastCalledWith('update_campaign', {
    p_campaign_id: 10,
    p_name: 'Nume',
  });
  await changeCampaign({ kind: 'active', id: 10, active: false });
  expect(api.rpc).toHaveBeenLastCalledWith('set_campaign_active', {
    p_campaign_id: 10,
    p_active: false,
  });
});
it('keeps inactive rows and reads every page in a stable order', async () => {
  const page = Array.from({ length: 500 }, (_, id) => ({
    id,
    name: 'C',
    group_id: 2,
    is_active: false,
  }));
  const query = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => query),
    eq: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({
        data:
          query.range.mock.calls.length === 1
            ? page
            : [{ ...page[0], id: 500 }],
        error: null,
      }).then(resolve),
  };
  api.from.mockReturnValue(query);
  const rows = await fetchCampaigns(2);
  expect(rows).toHaveLength(501);
  expect(rows[0]?.is_active).toBe(false);
  expect(query.eq).toHaveBeenCalledWith('group_id', 2);
  expect(query.range).toHaveBeenLastCalledWith(500, 999);
  expect(query.order).toHaveBeenCalledWith('id');
});
it('maps permission errors without leaking database text', async () => {
  api.rpc.mockResolvedValue({
    data: null,
    error: { code: '42501', message: 'campaign_manage_forbidden' },
  });
  await expect(
    changeCampaign({ kind: 'active', id: 10, active: true }),
  ).rejects.toThrow('Nu mai ai permisiunea');
});

it('normalizes stable Campaign reasons independently of status code', async () => {
  api.rpc.mockResolvedValue({
    data: null,
    error: { code: '23505', message: 'campaign_name_taken' },
  });
  await expect(
    changeCampaign({ kind: 'create', groupId: 2, name: 'Nume' }),
  ).rejects.toThrow('Există deja o campanie');
  api.rpc.mockResolvedValue({
    data: null,
    error: { code: '42501', message: 'private SQL' },
  });
  await expect(
    changeCampaign({ kind: 'active', id: 10, active: true }),
  ).rejects.toThrow('Nu am putut salva campania');
});

it('dates both report reads with the same range, and sends no bound unset', async () => {
  api.rpc.mockResolvedValue({ data: [], error: null });
  const range = {
    p_from: '2026-08-31T21:00:00.000Z',
    p_to: '2026-09-30T21:00:00.000Z',
  };
  await fetchCampaignReport(10, range);
  expect(api.rpc).toHaveBeenCalledWith('campaign_totals', {
    p_campaign_id: 10,
    ...range,
  });
  expect(api.rpc).toHaveBeenCalledWith('campaign_report', {
    p_campaign_id: 10,
    ...range,
  });
  api.rpc.mockClear();
  await fetchCampaignReport(10, { p_from: range.p_from });
  expect(api.rpc).toHaveBeenCalledWith('campaign_totals', {
    p_campaign_id: 10,
    p_from: range.p_from,
  });
  api.rpc.mockClear();
  await fetchCampaignReport(10);
  expect(api.rpc).toHaveBeenCalledWith('campaign_report', {
    p_campaign_id: 10,
  });
  expect(api.rpc).toHaveBeenCalledTimes(2);
});

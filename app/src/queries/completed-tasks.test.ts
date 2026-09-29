import { expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
import {
  createCompletedTask,
  fetchCompletedTaskExecutors,
  fetchCompletedTaskGroups,
  fetchCompletedTaskOptions,
} from './completed-tasks';

/** A PostgREST builder answering one page of `rows` for any chain. */
function builder(rows: unknown[], log: unknown[] = []) {
  const query = {
    select: (...args: unknown[]) => (log.push(['select', ...args]), query),
    eq: (...args: unknown[]) => (log.push(['eq', ...args]), query),
    order: (...args: unknown[]) => (log.push(['order', ...args]), query),
    range: async () => ({ data: rows, error: null }),
  };
  return query;
}

function readsGroupsAndCampaigns() {
  api.from.mockImplementation((table: string) =>
    table === 'groups'
      ? builder([
          { id: 7, name: 'Educație', status: 'active' },
          { id: 8, name: 'Arhivă', status: 'archived' },
          { id: 9, name: 'Mentorat', status: 'active' },
        ])
      : builder([
          { id: 3, name: 'Bun venit', group_id: 7, is_active: true },
          { id: 4, name: 'Veche', group_id: 7, is_active: false },
        ]),
  );
}

it('offers De gestionat only the active managed Groups, with the active Campaigns (#915)', async () => {
  readsGroupsAndCampaigns();
  api.rpc.mockReturnValue(
    builder([
      { id: 7, name: 'Educație', path: [7], min_level: 0 },
      { id: 8, name: 'Arhivă', path: [8], min_level: 0 },
      { id: 9, name: 'Mentorat', path: [7, 9], min_level: 2 },
    ]),
  );
  const options = await fetchCompletedTaskOptions();
  expect(api.rpc).toHaveBeenCalledWith('managed_work_groups');
  expect(options.groups.map((group) => group.id)).toEqual([7, 9]);
  expect(options.campaigns.map((campaign) => campaign.id)).toEqual([3]);
  expect(options.groupNames.get(9)).toMatchObject({ name: 'Mentorat' });
});

it('asks the server where one volunteer may be credited', async () => {
  readsGroupsAndCampaigns();
  api.rpc.mockReturnValue(
    builder([{ id: 9, name: 'Mentorat', path: [7, 9], min_level: 2 }]),
  );
  const options = await fetchCompletedTaskGroups('ana');
  expect(api.rpc).toHaveBeenCalledWith('completed_task_groups', {
    p_executor_id: 'ana',
  });
  expect(options.groups).toEqual([
    { id: 9, name: 'Mentorat', path: [7, 9], min_level: 2 },
  ]);
});

it('names the volunteers of a Group by Nickname, in Romanian order', async () => {
  api.rpc.mockReturnValue(
    builder([
      {
        member_id: 'b',
        full_name: 'Ștefan Pop',
        nickname: null,
        avatar_color: null,
      },
      {
        member_id: 'a',
        full_name: 'Ana Ionescu',
        nickname: 'Anca',
        avatar_color: '#284C93',
      },
    ]),
  );
  expect(await fetchCompletedTaskExecutors(9)).toEqual([
    { id: 'a', name: 'Anca', avatarColor: '#284C93' },
    { id: 'b', name: 'Ștefan Pop', avatarColor: null },
  ]);
  expect(api.rpc).toHaveBeenCalledWith('completed_task_executors', {
    p_group_id: 9,
  });
});

it('adds a completed Task through the one command, named arguments only', async () => {
  api.rpc.mockResolvedValue({ data: { id: 51 }, error: null });
  await createCompletedTask({
    executorId: 'ana',
    groupId: 9,
    title: 'Atelier',
    description: null,
    link: { label: null, url: null },
    campaignId: null,
    difficulty: 4,
    rating: 5,
    note: 'Excelent',
  });
  expect(api.rpc).toHaveBeenCalledWith('create_completed_task', {
    p_executor_id: 'ana',
    p_group_id: 9,
    p_title: 'Atelier',
    p_description: null,
    p_link_label: null,
    p_link_url: null,
    p_campaign_id: null,
    p_difficulty: 4,
    p_rating: 5,
    p_note: 'Excelent',
  });
});

it('turns a refusal into its Romanian copy, keeping the reason', async () => {
  api.rpc.mockResolvedValue({
    data: null,
    error: { code: 'PT409', message: 'executor_not_group_member' },
  });
  const failure = createCompletedTask({
    executorId: 'ana',
    groupId: 9,
    title: 'Atelier',
    description: null,
    link: { label: null, url: null },
    campaignId: null,
    difficulty: 4,
    rating: 5,
    note: 'Excelent',
  });
  await expect(failure).rejects.toMatchObject({
    reason: 'executor_not_group_member',
    message:
      'Voluntarul nu face parte din grupul ales sau din subgrupurile lui. Alege alt grup.',
  });
});

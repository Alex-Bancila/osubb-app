import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: api }));
import {
  expressTaskInterest,
  taskInterestMutationOptions,
  TaskInterestError,
} from './task-interest';

function reads(status: string, position: number | null = null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  api.from.mockImplementation((table) => {
    query.maybeSingle.mockResolvedValue({
      data:
        table === 'task_assignments'
          ? status === 'direct'
            ? { id: 1 }
            : null
          : table === 'task_candidates'
            ? status === 'direct'
              ? null
              : { status }
            : { my_position: position },
      error: null,
    });
    return query;
  });
  return query;
}
describe('Express Task interest', () => {
  it('sends only the Task id and returns an assigned outcome', async () => {
    api.rpc.mockResolvedValue({ error: null });
    const query = reads('direct');
    await expect(expressTaskInterest(4, 'member')).resolves.toEqual({
      kind: 'assigned',
    });
    expect(api.rpc).toHaveBeenCalledWith('express_task_interest', {
      p_task_id: 4,
    });
    expect(query.eq).toHaveBeenCalledWith('member_id', 'member');
  });
  it('returns the server queue position without counting visible Candidates', async () => {
    api.rpc.mockResolvedValue({ error: null });
    reads('pending', 5);
    await expect(expressTaskInterest(4, 'member')).resolves.toEqual({
      kind: 'queued',
      position: 5,
    });
  });
  it.each([
    ['42501', 'forbidden'],
    ['PT409', 'conflict'],
    ['PT400', 'invalid'],
    ['', 'unknown'],
  ])('maps %s to %s', async (code, kind) => {
    api.rpc.mockResolvedValue({ error: { code } });
    await expect(expressTaskInterest(4, 'member')).rejects.toMatchObject({
      kind,
    });
  });
  it('treats a changed post-command state as conflict', async () => {
    api.rpc.mockResolvedValue({ error: null });
    reads('withdrawn');
    await expect(expressTaskInterest(4, 'member')).rejects.toBeInstanceOf(
      TaskInterestError,
    );
  });
  it('invalidates all Task lists and queues even after a conflict', async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await taskInterestMutationOptions(client, 'member').onSettled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks'] });
  });
});

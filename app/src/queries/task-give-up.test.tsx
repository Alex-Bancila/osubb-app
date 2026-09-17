import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));

import { giveUpTask, taskGiveUpError, useGiveUpTask } from './task-give-up';

describe('give up task mutation', () => {
  beforeEach(() => rpc.mockReset());

  it('sends only the task and trimmed reason to the actor-derived RPC', async () => {
    rpc.mockResolvedValue({ data: { id: 17 }, error: null });

    await expect(giveUpTask(17, '  Nu mai pot ajunge.  ')).resolves.toEqual({
      id: 17,
    });
    expect(rpc).toHaveBeenCalledWith('give_up_task', {
      p_task_id: 17,
      p_reason: 'Nu mai pot ajunge.',
    });
  });

  it('rejects a blank reason before making a request', async () => {
    await expect(giveUpTask(17, '   ')).rejects.toMatchObject({
      kind: 'reason_required',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['PT400', 'reason_required'],
    ['42501', 'forbidden'],
    ['PT404', 'missing'],
    ['PT409', 'conflict'],
    ['XX000', 'unknown'],
  ] as const)('maps %s to safe kind %s', (code, kind) => {
    expect(taskGiveUpError(code)).toMatchObject({ kind });
  });

  it('invalidates the complete Tracker family after a settled mutation', async () => {
    rpc.mockResolvedValue({ data: { id: 17 }, error: null });
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useGiveUpTask(), { wrapper });

    result.current.mutate({ taskId: 17, reason: 'Program schimbat' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks'] });
  });
});

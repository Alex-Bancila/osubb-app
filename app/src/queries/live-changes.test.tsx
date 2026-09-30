import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../test/supabase-mock';
import { keys } from './keys';

vi.mock('../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../test/supabase-mock')
  >('../test/supabase-mock');
  return { supabase: supabaseClientMock };
});

import { useLiveChanges } from './live-changes';

const memberId = 'a1000000-0000-0000-0000-000000000604';

function setup() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    ({ id }: { id: string | undefined }) => useLiveChanges(id),
    { wrapper, initialProps: { id: memberId as string | undefined } },
  );
  return { queryClient, invalidate, ...view };
}

// The broadcast callback and the status callback the hook registered.
async function joined() {
  await waitFor(() => expect(supabaseMock.subscribe).toHaveBeenCalledOnce());
  return {
    onChange: supabaseMock.on.mock.calls[0]?.[2] as (message: unknown) => void,
    onStatus: supabaseMock.subscribe.mock.calls[0]?.[0] as (
      status: string,
    ) => void,
  };
}

describe('live change signals (#961)', () => {
  beforeEach(() => resetSupabaseMock());

  it('joins the private org:changes broadcast topic when the member shell mounts', async () => {
    setup();
    await joined();

    expect(supabaseMock.channel).toHaveBeenCalledWith('org:changes', {
      config: { private: true },
    });
    expect(supabaseMock.on).toHaveBeenCalledWith(
      'broadcast',
      { event: 'change' },
      expect.any(Function),
    );
  });

  it('invalidates the families a table feeds, once per burst, and nothing else', async () => {
    const { invalidate } = setup();
    const { onChange } = await joined();

    // One evaluate_task writes tasks, task_activity, task_evaluations… in
    // one transaction: the signals land together and cost one refetch.
    act(() => {
      onChange({ payload: { table: 'tasks', op: 'UPDATE' } });
      onChange({ payload: { table: 'task_activity', op: 'INSERT' } });
    });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.tasks.all }),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: keys.leadership.all,
    });
    expect(
      invalidate.mock.calls.filter(
        ([options]) => options?.queryKey === keys.tasks.all,
      ),
    ).toHaveLength(1);
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: keys.events.all,
    });
  });

  it('ignores a table it does not know and a message without one', async () => {
    const { invalidate } = setup();
    const { onChange } = await joined();

    act(() => {
      onChange({ payload: { table: 'something_new', op: 'INSERT' } });
      onChange({ payload: {} });
      onChange(undefined);
    });
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('refetches everything after a reconnect, never on the first join', async () => {
    const { invalidate } = setup();
    const { onStatus } = await joined();

    act(() => onStatus('SUBSCRIBED'));
    expect(invalidate).not.toHaveBeenCalled();

    // The socket dropped and came back: signals may have been missed.
    act(() => onStatus('CHANNEL_ERROR'));
    act(() => onStatus('SUBSCRIBED'));
    expect(invalidate).toHaveBeenCalledWith();
  });

  it('leaves the topic on sign-out and never joins without a member', async () => {
    const view = setup();
    await joined();

    view.rerender({ id: undefined });

    await waitFor(() =>
      expect(supabaseMock.removeChannel).toHaveBeenCalledWith(supabaseMock),
    );
    expect(supabaseMock.channel).toHaveBeenCalledOnce();
  });
});

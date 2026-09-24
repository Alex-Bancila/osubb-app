import { vi } from 'vitest';

export function createSupabaseMock() {
  const mocks = {
    from: vi.fn(),
    rpc: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    gt: vi.fn(),
    gte: vi.fn(),
    lt: vi.fn(),
    neq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    range: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    maybeSingle: vi.fn(),
    channel: vi.fn(),
    on: vi.fn(),
    subscribe: vi.fn(),
    removeChannel: vi.fn(),
  };
  const client = {
    from: mocks.from,
    rpc: mocks.rpc,
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
  };

  function reset() {
    for (const mock of Object.values(mocks)) mock.mockReset();

    mocks.from.mockReturnValue(mocks);
    mocks.select.mockReturnValue(mocks);
    mocks.eq.mockReturnValue(mocks);
    mocks.gt.mockReturnValue(mocks);
    mocks.gte.mockReturnValue(mocks);
    mocks.lt.mockReturnValue(mocks);
    mocks.neq.mockReturnValue(mocks);
    mocks.order.mockReturnValue(mocks);
    mocks.limit.mockReturnValue(mocks);
    mocks.range.mockReturnValue(mocks);
    mocks.update.mockReturnValue(mocks);
    mocks.delete.mockReturnValue(mocks);
    mocks.channel.mockReturnValue(mocks);
    mocks.on.mockReturnValue(mocks);
    mocks.subscribe.mockReturnValue(mocks);
  }

  reset();
  return { client, mocks, reset };
}

const sharedSupabaseMock = createSupabaseMock();
export const supabaseMock = sharedSupabaseMock.mocks;
export const supabaseClientMock = sharedSupabaseMock.client;
export const resetSupabaseMock = sharedSupabaseMock.reset;

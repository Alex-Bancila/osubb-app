import { vi } from 'vitest';

export function createSupabaseMock() {
  const mocks = {
    from: vi.fn(),
    rpc: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    gt: vi.fn(),
    gte: vi.fn(),
    neq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
  };
  const client = { from: mocks.from, rpc: mocks.rpc };

  function reset() {
    for (const mock of Object.values(mocks)) mock.mockReset();

    mocks.from.mockReturnValue(mocks);
    mocks.select.mockReturnValue(mocks);
    mocks.eq.mockReturnValue(mocks);
    mocks.gt.mockReturnValue(mocks);
    mocks.gte.mockReturnValue(mocks);
    mocks.neq.mockReturnValue(mocks);
    mocks.order.mockReturnValue(mocks);
    mocks.limit.mockReturnValue(mocks);
  }

  reset();
  return { client, mocks, reset };
}

const sharedSupabaseMock = createSupabaseMock();
export const supabaseMock = sharedSupabaseMock.mocks;
export const supabaseClientMock = sharedSupabaseMock.client;
export const resetSupabaseMock = sharedSupabaseMock.reset;

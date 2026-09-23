import { vi } from 'vitest';

/**
 * Stand-in for `queries/member-card` in screen specs: a name button opens the
 * Member Card, which stays in its loading state — enough to prove the name is
 * a button that opens the card without wiring a query client. Use it as
 * `vi.mock('…/queries/member-card', () => import('…/test/member-card-mock'))`.
 */
export const useMemberCard = vi.fn(() => ({
  data: undefined,
  isPending: true,
  isError: false,
  refetch: async () => {},
}));

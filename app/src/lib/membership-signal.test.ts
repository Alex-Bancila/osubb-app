import { describe, expect, it, vi } from 'vitest';
import { onMembershipChange, signalMembershipChange } from './membership-signal';

describe('membership signal (#959)', () => {
  it('reaches every listener until it unsubscribes', () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = onMembershipChange(first);
    const offSecond = onMembershipChange(second);

    signalMembershipChange();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();

    offFirst();
    signalMembershipChange();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
    offSecond();
  });
});

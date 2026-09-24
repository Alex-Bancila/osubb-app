import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useWorkFilter } from './use-work-filter';
import type { WorkFilterLevels } from './work-filter';

function hook(query: string, levels?: WorkFilterLevels) {
  return renderHook(() => useWorkFilter(levels), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[`/clasament${query}`]}>
        {children}
      </MemoryRouter>
    ),
  });
}

describe('useWorkFilter', () => {
  it('returns the parsed filter and its RPC arguments', () => {
    const { result } = hook(
      '?grup=1&subgrup=2&campanie=11&de_la=2026-09-01&pana_la=2026-09-30',
    );
    expect(result.current.active).toBe(true);
    expect(result.current.rangeError).toBeUndefined();
    expect(result.current.params).toEqual({
      p_group_id: 2,
      p_campaign_id: 11,
      p_from: '2026-08-31T21:00:00.000Z',
      p_to: '2026-09-30T21:00:00.000Z',
    });
  });

  it('writes a level, clears its dependents, and clears everything', () => {
    const { result } = hook('?grup=1&subgrup=2&campanie=11&de_la=2026-09-01');
    act(() => result.current.set('rootGroupId', 8));
    expect(result.current.value).toEqual({
      rootGroupId: 8,
      from: '2026-09-01',
    });
    act(() => result.current.clear());
    expect(result.current.value).toEqual({});
    expect(result.current.params).toEqual({});
    expect(result.current.active).toBe(false);
  });

  it('never sends or counts a level the page hides, even from a shared URL', () => {
    const { result } = hook(
      '?grup=1&campanie=10&de_la=2026-09-30&pana_la=2026-09-01',
      { campaign: false, dates: false },
    );
    expect(result.current.params).toEqual({ p_group_id: 1 });
    expect(result.current.rangeError).toBeUndefined();
    const hidden = hook('?campanie=10&de_la=2026-09-01', {
      campaign: false,
      dates: false,
    });
    expect(hidden.result.current.active).toBe(false);
    expect(hidden.result.current.params).toEqual({});
  });

  it('sends nothing and says why while the range is inverted', () => {
    const { result } = hook('?de_la=2026-09-30&pana_la=2026-09-01');
    expect(result.current.params).toBeNull();
    expect(result.current.rangeError).toBe(
      'Data de sfârșit nu poate fi înaintea celei de început.',
    );
  });
});

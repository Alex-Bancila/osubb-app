import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCoarsePointer } from './use-coarse-pointer';

type Listener = (event: { matches: boolean }) => void;

/** A `matchMedia` whose `(pointer: coarse)` answer the test changes. */
function mockPointer(coarse: boolean) {
  const listeners = new Set<Listener>();
  const list = {
    matches: coarse,
    media: '(pointer: coarse)',
    addEventListener: (_type: string, listener: Listener) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) =>
      listeners.delete(listener),
  };
  const matchMedia = vi.fn((query: string) => {
    expect(query).toBe('(pointer: coarse)');
    return list;
  });
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    listeners,
    change(next: boolean) {
      list.matches = next;
      for (const listener of listeners) listener({ matches: next });
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCoarsePointer (R60, decision 5)', () => {
  it('is false where matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(false);
  });

  it('answers the pointer the device has now', () => {
    mockPointer(true);
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(true);
  });

  it('follows a change of pointer live, and stops listening when unmounted', () => {
    const pointer = mockPointer(false);
    const { result, unmount } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(false);

    act(() => pointer.change(true));
    expect(result.current).toBe(true);

    act(() => pointer.change(false));
    expect(result.current).toBe(false);

    unmount();
    expect(pointer.listeners.size).toBe(0);
  });
});

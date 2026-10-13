import { describe, expect, it, vi } from 'vitest';
import { scrollTabIntoView } from './tab-scroll';

function track(scrollLeft: number, clientWidth: number) {
  return {
    scrollLeft,
    clientWidth,
    scrollTo: vi.fn(),
  } as unknown as HTMLElement & {
    scrollTo: ReturnType<typeof vi.fn>;
  };
}
const tab = (offsetLeft: number, offsetWidth: number) =>
  ({ offsetLeft, offsetWidth }) as unknown as HTMLElement;

describe('scrollTabIntoView', () => {
  it('leaves a tab already in view where it is', () => {
    const t = track(0, 300);
    scrollTabIntoView(t, tab(40, 80), false);
    expect(t.scrollLeft).toBe(0);
    expect(t.scrollTo).not.toHaveBeenCalled();
  });
  it('brings a tab cut off on the right to the right edge', () => {
    const t = track(0, 300);
    scrollTabIntoView(t, tab(260, 100), false);
    expect(t.scrollLeft).toBe(60);
  });
  it('brings a tab hidden on the left to the left edge', () => {
    const t = track(200, 300);
    scrollTabIntoView(t, tab(50, 80), false);
    expect(t.scrollLeft).toBe(50);
  });
  it('animates when motion is allowed and the element can scroll smoothly', () => {
    const t = track(0, 300);
    scrollTabIntoView(t, tab(260, 100), true);
    expect(t.scrollTo).toHaveBeenCalledWith({ left: 60, behavior: 'smooth' });
  });
});

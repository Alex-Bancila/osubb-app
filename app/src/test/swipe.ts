import { fireEvent } from '@testing-library/react';

/**
 * One finger across `element`, as a phone sends it: a touch start, one move
 * and the lift. 120 px sideways by default, `drift` px down along the way.
 */
export function swipe(
  element: Element,
  direction: 'left' | 'right',
  { distance = 120, drift = 0 }: { distance?: number; drift?: number } = {},
) {
  const startX = 200;
  const y = 100;
  const endX = direction === 'left' ? startX - distance : startX + distance;
  fireEvent.touchStart(element, {
    touches: [{ clientX: startX, clientY: y }],
  });
  fireEvent.touchMove(element, {
    touches: [{ clientX: endX, clientY: y + drift }],
  });
  fireEvent.touchEnd(element, {
    changedTouches: [{ clientX: endX, clientY: y + drift }],
  });
}

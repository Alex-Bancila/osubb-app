import type { ReactNode } from 'react';
import { cn } from 'cn';
import { useSwipeTabs } from '../../lib/swipe-tabs';

/**
 * The element holding a tab strip's panels, with the finger swipe between
 * tabs on it (`useSwipeTabs`): a swipe left opens the next tab, a swipe right
 * the previous one, as a tap on it would. For a host whose tab list is only
 * known after its data arrives, so the hook cannot sit above its early
 * returns.
 */
export function SwipePanels<T>({
  order,
  current,
  onSelect,
  className,
  children,
}: {
  order: readonly T[];
  current: T;
  onSelect: (next: T) => void;
  className?: string;
  children: ReactNode;
}) {
  const handlers = useSwipeTabs({ order, current, onSelect });
  return (
    <div {...handlers} className={cn('min-w-0', className)}>
      {children}
    </div>
  );
}

import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { EllipsisIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from 'cn';

import { Button } from '@/components/ui/button';

export type ActionMenuItem = {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  /** Drawn in the destructive colour; keep these last. */
  destructive?: boolean;
  disabled?: boolean;
};

/**
 * The secondary actions of a row or a sheet, behind one "⋯" button: a Base UI
 * menu (arrow keys, Escape, focus back on the button). A row's main action is
 * the row itself, or the one button beside this; everything else — and
 * anything destructive, last — lives here, so a list is not a wall of
 * buttons. With no items it draws nothing.
 */
export function ActionMenu({
  label = 'Mai multe acțiuni',
  items,
  trigger,
  align = 'end',
  className,
}: {
  /** The button's accessible name. */
  label?: string;
  items: readonly (ActionMenuItem | false | null | undefined)[];
  /** The button's content; the "⋯" icon by default. */
  trigger?: ReactNode;
  align?: 'start' | 'end';
  className?: string;
}) {
  const shown = items.filter((item): item is ActionMenuItem => Boolean(item));
  if (shown.length === 0) return null;
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger
        render={
          <Button
            type="button"
            variant="outline"
            size={trigger ? 'sm' : 'icon'}
            className={cn('shrink-0', className)}
          />
        }
        aria-label={trigger ? undefined : label}
        data-slot="action-menu"
      >
        {trigger ?? <EllipsisIcon aria-hidden="true" />}
      </MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          align={align}
          sideOffset={6}
          className="z-80 outline-none"
        >
          <MenuPrimitive.Popup className="min-w-48 origin-(--transform-origin) rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 transition-[opacity,scale] outline-none motion-reduce:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            {shown.map((item) => {
              const Icon = item.icon;
              return (
                <MenuPrimitive.Item
                  key={item.label}
                  disabled={item.disabled}
                  onClick={item.onSelect}
                  className={cn(
                    'flex min-h-11 cursor-default items-center gap-2.5 rounded-md px-3 text-sm font-medium outline-none select-none data-disabled:text-muted-foreground data-highlighted:bg-muted [&_svg]:size-4 [&_svg]:shrink-0',
                    item.destructive && 'text-destructive',
                  )}
                >
                  {Icon && <Icon aria-hidden="true" />}
                  {item.label}
                </MenuPrimitive.Item>
              );
            })}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

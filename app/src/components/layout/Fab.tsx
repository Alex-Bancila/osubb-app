import {
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Menu } from '@base-ui/react/menu';
import { PlusIcon, type LucideIcon } from 'lucide-react';
import { cn } from 'cn';
import { useFabPresence } from '../../lib/motion';
import { Button, buttonVariants } from '../ui/button';
import {
  FabRegistryContext,
  FabSlotContext,
  type FabActionEntry,
  type FabRegistry,
} from './fab-context';

// As tall as a phone's tab bar, which it stands beside: a rounded square
// there, the round button in the corner from `lg`.
const fabClass =
  'size-14 rounded-[1.125rem] lg:rounded-full shadow-lg shadow-black/25';

/**
 * The page's create actions, as one plus button: beside the tab bar on a
 * phone, in the content area's bottom right corner from `lg`. Wrap a `Page`'s content in it; every
 * `FabAction` below reports here instead of drawing its own button.
 *
 * - One action: the plus is that action, and carries its label as its name.
 * - Several: the plus opens a menu of them, the first nearest the thumb.
 * - None (the viewer may create nothing here): no button at all.
 *
 * From `lg` the page ends with a spacer the button's height, so the last row
 * can always be scrolled clear of it; on a phone the shell already leaves the
 * bar's height, and the button is in the bar's row.
 */
export function FabActions({
  label = 'Adaugă',
  children,
}: {
  /** The plus button's name when it opens a menu of several actions. */
  label?: string;
  children: ReactNode;
}) {
  const [actions, setActions] = useState<FabActionEntry[]>([]);
  const registry = useMemo<FabRegistry>(
    () => ({
      upsert: (entry) =>
        setActions((current) =>
          current.some((action) => action.id === entry.id)
            ? current.map((action) => (action.id === entry.id ? entry : action))
            : [...current, entry],
        ),
      remove: (id) =>
        setActions((current) => current.filter((action) => action.id !== id)),
    }),
    [],
  );
  const slot = useContext(FabSlotContext);
  const presence = useFabPresence(slot);
  const only = actions.length === 1 ? actions[0] : undefined;
  const button = only ? (
    <Button
      type="button"
      data-slot="fab"
      aria-label={only.label}
      title={only.label}
      className={fabClass}
      onClick={only.onSelect}
    >
      <PlusIcon aria-hidden="true" className="size-6" />
    </Button>
  ) : actions.length > 1 ? (
    <FabMenu label={label} actions={actions} />
  ) : null;
  // The button pops in and out (`useFabPresence`); switching between one
  // action and a menu keeps the wrapper, so it does not pop again.
  const fab = button && (
    <span ref={presence} data-slot="fab-presence" className="inline-flex">
      {button}
    </span>
  );

  return (
    <FabRegistryContext.Provider value={registry}>
      {children}
      {fab && (
        <>
          <div
            data-slot="fab-spacer"
            aria-hidden="true"
            className={cn('h-14', slot && 'max-lg:hidden')}
          />
          {slot ? (
            createPortal(fab, slot)
          ) : (
            // Outside the shell (a screen on its own) there is no slot.
            <div className="fixed right-4 bottom-4 z-10">{fab}</div>
          )}
        </>
      )}
    </FabRegistryContext.Provider>
  );
}

function FabMenu({
  label,
  actions,
}: {
  label: string;
  actions: FabActionEntry[];
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={<Button type="button" data-slot="fab" className={fabClass} />}
        aria-label={label}
      >
        <PlusIcon
          aria-hidden="true"
          className="size-6 transition-transform group-data-popup-open/button:rotate-45 motion-reduce:transition-none"
        />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="top"
          align="end"
          sideOffset={12}
          className="z-60 outline-none"
        >
          <Menu.Popup className="flex origin-bottom-right flex-col items-end gap-2 outline-none transition-[opacity,scale,translate] motion-reduce:transition-none data-ending-style:translate-y-2 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:scale-95 data-starting-style:opacity-0">
            {/* The first action sits lowest, nearest the plus. */}
            {[...actions].reverse().map((action) => {
              const Icon = action.icon;
              return (
                <Menu.Item
                  key={action.id}
                  onClick={action.onSelect}
                  className={cn(
                    buttonVariants({ variant: 'outline' }),
                    'h-12 cursor-default gap-2 rounded-full bg-card pr-5 pl-4 shadow-lg shadow-black/25 data-highlighted:bg-muted dark:bg-card dark:data-highlighted:bg-muted',
                  )}
                >
                  <Icon aria-hidden="true" className="text-primary" />
                  {action.label}
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * One create action. Inside a `FabActions` it draws nothing and becomes the
 * page's plus button (or an entry in its menu); anywhere else it is an
 * ordinary labelled button, so a control keeps working on a page that has
 * no floating button.
 */
export function FabAction({
  label,
  icon: Icon,
  onSelect,
  variant,
  className,
}: {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** The labelled button's variant, where there is no floating button. */
  variant?: 'default' | 'outline';
  className?: string;
}) {
  const registry = useContext(FabRegistryContext);
  const id = useId();
  const handler = useRef(onSelect);
  useEffect(() => {
    handler.current = onSelect;
  });
  useEffect(() => {
    registry?.upsert({
      id,
      label,
      icon: Icon,
      onSelect: () => handler.current(),
    });
  }, [registry, id, label, Icon]);
  useEffect(() => () => registry?.remove(id), [registry, id]);

  if (registry) return null;
  return (
    <Button
      type="button"
      variant={variant}
      className={cn('min-h-11', className)}
      onClick={onSelect}
    >
      <Icon aria-hidden="true" />
      {label}
    </Button>
  );
}

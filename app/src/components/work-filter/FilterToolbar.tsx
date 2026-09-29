import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { ListFilter, Search, XIcon } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '../ui/button';
import {
  Sheet,
  SheetBackdrop,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPopup,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
} from '../ui/sheet';

/** An active filter, drawn as a removable chip after the button. */
export type FilterChip = {
  /** Stable identity, so focus can find the chip that took its place. */
  key: string;
  /** The kind, drawn muted ("Grup", "De la"). */
  label: string;
  text: string;
  /** Part of a path (Grup principal › Subgrup › Campanie), joined by `›`. */
  cascade?: boolean;
  onRemove: () => void;
};

/** "1 filtru activ", "2 filtre active". */
function activeFiltersText(count: number) {
  return count === 1 ? '1 filtru activ' : `${count} filtre active`;
}

/**
 * The one **Filtrează** button (#903): the list icon, the word, and — when
 * filters are set — their number in a brand-red count. The same 44 px outline
 * button on every page, always the first control of the filter toolbar.
 */
export function FilterButton({
  count,
  className,
  ...props
}: ComponentProps<typeof Button> & { count: number }) {
  return (
    <Button
      variant="outline"
      data-slot="filter-button"
      aria-label={count ? `Filtrează, ${activeFiltersText(count)}` : undefined}
      className={cn('shrink-0', className)}
      {...props}
    >
      <ListFilter aria-hidden="true" />
      Filtrează
      {count > 0 && (
        <span
          aria-hidden="true"
          data-slot="filter-count"
          className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs leading-none font-bold text-primary-foreground tabular-nums"
        >
          {count}
        </span>
      )}
    </Button>
  );
}

/**
 * A page's search, which stays visible in the toolbar (a primary control):
 * after the button, before the chips.
 */
export function FilterSearch({
  label,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & { label: string }) {
  return (
    <label
      className={cn('relative min-w-44 flex-1 basis-56 sm:max-w-sm', className)}
    >
      <span className="sr-only">{label}</span>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        className="h-11 w-full min-w-0 rounded-lg border border-border bg-background pr-3 pl-[2.5rem] text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none dark:border-input dark:bg-input/30"
        {...props}
      />
    </label>
  );
}

/**
 * The filter toolbar (#903), the first row under a page's header (or under
 * its tab strip): **Filtrează** at the start, the page's search after it, the
 * active filters as chips after that, wrapping under it, and a page's own
 * view switch (`trailing`) at the end. The button opens one surface at every
 * width — a sheet from the right with the page's controls, **Șterge
 * filtrele** and **Vezi rezultatele** — and closing it returns focus to the
 * button. `hidden` drops the button when the filter offers the viewer
 * nothing; with no search and no chips either, nothing is drawn.
 */
export function FilterToolbar({
  label,
  title = 'Filtre',
  description,
  count,
  chips,
  onClear,
  hidden = false,
  pending = false,
  search,
  trailing,
  children,
  className,
}: {
  /** The toolbar's accessible name ("Filtre taskuri"). */
  label: string;
  /** The surface's title. */
  title?: string;
  /** A sentence under the title saying what this page's filter narrows. */
  description?: ReactNode;
  /** How many filters are set: shown on the button. */
  count: number;
  chips: readonly FilterChip[];
  /** Removes every filter the chips stand for. */
  onClear: () => void;
  /** No control to offer: the button is not drawn. */
  hidden?: boolean;
  /** The options are loading: the button waits, disabled, and says so. */
  pending?: boolean;
  search?: ReactNode;
  trailing?: ReactNode;
  /** The surface's controls, given a unique id prefix. */
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const chipRow = useRef<HTMLDivElement>(null);
  // A removed chip takes its button with it; focus moves to the chip now in
  // its place (or the one before), else back to Filtrează, and a polite live
  // region says what was removed.
  const refocus = useRef<{ index: number; key: string | null } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const pendingFocus = refocus.current;
    if (!pendingFocus) return;
    // Wait for the render in which the change has removed the chip(s).
    const gone =
      pendingFocus.key === null
        ? chips.length === 0
        : !chips.some((chip) => chip.key === pendingFocus.key);
    if (!gone) return;
    refocus.current = null;
    const buttons = [
      ...(chipRow.current?.querySelectorAll<HTMLElement>('button') ?? []),
    ];
    const target =
      pendingFocus.key === null
        ? null
        : buttons[Math.min(pendingFocus.index, buttons.length - 1)];
    (target ?? button.current)?.focus();
  });

  function remove(chip: FilterChip, index: number) {
    refocus.current = { index, key: chip.key };
    setAnnouncement(`Filtrul ${chip.label}: ${chip.text} a fost eliminat.`);
    chip.onRemove();
  }

  // From the sheet, focus stays in the sheet: nothing to move.
  function clearAll(fromSheet = false) {
    if (!fromSheet) refocus.current = { index: 0, key: null };
    setAnnouncement('Filtrele au fost șterse.');
    onClear();
  }

  if (hidden && !search && !chips.length && !trailing) return null;

  return (
    <div
      role="group"
      aria-label={label}
      data-slot="filter-toolbar"
      // Only a view switch is left at the end: the filter controls wrap
      // before it, and it drops under them on a phone.
      className={cn('flex min-w-0 flex-wrap items-center gap-2', className)}
    >
      {!hidden && (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            ref={button}
            disabled={pending}
            render={<FilterButton count={count} />}
          />
          <SheetPortal>
            <SheetBackdrop />
            <SheetPopup side="right" className="max-w-md gap-4 p-4 sm:p-6">
              <SheetHeader>
                <SheetTitle>{title}</SheetTitle>
                {description && (
                  <SheetDescription>{description}</SheetDescription>
                )}
              </SheetHeader>
              {children(id)}
              <SheetFooter>
                {count > 0 && (
                  <Button variant="outline" onClick={() => clearAll(true)}>
                    Șterge filtrele
                  </Button>
                )}
                <SheetClose render={<Button />}>Vezi rezultatele</SheetClose>
              </SheetFooter>
            </SheetPopup>
          </SheetPortal>
        </Sheet>
      )}
      {pending && (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          Se încarcă filtrele…
        </p>
      )}
      {search}
      {chips.length > 0 && (
        <div
          ref={chipRow}
          role="group"
          aria-label="Filtre active"
          className="flex min-w-0 flex-wrap items-center gap-2"
        >
          {chips.map((chip, index) => (
            <span
              key={chip.key}
              className="inline-flex max-w-full min-w-0 items-center gap-2"
            >
              {index > 0 && chip.cascade && chips[index - 1]?.cascade && (
                <span aria-hidden="true" className="text-muted-foreground">
                  ›
                </span>
              )}
              <Button
                variant="secondary"
                size="sm"
                className="max-w-full min-w-0"
                aria-label={`Elimină filtrul ${chip.label}: ${chip.text}`}
                onClick={() => remove(chip, index)}
              >
                <span className="text-muted-foreground">{chip.label}:</span>
                <span className="max-w-48 truncate">{chip.text}</span>
                <XIcon aria-hidden="true" />
              </Button>
            </span>
          ))}
          <Button variant="ghost" size="sm" onClick={() => clearAll()}>
            Șterge filtrele
          </Button>
        </div>
      )}
      {trailing && <div className="ml-auto flex">{trailing}</div>}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

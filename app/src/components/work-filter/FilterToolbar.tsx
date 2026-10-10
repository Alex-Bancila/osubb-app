import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, ListFilter, Search, XIcon } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
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
  /** Part of a path (Grup principal › Subgrup › Campanie), joined by a chevron. */
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
 * `compact` (the button on a page header's row) leaves the icon and the
 * count under 640 px; the word stays its name.
 */
export function FilterButton({
  count,
  compact = false,
  iconOnly = false,
  className,
  ...props
}: ComponentProps<typeof Button> & {
  count: number;
  compact?: boolean;
  /** Beside a search field: the icon and the count at every width. */
  iconOnly?: boolean;
}) {
  const wordClass = iconOnly
    ? 'sr-only'
    : compact
      ? 'max-sm:sr-only'
      : undefined;
  return (
    <Button
      variant="outline"
      data-slot="filter-button"
      aria-label={count ? `Filtrează, ${activeFiltersText(count)}` : undefined}
      className={cn(
        'relative shrink-0',
        iconOnly ? 'px-3' : compact && 'max-sm:px-3',
        className,
      )}
      {...props}
    >
      <ListFilter aria-hidden="true" />
      {wordClass ? <span className={wordClass}>Filtrează</span> : 'Filtrează'}
      {count > 0 && (
        <span
          aria-hidden="true"
          data-slot="filter-count"
          className={cn(
            'grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs leading-none font-bold text-primary-foreground tabular-nums',
            iconOnly && 'absolute -top-1.5 -right-1.5',
          )}
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
      className={cn('relative min-w-40 flex-1 basis-56 sm:max-w-sm', className)}
    >
      <span className="sr-only">{label}</span>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input type="search" className="pr-3 pl-[2.5rem]" {...props} />
    </label>
  );
}

/**
 * The filter toolbar (#903), the first row under a page's header (or under
 * its tab strip): **Filtrează** at the start, the page's search after it, the
 * active filters as chips after that, wrapping under it, and a page's own
 * view switch (`trailing`) at the end. The button opens one surface with the
 * page's controls and, pinned under them, **Șterge filtrele** and **Vezi
 * rezultatele** — a sheet
 * from the right, or on a phone a panel rising from the bottom as tall as
 * its controls — and closing it returns focus to the button. `hidden` drops
 * the button when the filter offers the viewer nothing; with no search and
 * no chips either, nothing is drawn.
 *
 * A page that keeps its controls on the header's row passes `buttonSlot`, an
 * element in its `PageHeader` actions: the button is drawn there, compact,
 * and this row holds only what is left (the chips), or nothing.
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
  notice,
  trailing,
  buttonSlot,
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
  /**
   * A standing note about what the page shows, after the search (the
   * Grupuri preferate chip, R43). Not a filter: not counted, not cleared.
   */
  notice?: ReactNode;
  trailing?: ReactNode;
  /** Where the button is drawn instead of this row; `null` until it mounts. */
  buttonSlot?: HTMLElement | null;
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

  if (hidden && !search && !notice && !chips.length && !trailing) return null;

  const moved = buttonSlot !== undefined;
  const sheet = !hidden && (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        ref={button}
        disabled={pending}
        render={
          <FilterButton
            count={count}
            compact={moved}
            iconOnly={!moved && Boolean(search)}
          />
        }
      />
      <SheetPortal>
        <SheetBackdrop />
        <SheetPopup side="bottom" className="gap-4 p-4 sm:max-w-md sm:p-6">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            {description && <SheetDescription>{description}</SheetDescription>}
          </SheetHeader>
          {children(id)}
          <SheetFooter pinned>
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
  );
  // With the button on the header's row, a row with nothing left takes no
  // space (the live region below is out of the flow).
  const empty = moved && !search && !chips.length && !trailing;

  return (
    <div
      role="group"
      aria-label={label}
      data-slot="filter-toolbar"
      // Only a view switch is left at the end: the filter controls wrap
      // before it, and it drops under them on a phone.
      className={cn(
        empty ? 'contents' : 'flex min-w-0 flex-wrap items-center gap-2',
        className,
      )}
    >
      {/* With a search, the search leads and fills the row; Filtrează is the
          icon button at its end. */}
      {search && !moved && search}
      {/* The page's standing note (the Grupuri preferate star) sits beside
          Filtrează, wherever that is. */}
      {moved ? (
        buttonSlot &&
        createPortal(
          <>
            {notice}
            {sheet}
          </>,
          buttonSlot,
        )
      ) : (
        <>
          {notice}
          {sheet}
        </>
      )}
      {pending && (
        <p
          role="status"
          className={cn(
            'm-0 text-sm text-muted-foreground',
            moved && 'sr-only',
          )}
        >
          Se încarcă filtrele…
        </p>
      )}
      {moved && search}
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
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
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

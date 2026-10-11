import { Popover } from '@base-ui/react/popover';
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EraserIcon,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from 'react';
import { cn } from 'cn';

import { Button } from '@/components/ui/button';
import { fieldControlClass } from '@/components/ui/input';
import { bucharestDayKey } from '@/lib/calendar-time';

/** A calendar day with no clock and no zone: `YYYY-MM-DD`. */
type DayKey = string;

const WEEKDAYS = ['L', 'Ma', 'Mi', 'J', 'V', 'S', 'D'] as const;

const monthFormatter = new Intl.DateTimeFormat('ro-RO', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});
const dayNameFormatter = new Intl.DateTimeFormat('ro-RO', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const fieldFormatter = new Intl.DateTimeFormat('ro-RO', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/* Days are handled as UTC midnights, so no device timezone or DST shift can
   move one: the picker edits a wall-clock value, which the form converts to
   an instant in Romania's time. */
function toDate(day: DayKey): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1));
}

function toKey(date: Date): DayKey {
  return date.toISOString().slice(0, 10);
}

function addDays(day: DayKey, count: number): DayKey {
  const date = toDate(day);
  date.setUTCDate(date.getUTCDate() + count);
  return toKey(date);
}

function addMonths(month: string, count: number): string {
  const date = toDate(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + count);
  return toKey(date).slice(0, 7);
}

function capitalised(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isDayKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && toKey(toDate(value)) === value;
}

function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** The weeks a month's grid shows, Monday first: only those it touches. */
function monthGrid(month: string): DayKey[] {
  const first = `${month}-01`;
  // getUTCDay: 0 is Sunday; the grid starts on Monday.
  const lead = (toDate(first).getUTCDay() + 6) % 7;
  const start = addDays(first, -lead);
  const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));
  // A sixth week that is all next month is left out (most months).
  return days[35]?.slice(0, 7) === month ? days : days.slice(0, 35);
}

/** `mie., 14 oct. 2026` or `mie., 14 oct. 2026 · 23:59`, as the field reads. */
// oxlint-disable-next-line react/only-export-components
export function formatPickerValue(value: string): string | null {
  const day = value.slice(0, 10);
  if (!isDayKey(day)) return null;
  const time = value.slice(11, 16);
  const date = fieldFormatter.format(toDate(day));
  return isTime(time) ? `${date} · ${time}` : date;
}

type PickerProps = Omit<
  ComponentProps<'button'>,
  'value' | 'onChange' | 'type' | 'children'
> & {
  /**
   * The wall-clock value, as a native field holds it: `YYYY-MM-DD` for a
   * date, `YYYY-MM-DDTHH:mm` with a time; the empty string for none.
   */
  value: string;
  onChange: (value: string) => void;
  /** Also choose an hour and minute (24-hour clock). */
  withTime?: boolean;
  /** The time a newly chosen day starts with (`23:59` for a deadline). */
  defaultTime?: string;
  /** The first day that may be chosen, `YYYY-MM-DD`. */
  min?: string;
  /** The last day that may be chosen, `YYYY-MM-DD`. */
  max?: string;
  /** The month an empty field opens on (`YYYY-MM-DD`); today's otherwise. */
  openOn?: string;
  /** No value may be left empty: no **Șterge**. */
  required?: boolean;
  placeholder?: string;
  /** Submitted with a native form under this name. */
  name?: string;
};

/**
 * The date field (DESIGN.md, "Dates are short and Romanian"): the form's own
 * field surface showing the value as the cards do, and a pop-over calendar —
 * Monday first, Romanian names, today marked — and one closing row: **Azi**,
 * **Mâine**, an eraser when the value may be empty and, with `withTime`, a
 * 24-hour time and **Gata**. It replaces the browser's date field,
 * whose order and clock follow the device's language, not the app's.
 *
 * The value is the same string a native `date` / `datetime-local` input
 * holds, so a form's conversion to an instant does not change. The trigger is
 * a button named by its `label` (a button cannot be `aria-required`: a
 * required field simply has no **Șterge**, and the form validates it); arrow keys move through the days, Page Up
 * and Page Down through the months.
 */
export function DatePicker({
  value,
  onChange,
  withTime = false,
  defaultTime = '12:00',
  min,
  max,
  openOn,
  required = false,
  placeholder,
  name,
  className,
  disabled,
  onBlur,
  ...props
}: PickerProps) {
  const [open, setOpen] = useState(false);
  const day = isDayKey(value.slice(0, 10)) ? value.slice(0, 10) : null;
  const time = isTime(value.slice(11, 16)) ? value.slice(11, 16) : null;
  const shown = formatPickerValue(value);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <button
            type="button"
            data-slot="date-picker"
            data-value={value}
            disabled={disabled}
            data-required={required || undefined}
            // Opening moves focus into the calendar: that is not the member
            // leaving the field, so a form's on-blur validation waits.
            onBlur={(event) => {
              if (!open) onBlur?.(event);
            }}
            className={cn(
              fieldControlClass,
              'flex h-11 cursor-pointer items-center justify-between gap-2 text-left hover:bg-muted dark:hover:bg-input/50',
              !shown && 'text-muted-foreground',
              className,
            )}
            {...props}
          />
        }
      >
        <span className="min-w-0 truncate">
          {shown ??
            placeholder ??
            (withTime ? 'Alege data și ora' : 'Alege data')}
        </span>
        <CalendarIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      </Popover.Trigger>
      {name && <input type="hidden" name={name} value={value} />}
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          // The popup is always its full height (spec 2026-10-11, Part D):
          // it prefers opening under the field and, near the screen's edge,
          // slides along the axis -- over the field if it must -- instead of
          // flipping and being clamped to the room on one side.
          collisionAvoidance={{
            side: 'shift',
            align: 'shift',
            fallbackAxisSide: 'none',
          }}
          className="z-80 outline-none"
        >
          <Popover.Popup
            aria-label={withTime ? 'Alege data și ora' : 'Alege data'}
            className="w-[min(20rem,calc(100vw-1.5rem))] origin-(--transform-origin) rounded-lg bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10 transition-[opacity,scale] outline-none motion-reduce:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
          >
            <Calendar
              day={day}
              time={time}
              withTime={withTime}
              defaultTime={defaultTime}
              min={min}
              max={max}
              openOn={openOn}
              required={required}
              onChange={onChange}
              onDone={() => setOpen(false)}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** `DatePicker` with a time: a deadline, an Event's start. */
export function DateTimePicker(props: Omit<PickerProps, 'withTime'>) {
  return <DatePicker withTime {...props} />;
}

function Calendar({
  day,
  time,
  withTime,
  defaultTime,
  min,
  max,
  openOn,
  required,
  onChange,
  onDone,
}: {
  day: DayKey | null;
  time: string | null;
  withTime: boolean;
  defaultTime: string;
  min: string | undefined;
  max: string | undefined;
  openOn: string | undefined;
  required: boolean;
  onChange: (value: string) => void;
  onDone: () => void;
}) {
  const titleId = useId();
  const today = useMemo(
    () => bucharestDayKey(new Date()) ?? toKey(new Date()),
    [],
  );
  const start = day ?? (openOn && isDayKey(openOn) ? openOn : today);
  const [month, setMonth] = useState(() => start.slice(0, 7));
  // The day the arrow keys are on; it is the one day in the tab order.
  const [cursor, setCursor] = useState<DayKey>(() => start);
  const [timeText, setTimeText] = useState(time ?? defaultTime);
  const grid = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  // After the render that drew the cursor's month, focus follows the keys.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-day="${cursor}"]`)?.focus();
  });

  const days = useMemo(() => monthGrid(month), [month]);
  const allowed = (candidate: DayKey) =>
    (!min || candidate >= min) && (!max || candidate <= max);

  function commit(nextDay: DayKey, nextTime: string) {
    onChange(withTime ? `${nextDay}T${nextTime}` : nextDay);
  }

  function choose(nextDay: DayKey) {
    if (!allowed(nextDay)) return;
    setCursor(nextDay);
    setMonth(nextDay.slice(0, 7));
    commit(nextDay, isTime(timeText) ? timeText : defaultTime);
    // A date alone is one decision; with a time the member confirms.
    if (!withTime) onDone();
  }

  function moveTo(nextDay: DayKey) {
    moveFocus.current = true;
    setCursor(nextDay);
    setMonth(nextDay.slice(0, 7));
  }

  function onGridKey(event: KeyboardEvent<HTMLDivElement>) {
    const step: Record<string, () => DayKey> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      PageUp: () => `${addMonths(cursor.slice(0, 7), -1)}-01`,
      PageDown: () => `${addMonths(cursor.slice(0, 7), 1)}-01`,
    };
    const next = step[event.key];
    if (!next) return;
    event.preventDefault();
    moveTo(next());
  }

  function changeTime(text: string) {
    // Digits typed without the colon still read as a time: 2359 → 23:59.
    const digits = text.replace(/\D/g, '').slice(0, 4);
    const next =
      digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
    setTimeText(next);
    if (isTime(next) && day) commit(day, next);
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Luna anterioară"
          onClick={() => setMonth((current) => addMonths(current, -1))}
        >
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
        <p id={titleId} aria-live="polite" className="m-0 text-sm font-bold">
          {capitalised(monthFormatter.format(toDate(`${month}-01`)))}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Luna următoare"
          onClick={() => setMonth((current) => addMonths(current, 1))}
        >
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>

      <div
        ref={grid}
        role="group"
        aria-labelledby={titleId}
        data-slot="date-picker-grid"
        data-month={month}
        className="grid grid-cols-7 gap-0.5"
        onKeyDown={onGridKey}
      >
        {WEEKDAYS.map((name) => (
          <span
            key={name}
            aria-hidden="true"
            className="grid h-5 place-items-center text-[11px] font-bold text-muted-foreground"
          >
            {name}
          </span>
        ))}
        {days.map((candidate) => {
          const outside = candidate.slice(0, 7) !== month;
          const selected = candidate === day;
          return (
            <button
              key={candidate}
              type="button"
              data-day={candidate}
              tabIndex={candidate === cursor ? 0 : -1}
              disabled={!allowed(candidate)}
              aria-pressed={selected}
              aria-current={candidate === today ? 'date' : undefined}
              aria-label={dayNameFormatter.format(toDate(candidate))}
              onClick={() => choose(candidate)}
              className={cn(
                'grid h-10 cursor-pointer place-items-center rounded-md text-sm tabular-nums outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-solid focus-visible:outline-ring disabled:cursor-not-allowed disabled:text-muted-foreground/50 disabled:hover:bg-transparent',
                outside && 'text-muted-foreground',
                candidate === today && 'ring-1 ring-border ring-inset',
                selected &&
                  'bg-primary font-bold text-primary-foreground hover:bg-primary',
              )}
            >
              {Number(candidate.slice(8))}
            </button>
          );
        })}
      </div>

      {/* One row ends the calendar: the shortcuts, the time, and **Gata**. */}
      <div className="flex items-center gap-1.5 border-t border-border pt-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!allowed(today)}
          onClick={() => choose(today)}
        >
          Azi
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!allowed(addDays(today, 1))}
          onClick={() => choose(addDays(today, 1))}
        >
          Mâine
        </Button>
        {!required && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Șterge"
            title="Șterge"
            disabled={!day}
            onClick={() => {
              onChange('');
              onDone();
            }}
          >
            <EraserIcon aria-hidden="true" />
          </Button>
        )}
        {withTime && (
          <>
            <label className="ml-auto flex items-center">
              <span className="sr-only">Ora</span>
              <input
                inputMode="numeric"
                autoComplete="off"
                placeholder="00:00"
                value={timeText}
                aria-invalid={timeText !== '' && !isTime(timeText)}
                onChange={(event) => changeTime(event.target.value)}
                className={cn(
                  fieldControlClass,
                  'h-11 w-[4.25rem] px-1 text-center tabular-nums',
                )}
              />
            </label>
            <Button type="button" size="sm" onClick={onDone}>
              Gata
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

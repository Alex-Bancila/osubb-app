import { useId, type KeyboardEvent, type Ref } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';

const MIN = 1;
const MAX = 5;

type RatingPickerProps = {
  /** The visible name of the control, e.g. "Nota (obligatoriu)". */
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  /** The short hint for each Rating; null where none is known yet. */
  hint: (value: number) => string | null;
  /** Shown under the control until a Rating is chosen. */
  prompt: string;
  disabled?: boolean;
  invalid?: boolean;
  /** The id of the error under the control, when there is one. */
  errorId?: string;
  /** Registers the control with the form so an error can focus it. */
  groupRef?: Ref<HTMLDivElement>;
};

/**
 * Rating as a number (ruling R29a): a quiet stepper that reads "Nota 4".
 * One `spinbutton` in the tab order — arrow keys, Home/End and the number
 * keys 1–5 set it — with − and + buttons for the pointer. It starts empty:
 * the first step up is 1, the first step down is 5, so nothing is chosen
 * for the evaluator.
 */
export function RatingPicker({
  label,
  value,
  onChange,
  hint,
  prompt,
  disabled = false,
  invalid = false,
  errorId,
  groupRef,
}: RatingPickerProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const chosenHint = value === null ? null : hint(value);
  const step = (by: 1 | -1) =>
    onChange(
      value === null
        ? by === 1
          ? MIN
          : MAX
        : Math.min(MAX, Math.max(MIN, value + by)),
    );

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const next =
      event.key === 'ArrowUp' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowDown' || event.key === 'ArrowLeft'
          ? -1
          : null;
    if (next !== null) {
      event.preventDefault();
      step(next);
    } else if (event.key === 'Home') {
      event.preventDefault();
      onChange(MIN);
    } else if (event.key === 'End') {
      event.preventDefault();
      onChange(MAX);
    } else if (/^[1-5]$/.test(event.key)) {
      event.preventDefault();
      onChange(Number(event.key));
    }
  }

  const button =
    'grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <div className="space-y-1.5">
      <p id={labelId} className="text-sm font-medium">
        {label}
      </p>
      <div
        className={cn(
          'inline-flex items-center rounded-lg border bg-background',
          invalid ? 'border-destructive' : 'border-input',
          disabled && 'opacity-50',
        )}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label="Scade nota"
          className={button}
          disabled={disabled || value === MIN}
          onClick={() => step(-1)}
        >
          <Minus aria-hidden="true" className="size-4" />
        </button>
        <div
          ref={groupRef}
          role="spinbutton"
          tabIndex={disabled ? -1 : 0}
          aria-labelledby={labelId}
          aria-describedby={
            invalid && errorId ? `${hintId} ${errorId}` : hintId
          }
          aria-invalid={invalid || undefined}
          aria-required="true"
          aria-disabled={disabled || undefined}
          aria-valuemin={MIN}
          aria-valuemax={MAX}
          aria-valuenow={value ?? undefined}
          aria-valuetext={
            value === null
              ? 'Nealeasă'
              : chosenHint
                ? `${value} — ${chosenHint}`
                : String(value)
          }
          onKeyDown={keys}
          className="flex min-h-11 min-w-24 items-baseline justify-center gap-1.5 rounded-md px-2 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
        >
          <span aria-hidden="true" className="text-sm text-muted-foreground">
            Nota
          </span>
          <span
            aria-hidden="true"
            className={cn(
              'w-4 text-center text-2xl leading-11 font-semibold tabular-nums',
              value === null && 'text-muted-foreground',
            )}
          >
            {value ?? '–'}
          </span>
        </div>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Crește nota"
          className={button}
          disabled={disabled || value === MAX}
          onClick={() => step(1)}
        >
          <Plus aria-hidden="true" className="size-4" />
        </button>
      </div>
      <p id={hintId} className="min-h-5 text-sm text-muted-foreground">
        {value === null ? (
          prompt
        ) : (
          <>
            <span className="font-semibold text-foreground tabular-nums">
              {value} din 5
            </span>
            {chosenHint && <> — {chosenHint}</>}
          </>
        )}
      </p>
    </div>
  );
}

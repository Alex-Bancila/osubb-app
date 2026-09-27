import { useId, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Star } from 'lucide-react';
import { cn } from '../../lib/utils';

const STARS = [1, 2, 3, 4, 5] as const;

/** "1 stea", "3 stele": the name a screen reader hears for one star. */
function starCount(count: number) {
  return count === 1 ? '1 stea' : `${count} stele`;
}

/**
 * A Difficulty, read at a glance (ruling R29a): five small stars, the first
 * `value` filled. One image to assistive technology, named
 * "Dificultate 3 din 5"; `label` is an optional visible prefix that the
 * image's name already covers.
 */
export function DifficultyStars({
  value,
  label,
  className,
}: {
  value: number;
  label?: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={`Dificultate ${value} din 5`}
      className={cn(
        'inline-flex items-center gap-1 align-[-0.125em]',
        className,
      )}
    >
      {label && <span aria-hidden="true">{label}</span>}
      <span aria-hidden="true" className="inline-flex gap-px">
        {STARS.map((step) => (
          <Star
            key={step}
            strokeWidth={1.75}
            className={cn(
              'size-3.5',
              step <= value
                ? 'fill-brand-red text-brand-red'
                : 'fill-transparent text-muted-foreground/60',
            )}
          />
        ))}
      </span>
    </span>
  );
}

type DifficultyStarPickerProps = {
  /** The visible name of the control, e.g. "Dificultate (obligatoriu)". */
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  /** The short note for each star (`difficulty_guide.note`); null if unknown. */
  hint: (value: number) => string | null;
  /** Shown under the stars until one is chosen. */
  prompt: string;
  disabled?: boolean;
  invalid?: boolean;
  /** The id of the error under the control, when there is one. */
  errorId?: string;
  /** Registers the control with the form so an error can focus it. */
  groupRef?: Ref<HTMLDivElement>;
};

/**
 * The signature of the Evaluation dialog (ruling R29a): Difficulty as five
 * stars in the OSUBB red. Radio semantics from Base UI — arrow keys move the
 * choice, Tab leaves it — plus the number keys 1–5 as a shortcut. Each star
 * is a 44 px target named "3 stele — <note>", so a screen reader hears the
 * words the line under the stars shows. The pointer previews a star before
 * it is chosen; the fill eases in over 120 ms unless motion is reduced.
 */
export function DifficultyStarPicker({
  label,
  value,
  onChange,
  hint,
  prompt,
  disabled = false,
  invalid = false,
  errorId,
  groupRef,
}: DifficultyStarPickerProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const [preview, setPreview] = useState<number | null>(null);
  const stars = useRef<(HTMLElement | null)[]>([]);
  const shown = preview ?? value ?? 0;
  const chosenHint = value === null ? null : hint(value);
  const name = (step: number) => {
    const text = hint(step);
    return text ? `${starCount(step)} — ${text}` : starCount(step);
  };

  function numberKey(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled || !/^[1-5]$/.test(event.key)) return;
    event.preventDefault();
    const step = Number(event.key);
    onChange(step);
    stars.current[step - 1]?.focus();
  }

  return (
    <div className="space-y-1.5">
      <p id={labelId} className="text-sm font-medium">
        {label}
      </p>
      <RadioGroup<number | null>
        ref={groupRef}
        aria-labelledby={labelId}
        aria-describedby={invalid && errorId ? `${hintId} ${errorId}` : hintId}
        aria-invalid={invalid || undefined}
        value={value}
        onValueChange={(next) => {
          if (typeof next === 'number') onChange(next);
        }}
        disabled={disabled}
        onKeyDown={numberKey}
        onPointerLeave={() => setPreview(null)}
        className="-mx-1.5 flex w-fit max-w-full"
      >
        {STARS.map((step) => {
          const lit = step <= shown;
          return (
            <Radio.Root
              key={step}
              ref={(element) => {
                stars.current[step - 1] = element;
              }}
              value={step}
              aria-label={name(step)}
              onPointerEnter={() => !disabled && setPreview(step)}
              className="group/star grid size-11 cursor-pointer place-items-center rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring data-disabled:cursor-not-allowed data-disabled:opacity-50"
            >
              <Star
                aria-hidden="true"
                strokeWidth={1.5}
                className={cn(
                  'size-8 transition-[fill,color] duration-120 ease-out motion-reduce:transition-none',
                  lit
                    ? 'fill-brand-red text-brand-red'
                    : 'fill-transparent text-muted-foreground/70',
                )}
              />
            </Radio.Root>
          );
        })}
      </RadioGroup>
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

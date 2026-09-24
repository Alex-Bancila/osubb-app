import { useId, useState, type Ref } from 'react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Star } from 'lucide-react';
import { cn } from '../../lib/utils';

const STEPS = [1, 2, 3, 4, 5] as const;

type ScoreScaleProps = {
  /** The visible name of the control, e.g. "Calificativ (obligatoriu)". */
  label: string;
  /** Stars for Rating; rising steps for Difficulty. */
  variant: 'stars' | 'steps';
  value: number | null;
  onChange: (value: number) => void;
  /** The short hint for each step; null where none is known yet. */
  hint: (value: number) => string | null;
  /** Shown under the control until a step is chosen. */
  prompt: string;
  disabled?: boolean;
  invalid?: boolean;
  /** The id of the error under the control, when there is one. */
  errorId?: string;
  /** Registers the control with the form so an error can focus it. */
  groupRef?: Ref<HTMLDivElement>;
};

/**
 * A 1–5 choice with radio semantics (ruling R22): Rating as five stars,
 * Difficulty as five rising steps. Base UI owns the radio group — arrow keys
 * move the choice, Tab leaves it — and each step is named "N — <hint>", so
 * a screen reader hears the same words the chosen-hint line shows.
 */
export function ScoreScale({
  label,
  variant,
  value,
  onChange,
  hint,
  prompt,
  disabled = false,
  invalid = false,
  errorId,
  groupRef,
}: ScoreScaleProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  // The pointer previews a step before it is chosen; the keyboard chooses.
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? value ?? 0;
  const chosenHint = value === null ? null : hint(value);
  const name = (step: number) => {
    const text = hint(step);
    return text ? `${step} — ${text}` : String(step);
  };

  return (
    <div className="space-y-2">
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
        onPointerLeave={() => setPreview(null)}
        className={cn(
          'flex w-fit max-w-full',
          variant === 'stars' ? 'gap-0.5' : 'items-end gap-1',
        )}
      >
        {STEPS.map((step) => {
          const lit = step <= shown;
          return (
            <Radio.Root
              key={step}
              value={step}
              aria-label={name(step)}
              onPointerEnter={() => !disabled && setPreview(step)}
              className="relative grid min-h-11 min-w-11 cursor-pointer place-items-center rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring data-disabled:cursor-not-allowed data-disabled:opacity-50"
            >
              {variant === 'stars' ? (
                <Star
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className={cn(
                    'size-8 transition-colors motion-reduce:transition-none',
                    lit
                      ? 'fill-primary text-primary'
                      : 'fill-transparent text-muted-foreground/60',
                  )}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 flex-col items-center justify-end gap-0.5"
                >
                  <span
                    className={cn(
                      'w-7 rounded-sm transition-colors motion-reduce:transition-none',
                      lit ? 'bg-foreground' : 'bg-muted-foreground/25',
                    )}
                    // Each step stands taller than the last: the bar is the
                    // difficulty, read at a glance.
                    style={{ height: `${step * 5}px` }}
                  />
                  <span
                    className={cn(
                      'text-xs tabular-nums',
                      step === value
                        ? 'font-bold text-foreground'
                        : 'text-muted-foreground',
                    )}
                  >
                    {step}
                  </span>
                </span>
              )}
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
              {value}
            </span>
            {chosenHint && <> — {chosenHint}</>}
          </>
        )}
      </p>
    </div>
  );
}

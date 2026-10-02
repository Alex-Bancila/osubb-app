import { useId, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Star } from 'lucide-react';
import {
  DIFFICULTY_LEVELS,
  difficultyLevel,
} from '../../lib/difficulty-levels';
import { cn } from '../../lib/utils';

const STARS = DIFFICULTY_LEVELS.filter((row) => row.kind === 'star');
const ROLES = DIFFICULTY_LEVELS.filter((row) => row.kind !== 'star');

type DifficultyPickerProps = {
  /** The visible name of the control, e.g. "Dificultate (obligatoriu)". */
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  /** The guide's interpretation of each level; null if unknown. */
  hint: (value: number) => string | null;
  /** Shown under the control until a level is chosen. */
  prompt: string;
  disabled?: boolean;
  invalid?: boolean;
  /** The id of the error under the control, when there is one. */
  errorId?: string;
  /** Registers the control with the form so an error can focus it. */
  groupRef?: Ref<HTMLDivElement>;
};

const focusRing =
  'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[-2px] focus-visible:outline-ring data-disabled:cursor-not-allowed data-disabled:opacity-50';

/**
 * Difficulty, all ten levels (ruling R29a, #986): five stars in the OSUBB red
 * for ordinary work, then the responsibilities — 🥉 Bronz, 🥈 Argint, 🥇 Aur,
 * Responsabil, Coordonator — as chips on a second row. One radio group from
 * Base UI: arrow keys walk all ten in order, Tab leaves, and the number keys
 * 1–5 choose a star. Every option is a 44 px target named with the guide's
 * interpretation ("3 stele — Task care presupune …"), the words the line under
 * the control shows. The pointer previews a star before it is chosen; the
 * fill eases in over 120 ms unless motion is reduced.
 */
export function DifficultyPicker({
  label,
  value,
  onChange,
  hint,
  prompt,
  disabled = false,
  invalid = false,
  errorId,
  groupRef,
}: DifficultyPickerProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const [preview, setPreview] = useState<number | null>(null);
  const options = useRef<(HTMLElement | null)[]>([]);
  const shown = preview ?? value ?? 0;
  const chosen = value === null ? null : difficultyLevel(value);
  const chosenHint = value === null ? null : hint(value);
  const name = (level: number) => {
    const text = hint(level);
    const title = difficultyLevel(level)?.label ?? String(level);
    return text ? `${title} — ${text}` : title;
  };

  function numberKey(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled || !/^[1-5]$/.test(event.key)) return;
    event.preventDefault();
    const step = Number(event.key);
    setPreview(null);
    onChange(step);
    options.current[step - 1]?.focus();
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
        aria-required="true"
        value={value}
        onValueChange={(next) => {
          if (typeof next !== 'number') return;
          setPreview(null);
          onChange(next);
        }}
        disabled={disabled}
        onKeyDown={numberKey}
        className="grid w-fit max-w-full gap-1"
      >
        <div
          className="-mx-1.5 flex w-fit max-w-full"
          onPointerLeave={() => setPreview(null)}
        >
          {STARS.map(({ level }) => {
            const lit = shown <= 5 && level <= shown;
            return (
              <Radio.Root
                key={level}
                ref={(element) => {
                  options.current[level - 1] = element;
                }}
                value={level}
                aria-label={name(level)}
                onPointerEnter={() => !disabled && setPreview(level)}
                className={cn(
                  'grid size-11 shrink-0 cursor-pointer place-items-center rounded-md',
                  focusRing,
                )}
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
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ROLES.map((row) => (
            <Radio.Root
              key={row.level}
              ref={(element) => {
                options.current[row.level - 1] = element;
              }}
              value={row.level}
              aria-label={name(row.level)}
              className={cn(
                'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background px-3 text-sm font-semibold text-muted-foreground hover:border-foreground/40 hover:text-foreground data-checked:border-brand-red data-checked:bg-accent data-checked:text-accent-foreground',
                focusRing,
              )}
            >
              {row.glyph && (
                <span aria-hidden="true" className="text-base leading-none">
                  {row.glyph}
                </span>
              )}
              <span aria-hidden="true">{row.label}</span>
            </Radio.Root>
          ))}
        </div>
      </RadioGroup>
      <p id={hintId} className="min-h-5 text-sm text-muted-foreground">
        {chosen === null ? (
          prompt
        ) : (
          <>
            <span className="font-semibold text-foreground tabular-nums">
              {chosen.kind === 'star'
                ? `${chosen.level} din 5`
                : `${chosen.glyph ? `${chosen.glyph} ` : ''}${chosen.label}`}
            </span>
            {chosenHint && <> — {chosenHint}</>}
          </>
        )}
      </p>
    </div>
  );
}

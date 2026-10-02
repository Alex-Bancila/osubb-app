import { Star } from 'lucide-react';
import {
  difficultyLevel,
  difficultyMarkName,
} from '../../lib/difficulty-levels';
import { useDifficultyLevels } from '../../queries/difficulty-levels';
import { cn } from '../../lib/utils';

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * A Difficulty, read at a glance (ruling R29a, #986), for every level of
 * `task_difficulty_levels`: a star level as five small stars, the first
 * `value` filled in the OSUBB red; a medal as its glyph and label
 * ("🥉 Bronz"); a text level (Responsabil, Coordonator) as its label in red
 * capitals. One image to assistive technology
 * ("Dificultate 3 din 5", "Dificultate Bronz"); `label` is an optional
 * visible prefix the image's name already covers.
 */
export function DifficultyMark({
  value,
  label,
  className,
}: {
  value: number;
  label?: string;
  className?: string;
}) {
  const levels = useDifficultyLevels().data;
  const level = difficultyLevel(levels, value);
  return (
    <span
      role="img"
      aria-label={difficultyMarkName(levels, value)}
      data-difficulty-kind={level?.kind ?? 'unknown'}
      className={cn(
        'inline-flex items-center gap-1 align-[-0.125em]',
        className,
      )}
    >
      {label && <span aria-hidden="true">{label}</span>}
      {level?.kind === 'medal' ? (
        <span aria-hidden="true" className="inline-flex items-center gap-1">
          <span className="text-[1.05em] leading-none">{level.glyph}</span>
          <span className="font-semibold">{level.label}</span>
        </span>
      ) : level?.kind === 'text' ? (
        <span
          aria-hidden="true"
          className="text-[0.8em] font-extrabold tracking-[0.06em] text-accent-foreground uppercase"
        >
          {level.label}
        </span>
      ) : level?.kind !== 'star' ? (
        // Until the levels have loaded: the bare number, never a guess.
        <span aria-hidden="true" className="font-semibold tabular-nums">
          {value}
        </span>
      ) : (
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
      )}
    </span>
  );
}

import { SubHeading } from '../../../components/layout';
import { DifficultyMark } from '../../../components/tasks/DifficultyMark';
import { difficultyName } from '../../../lib/difficulty-levels';
import { formatPoints } from '../../../lib/format';
import { ratingGuide } from './general';
import { SetButton } from './SetButton';
import { isApplied, type GuidePatch, type GuideSelection } from './selection';
import type { Experience } from './types';

type Scale = {
  ratings: readonly { rating: number; multiplier: number }[];
  difficulties: readonly { level: number; base_points: number }[];
};

const row =
  'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5';

/**
 * The general part of the guide (the "Ghid" sheet): what each Nota and each
 * Difficulty level means, with the multiplier and the base points the server
 * multiplies (when the reference data has loaded), and when a volunteer
 * counts as Începător, Intermediar or Avansat. Every Nota and Difficulty row
 * has its Setează when the guide was opened from a form.
 */
export function GuideScale({
  scale,
  experiences,
  selection,
  onSet,
}: {
  scale: Scale | undefined;
  experiences: readonly Experience[];
  selection: GuideSelection;
  onSet?: (patch: GuidePatch) => void;
}) {
  const multiplier = (value: number) =>
    scale?.ratings.find((rating) => rating.rating === value)?.multiplier;
  const basePoints = (level: number) =>
    scale?.difficulties.find((difficulty) => difficulty.level === level)
      ?.base_points;
  return (
    <div className="grid gap-6">
      <p className="m-0 rounded-md bg-muted px-3 py-2 text-sm">
        Punctaj = punctele de bază ale dificultății × multiplicatorul notei.
      </p>
      <section aria-labelledby="rating-guide-rating" className="grid gap-1">
        <SubHeading id="rating-guide-rating">
          {ratingGuide.ratingHeading}
        </SubHeading>
        <ol className="m-0 list-none divide-y divide-border p-0">
          {ratingGuide.ratings.map(({ value, interpretation }) => {
            const times = multiplier(value);
            return (
              <li key={value} className={row}>
                <span className="w-6 text-center text-xl font-bold tabular-nums">
                  {value}
                </span>
                <span className="min-w-0 text-sm wrap-anywhere">
                  {interpretation}
                  {times !== undefined && (
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      Multiplicator ×{formatPoints(times)}
                    </span>
                  )}
                </span>
                {onSet && (
                  <SetButton
                    name={`Setează Nota ${value}`}
                    patch={{ rating: value }}
                    applied={isApplied({ rating: value }, selection)}
                    onSet={onSet}
                  >
                    Setează
                  </SetButton>
                )}
              </li>
            );
          })}
        </ol>
      </section>
      <section aria-labelledby="rating-guide-difficulty" className="grid gap-1">
        <SubHeading id="rating-guide-difficulty">
          {ratingGuide.difficultyHeading}
        </SubHeading>
        <ol className="m-0 list-none divide-y divide-border p-0">
          {ratingGuide.difficulties.map(({ level, interpretation }) => {
            const base = basePoints(level);
            return (
              <li key={level} className={row}>
                <span className="w-24">
                  <DifficultyMark value={level} />
                </span>
                <span className="min-w-0 text-sm wrap-anywhere">
                  {interpretation}
                  {base !== undefined && (
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {base === 1 ? '1 punct' : `${base} puncte`} de bază
                    </span>
                  )}
                </span>
                {onSet && (
                  <SetButton
                    name={`Setează Dificultate ${difficultyName(level)}`}
                    patch={{ difficulty: level }}
                    applied={isApplied({ difficulty: level }, selection)}
                    onSet={onSet}
                  >
                    Setează
                  </SetButton>
                )}
              </li>
            );
          })}
        </ol>
      </section>
      <section aria-labelledby="rating-guide-experience" className="grid gap-3">
        <SubHeading id="rating-guide-experience">
          {ratingGuide.experienceHeading}
        </SubHeading>
        <ExperienceRules experiences={experiences} />
      </section>
    </div>
  );
}

/**
 * When a volunteer counts as Începător or Avansat (the Ghid sheet's two
 * columns), and Intermediar where the Group's list has that column.
 */
export function ExperienceRules({
  experiences,
}: {
  experiences: readonly Experience[];
}) {
  const shown: Experience[] = experiences.includes('intermediar')
    ? ['incepator', 'intermediar', 'avansat']
    : ['incepator', 'avansat'];
  return (
    <div
      className={
        shown.length === 3
          ? 'grid gap-4 sm:grid-cols-3'
          : 'grid gap-4 sm:grid-cols-2'
      }
    >
      {shown.map((key) => {
        const experience = ratingGuide.experiences[key];
        return (
          <div key={key} className="grid content-start gap-1.5 text-sm">
            <h4 className="m-0 text-sm font-semibold">{experience.name}</h4>
            <p className="m-0">{experience.rule}</p>
            {experience.signs.length > 0 && (
              <ul className="m-0 grid list-disc gap-1 pl-5 text-muted-foreground">
                {experience.signs.map((sign) => (
                  <li key={sign}>{sign}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

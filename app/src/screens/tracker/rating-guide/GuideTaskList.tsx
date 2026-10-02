import { useId, useMemo, useState } from 'react';
import { SearchIcon } from 'lucide-react';
import { SubHeading } from '../../../components/layout';
import { DifficultyMark } from '../../../components/tasks/DifficultyMark';
import { Button } from '../../../components/ui/button';
import { difficultyName } from '../../../lib/difficulty-levels';
import { ratingGuide } from './general';
import { ExperienceRules } from './GuideScale';
import { SetButton } from './SetButton';
import { isApplied, type GuidePatch, type GuideSelection } from './selection';
import { SEARCH_FROM, taskOptions } from './task-options';
import type { Experience, GuideSheet, GuideTask } from './types';

const experienceNames = (experiences: readonly Experience[]) =>
  experiences.map((key) => ratingGuide.experiences[key].name).join(' / ');

/** Lower case without diacritics, so "sedinta" finds "Ședință". */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('ro');

/**
 * "Taskuri în <Grup>": the Group's own list from the guide, by Domeniu where
 * the sheet has them, each row with its Setează per experience column. A
 * long list is searchable by task and description. Many rows share a value,
 * so only the Setează last pressed (`lastSet`) is marked, while the form
 * still holds its values.
 */
export function GuideTaskList({
  sheet,
  selection,
  lastSet,
  onSet,
}: {
  sheet: GuideSheet;
  selection: GuideSelection;
  lastSet: string | null;
  onSet?: (patch: GuidePatch, id: string) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const total = sheet.sections.reduce(
    (sum, section) => sum + section.tasks.length,
    0,
  );
  const searchable = total > SEARCH_FROM;
  const sections = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return sheet.sections;
    return sheet.sections
      .map((section) => ({
        ...section,
        tasks: section.tasks.filter((task) =>
          fold(`${task.task} ${task.description ?? ''}`).includes(needle),
        ),
      }))
      .filter((section) => section.tasks.length > 0);
  }, [query, sheet]);
  const found = sections.reduce((sum, s) => sum + s.tasks.length, 0);

  return (
    <div className="grid gap-4">
      <details className="group rounded-md border border-border text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-solid focus-visible:outline-ring">
          Cum aleg nivelul: Începător
          {sheet.experiences.includes('intermediar') ? ', Intermediar' : ''} sau
          Avansat?
        </summary>
        <div className="border-t border-border p-3">
          <ExperienceRules experiences={sheet.experiences} />
        </div>
      </details>
      {searchable && (
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-search`} className="sr-only">
            Caută în taskurile din {sheet.name}
          </label>
          <div className="relative">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id={`${id}-search`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Caută un task"
              autoComplete="off"
              className="min-h-11 w-full rounded-md border border-input bg-background py-2 pr-3 pl-9 text-sm"
              aria-describedby={`${id}-count`}
            />
          </div>
          <p
            id={`${id}-count`}
            aria-live="polite"
            className="m-0 text-xs text-muted-foreground"
          >
            {query.trim()
              ? found === 1
                ? '1 task găsit'
                : `${found} taskuri găsite`
              : `${total} taskuri`}
          </p>
        </div>
      )}
      {found === 0 ? (
        <div className="grid justify-items-start gap-2 text-sm">
          <p className="m-0">Niciun task nu conține „{query.trim()}”.</p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => setQuery('')}
          >
            Șterge căutarea
          </Button>
        </div>
      ) : (
        sections.map((section, index) => (
          <section
            key={section.title ?? `section-${index}`}
            aria-label={section.title ?? undefined}
            className="grid gap-1"
          >
            {section.title && <SubHeading>{section.title}</SubHeading>}
            <ul className="m-0 list-none divide-y divide-border p-0">
              {section.tasks.map((task, row) => (
                <TaskRow
                  key={`${row}-${task.task}`}
                  id={`${section.title ?? index}/${row}`}
                  task={task}
                  experiences={sheet.experiences}
                  selection={selection}
                  lastSet={lastSet}
                  onSet={onSet}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function TaskRow({
  id,
  task,
  experiences,
  selection,
  lastSet,
  onSet,
}: {
  id: string;
  task: GuideTask;
  experiences: readonly Experience[];
  selection: GuideSelection;
  lastSet: string | null;
  onSet?: (patch: GuidePatch, id: string) => void;
}) {
  const options = taskOptions(task, experiences);
  const medalChoice =
    options.length > 1 && options.every((o) => !o.experiences);
  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <p className="m-0 text-sm font-semibold wrap-anywhere">{task.task}</p>
        {task.description && (
          <p className="m-0 text-xs text-muted-foreground wrap-anywhere">
            {task.description}
          </p>
        )}
      </div>
      {options.length === 0 ? (
        <p className="m-0 text-xs text-muted-foreground sm:text-right">
          Fără dificultate în ghid
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 sm:justify-end">
          {options.map((option) => {
            const patch: GuidePatch = {
              difficulty: option.level,
              ...(task.rating ? { rating: task.rating } : {}),
            };
            const who = option.experiences
              ? `${experienceNames(option.experiences)}, `
              : '';
            const name = `Setează ${who}Dificultate ${difficultyName(option.level)}${task.rating ? `, Nota ${task.rating}` : ''} — ${task.task}`;
            const content = (
              <>
                {option.experiences ? (
                  <span className="font-medium text-muted-foreground">
                    {experienceNames(option.experiences)}
                  </span>
                ) : (
                  !medalChoice && <span>Setează</span>
                )}
                <DifficultyMark value={option.level} />
                {task.rating && (
                  <span className="tabular-nums">· Nota {task.rating}</span>
                )}
              </>
            );
            const optionId = `${id}/${option.level}-${option.experiences?.join() ?? 'all'}`;
            return onSet ? (
              <SetButton
                key={optionId}
                name={name}
                patch={patch}
                applied={lastSet === optionId && isApplied(patch, selection)}
                onSet={(value) => onSet(value, optionId)}
              >
                {content}
              </SetButton>
            ) : (
              <span
                key={optionId}
                className="inline-flex min-h-8 items-center gap-1.5 text-sm"
              >
                {option.experiences && (
                  <span className="text-muted-foreground">
                    {experienceNames(option.experiences)}
                  </span>
                )}
                <DifficultyMark value={option.level} />
                {task.rating && (
                  <span className="tabular-nums">· Nota {task.rating}</span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </li>
  );
}

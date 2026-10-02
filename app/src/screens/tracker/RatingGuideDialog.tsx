import { useRef, useState } from 'react';
import { BookOpenIcon } from 'lucide-react';
import { SegmentedToggle } from '../../components/layout';
import { DifficultyMark } from '../../components/tasks/DifficultyMark';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import { difficultyName } from '../../lib/difficulty-levels';
import { cn } from '../../lib/utils';
import { useDifficultyLevels } from '../../queries/difficulty-levels';
import { useEvaluationScale, useGroups } from '../../queries/reference';
import { guideForGroup, ratingGuide } from './rating-guide';
import { GuideScale } from './rating-guide/GuideScale';
import { GuideTaskList } from './rating-guide/GuideTaskList';
import { SEARCH_FROM } from './rating-guide/task-options';
import type { GuidePatch, GuideSelection } from './rating-guide/selection';

export type { GuidePatch, GuideSelection };

const EMPTY: GuideSelection = { difficulty: null, rating: null };

/**
 * OSUBB's rating guide (#986), opened beside the evaluation controls without
 * leaving the form. Two views of one guide: "Taskuri <Grup>" — the list of
 * the Group the Task is labelled with, each row with a Setează per experience
 * column — and "Note și dificultăți", the general scale (Nota 1–5, the ten
 * Difficulty levels, the experience levels). A Group without a list shows
 * the scale alone.
 *
 * Setează writes into the open form (`onSet`) and keeps the guide open: the
 * bar at the bottom shows what the form now holds, a screen reader hears it,
 * and "Gata" returns to the form. Without `onSet` the guide only reads.
 */
export function RatingGuideDialog({
  groupId,
  selection = EMPTY,
  onSet,
}: {
  /** The Group the Task is labelled with; null while the form has none. */
  groupId?: number | null;
  selection?: GuideSelection;
  onSet?: (patch: GuidePatch) => void;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={<Button type="button" variant="outline" className="min-h-11" />}
      >
        <BookOpenIcon aria-hidden="true" />
        {ratingGuide.title}
      </DialogTrigger>
      <DialogContent className="flex h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:h-auto sm:max-h-[min(48rem,calc(100dvh-4rem))] sm:max-w-2xl">
        <GuideBody groupId={groupId} selection={selection} onSet={onSet} />
      </DialogContent>
    </Dialog>
  );
}

function GuideBody({
  groupId,
  selection,
  onSet,
}: {
  groupId?: number | null;
  selection: GuideSelection;
  onSet?: (patch: GuidePatch) => void;
}) {
  const scale = useEvaluationScale();
  const levels = useDifficultyLevels().data;
  const groups = useGroups();
  const { group, sheet, via } = guideForGroup(groupId, groups.data);
  const [view, setView] = useState<'tasks' | 'scale'>('tasks');
  const [announcement, setAnnouncement] = useState('');
  const [lastSet, setLastSet] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const shown = sheet ? view : 'scale';
  const searchable =
    sheet !== null &&
    sheet.sections.reduce((sum, section) => sum + section.tasks.length, 0) >
      SEARCH_FROM;

  function set(patch: GuidePatch, id: string | null = null) {
    onSet?.(patch);
    setLastSet(id);
    const parts = [
      patch.difficulty !== undefined &&
        `Dificultate ${difficultyName(levels, patch.difficulty)}`,
      patch.rating !== undefined && `Nota ${patch.rating}`,
    ].filter(Boolean);
    setAnnouncement(`Setat în formular: ${parts.join(', ')}.`);
  }

  function choose(next: 'tasks' | 'scale') {
    setView(next);
    if (scroller.current) scroller.current.scrollTop = 0;
  }

  return (
    <>
      <div className="grid gap-3 border-b border-border p-4">
        <DialogHeader>
          <DialogTitle>{ratingGuide.title}</DialogTitle>
          {/* On a phone the list gets the room; the scale view says the same. */}
          <DialogDescription className="max-sm:sr-only">
            {ratingGuide.description}
          </DialogDescription>
        </DialogHeader>
        <GroupContext
          groupId={groupId}
          pending={groups.isPending}
          group={group}
          viaName={via?.name ?? null}
          hasList={sheet !== null}
        />
        {sheet && (
          <SegmentedToggle
            label="Partea ghidului"
            value={view}
            onChange={choose}
            options={[
              { value: 'tasks', label: `Taskuri ${sheet.key}` },
              { value: 'scale', label: 'Note și dificultăți' },
            ]}
            // A phone splits the track in two equal halves so both labels fit.
            className="w-full sm:w-fit sm:justify-self-start [&>button]:flex-1 [&>button]:px-2 sm:[&>button]:flex-none sm:[&>button]:px-4"
          />
        )}
      </div>
      <div
        ref={scroller}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto px-4 py-4',
          shown === 'tasks' && searchable && 'sm:min-h-[min(26rem,45dvh)]',
        )}
      >
        {shown === 'tasks' && sheet ? (
          <section aria-label={`Taskuri în ${sheet.name}`}>
            <GuideTaskList
              key={sheet.key}
              sheet={sheet}
              selection={selection}
              lastSet={lastSet}
              onSet={onSet ? set : undefined}
            />
          </section>
        ) : (
          <GuideScale
            scale={scale.data}
            experiences={sheet?.experiences ?? []}
            selection={selection}
            onSet={onSet ? (patch) => set(patch) : undefined}
          />
        )}
      </div>
      {onSet && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-[length:var(--fs-xs)] font-extrabold tracking-[0.08em] text-muted-foreground uppercase">
              În formular
            </span>
            <span className="inline-flex items-center gap-1.5">
              Dificultate
              {selection.difficulty === null ? (
                <span className="text-muted-foreground">nealeasă</span>
              ) : (
                <DifficultyMark
                  value={selection.difficulty}
                  className="font-semibold"
                />
              )}
            </span>
            <span className="inline-flex items-baseline gap-1.5">
              Nota
              <span
                className={cn(
                  'font-bold tabular-nums',
                  selection.rating === null && 'text-muted-foreground',
                )}
              >
                {selection.rating ?? 'nealeasă'}
              </span>
            </span>
          </p>
          <DialogClose render={<Button type="button" className="min-h-11" />}>
            Gata
          </DialogClose>
        </div>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </>
  );
}

function GroupContext({
  groupId,
  pending,
  group,
  viaName,
  hasList,
}: {
  groupId?: number | null;
  pending: boolean;
  group: { name: string; color?: string | null } | null;
  viaName: string | null;
  hasList: boolean;
}) {
  if (groupId == null)
    return (
      <p className="m-0 text-sm text-muted-foreground">
        Alege grupul taskului ca să vezi și lista lui de taskuri.
      </p>
    );
  if (!group)
    return pending ? (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        Se încarcă grupul taskului…
      </p>
    ) : null;
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-1.5 text-sm">
      <span className="text-muted-foreground">Grupul taskului:</span>
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full bg-muted-foreground"
          style={group.color ? { backgroundColor: group.color } : undefined}
        />
        {group.name}
      </span>
      {hasList ? (
        viaName && (
          <span className="text-muted-foreground">· lista din {viaName}</span>
        )
      ) : (
        <span className="text-muted-foreground">
          · nu are încă o listă de taskuri în ghid
        </span>
      )}
    </p>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { SegmentedToggle, SubHeading } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { formatMemberCount } from '../../lib/format';
import { keys } from '../../queries/keys';
import { useGroups, useRoles } from '../../queries/reference';
import {
  applyVolunteerImport,
  IMPORT_FAILED,
  PREVIEW_FAILED,
  previewVolunteerImport,
  type ImportPreview,
  type ImportProblem,
  type ImportResult,
  type PreviewRow,
} from '../../queries/volunteer-import';
import { describePlacements } from './placement-labels';

type Stage =
  | { kind: 'checking' }
  | { kind: 'preview'; preview: ImportPreview }
  | { kind: 'importing'; preview: ImportPreview; done: number; total: number }
  | { kind: 'done'; result: ImportResult }
  | { kind: 'failed'; message: string; preview: ImportPreview | null };

type RowFilter = 'all' | 'problems';

/** A problem chip: red when the row is skipped, amber when it imports anyway. */
export function ProblemChip({ problem }: { problem: ImportProblem }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
        problem.blocking
          ? 'bg-(--danger-050) text-(--danger)'
          : 'bg-(--warning-050) text-(--text)',
      )}
    >
      {problem.message}
    </span>
  );
}

/** "Bar of rows": a thin determinate track, the count beside it in words. */
export function ProgressTrack({
  label,
  done,
  total,
}: {
  label: string;
  done: number;
  total: number;
}) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} din ${total}`}
      className="h-2 w-full overflow-hidden rounded-full bg-(--surface-3)"
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

const cellClass = 'px-2 py-1.5 align-top whitespace-nowrap';

/** Whether the apply leaves this row out. */
function skipped(row: PreviewRow) {
  return (
    row.action === 'skip' || row.problems.some((problem) => problem.blocking)
  );
}

function PreviewTable({ rows }: { rows: readonly PreviewRow[] }) {
  const groups = useGroups();
  const roles = useRoles();
  return (
    // The table scrolls inside its own box, both ways; the dialog never does
    // sideways.
    <div
      className="max-h-[min(calc(var(--visible-height)/2),28rem)] overflow-auto rounded-md border border-border"
      tabIndex={0}
      role="region"
      aria-label="Previzualizare import"
    >
      <table className="w-full min-w-[56rem] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]">
          <tr>
            <th scope="col" className={cn(cellClass, 'w-12 font-medium')}>
              Rând
            </th>
            <th scope="col" className={cn(cellClass, 'font-medium')}>
              Nume
            </th>
            <th scope="col" className={cn(cellClass, 'font-medium')}>
              Email
            </th>
            <th scope="col" className={cn(cellClass, 'font-medium')}>
              Rang
            </th>
            <th scope="col" className={cn(cellClass, 'font-medium')}>
              Departamente
            </th>
            <th scope="col" className={cn(cellClass, 'font-medium')}>
              Funcție
            </th>
            <th scope="col" className={cn(cellClass, 'font-medium')}>
              Probleme
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { departments, positions } = describePlacements(
              row.placements,
              groups.data,
            );
            return (
              <tr
                key={row.row}
                className={cn(
                  'border-b border-border last:border-0',
                  skipped(row) && 'text-muted-foreground',
                )}
              >
                <td className={cn(cellClass, 'tabular-nums')}>{row.row}</td>
                <td className={cellClass}>{row.name || '—'}</td>
                <td className={cellClass}>{row.email || '—'}</td>
                <td className={cn(cellClass, 'whitespace-nowrap')}>
                  {roles.data?.get(row.rank)?.name ?? (row.rank || '—')}
                </td>
                <td className={cellClass}>
                  {departments.length > 0 ? (
                    <>
                      <span className="font-medium">{departments[0]}</span>
                      {departments.length > 1 &&
                        `, ${departments.slice(1).join(', ')}`}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={cellClass}>
                  {positions.length > 0 ? positions.join('; ') : '—'}
                </td>
                <td className={cellClass}>
                  <span className="flex flex-wrap gap-1">
                    {row.action === 'complete' && (
                      <span className="inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium">
                        importat deja: se completează
                      </span>
                    )}
                    {row.problems.map((problem, index) => (
                      <ProblemChip key={index} problem={problem} />
                    ))}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Counts({ preview }: { preview: ImportPreview }) {
  const left = preview.rows.length - preview.importable;
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      <div>
        <dt className="inline text-muted-foreground">Rânduri</dt>{' '}
        <dd className="inline font-semibold tabular-nums">
          {preview.rows.length}
        </dd>
      </div>
      <div>
        <dt className="inline text-muted-foreground">Fără probleme</dt>{' '}
        <dd className="inline font-semibold tabular-nums">{preview.ok}</dd>
      </div>
      <div>
        <dt className="inline text-muted-foreground">Cu probleme</dt>{' '}
        <dd className="inline font-semibold tabular-nums">
          {preview.withProblems}
        </dd>
      </div>
      <div>
        <dt className="inline text-muted-foreground">Se sar</dt>{' '}
        <dd className="inline font-semibold tabular-nums">{left}</dd>
      </div>
    </dl>
  );
}

function ResultSummary({
  result,
  onShowUninvited,
}: {
  result: ImportResult;
  onShowUninvited: () => void;
}) {
  const failed = result.rows.filter(
    (row) => row.outcome === 'failed' || row.outcome === 'skipped',
  );
  return (
    <div className="flex min-w-0 flex-col gap-3" aria-live="polite">
      <SubHeading variant="label">Rezultatul importului</SubHeading>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div>
          <dt className="inline text-muted-foreground">Creați</dt>{' '}
          <dd className="inline font-semibold tabular-nums">
            {result.created}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Completați</dt>{' '}
          <dd className="inline font-semibold tabular-nums">
            {result.completed}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Sărite</dt>{' '}
          <dd className="inline font-semibold tabular-nums">
            {result.skipped}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Eșuate</dt>{' '}
          <dd className="inline font-semibold tabular-nums">{result.failed}</dd>
        </div>
      </dl>
      <p className="text-sm">
        Nu s-a trimis niciun email. Verifică datele în lista „De invitat”, apoi
        trimite invitațiile de acolo.
      </p>
      {failed.length > 0 && (
        <ul
          aria-label="Rânduri neimportate"
          className="max-h-48 list-inside list-disc overflow-auto text-sm"
        >
          {failed.map((row, index) => (
            <li key={`${row.row}-${index}`}>
              Rândul {row.row}
              {row.email ? ` (${row.email})` : ''}:{' '}
              {row.message ?? (row.outcome === 'skipped' ? 'sărit' : 'eșuat')}
            </li>
          ))}
        </ul>
      )}
      <Button type="button" className="self-start" onClick={onShowUninvited}>
        Vezi lista „De invitat”
      </Button>
    </div>
  );
}

/**
 * The volunteer sheet's import (#991, #992): the file is checked first (a dry
 * run: nothing created), the plan shows per row with its problems, and only
 * "Importă N membri" creates accounts — without sending a single email. Rows
 * with a blocking problem are skipped; the rest import in chunks with a
 * progress bar. Mounted inside "Import CSV" when the file is the volunteer
 * sheet; `onBusy` keeps the dialog open while a request runs.
 */
export function VolunteerImportFlow({
  csv,
  onBusy,
  onShowUninvited,
}: {
  csv: string;
  onBusy: (busy: boolean) => void;
  onShowUninvited: () => void;
}) {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<Stage>({ kind: 'checking' });
  const [filter, setFilter] = useState<RowFilter>('all');

  useEffect(() => {
    let live = true;
    onBusy(true);
    previewVolunteerImport(csv)
      .then((preview) => {
        if (live) setStage({ kind: 'preview', preview });
      })
      .catch((error: unknown) => {
        if (live)
          setStage({
            kind: 'failed',
            preview: null,
            message: error instanceof Error ? error.message : PREVIEW_FAILED,
          });
      })
      .finally(() => onBusy(false));
    return () => {
      live = false;
    };
  }, [csv, onBusy]);

  const preview =
    stage.kind === 'preview' || stage.kind === 'importing'
      ? stage.preview
      : stage.kind === 'failed'
        ? stage.preview
        : null;
  const shown = useMemo(
    () =>
      preview
        ? filter === 'problems'
          ? preview.rows.filter((row) => row.problems.length > 0)
          : preview.rows
        : [],
    [preview, filter],
  );

  async function runImport(current: ImportPreview) {
    onBusy(true);
    // Only the rows the plan imports: the skipped ones are already listed.
    const rows = current.rows
      .filter((row) => !skipped(row))
      .map((row) => row.row);
    setStage({
      kind: 'importing',
      preview: current,
      done: 0,
      total: rows.length,
    });
    try {
      const result = await applyVolunteerImport(csv, rows, (done, total) =>
        setStage({ kind: 'importing', preview: current, done, total }),
      );
      // The rows the plan left out count as skipped, with the reason shown.
      const left = current.rows.filter(skipped).map((row) => ({
        row: row.row,
        email: row.email,
        outcome: 'skipped' as const,
        message:
          (row.problems.find((problem) => problem.blocking) ?? row.problems[0])
            ?.message ?? null,
      }));
      setStage({
        kind: 'done',
        result: {
          ...result,
          skipped: result.skipped + left.length,
          rows: [...result.rows, ...left].sort((a, b) => a.row - b.row),
        },
      });
      await Promise.all(
        [keys.members.all, keys.groups.all, keys.points.all].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    } catch (error) {
      setStage({
        kind: 'failed',
        preview: current,
        message: error instanceof Error ? error.message : IMPORT_FAILED,
      });
    } finally {
      onBusy(false);
    }
  }

  if (stage.kind === 'checking')
    return (
      <p role="status" className="text-sm">
        Se verifică fișierul… Nu se creează niciun cont.
      </p>
    );

  if (stage.kind === 'done')
    return (
      <ResultSummary result={stage.result} onShowUninvited={onShowUninvited} />
    );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {stage.kind === 'failed' && (
        <p role="alert" className="text-sm text-destructive">
          {stage.message}
        </p>
      )}
      {preview && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Counts preview={preview} />
            {preview.withProblems > 0 && (
              <SegmentedToggle
                label="Rânduri afișate"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: `Toate (${preview.rows.length})` },
                  {
                    value: 'problems',
                    label: `Cu probleme (${preview.withProblems})`,
                  },
                ]}
              />
            )}
          </div>
          <PreviewTable rows={shown} />
          {stage.kind === 'importing' ? (
            <div className="grid gap-1.5" aria-live="polite">
              <ProgressTrack
                label="Progresul importului"
                done={stage.done}
                total={stage.total}
              />
              <p className="text-sm tabular-nums">
                Se importă… {stage.done} din {stage.total} rânduri
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Rândurile marcate cu roșu se sar; cele cu galben se importă fără
                piesa care lipsește. Nu se trimite niciun email.
              </p>
              <Button
                type="button"
                disabled={preview.importable === 0}
                onClick={() => void runImport(preview)}
              >
                Importă {formatMemberCount(preview.importable)}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { cn } from 'cn';
import { SubHeading } from '../../components/layout';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { reasonCopy } from '../../lib/command-reasons';
import { supabase } from '../../lib/supabase';
import { keys } from '../../queries/keys';
import { isVolunteerSheet } from '../../queries/volunteer-import';
import { VolunteerImportFlow } from './VolunteerImportFlow';

type ImportRow = { row: number; email: string };
type SkippedRow = ImportRow & { code: string };
type ErrorRow = { row: number; email?: string; message: string };
type ImportReport = {
  summary: { created: number; skipped: number; errors: number };
  created: ImportRow[];
  skipped: SkippedRow[];
  errors: ErrorRow[];
};

/** Why a row was skipped, from the shared reason table; an unknown code reads generically. */
function skipReason(code: string) {
  return reasonCopy(`csv_row_${code}`) ?? reasonCopy('csv_row_skipped') ?? code;
}

function isReport(value: unknown): value is ImportReport {
  if (typeof value !== 'object' || value === null) return false;
  const report = value as Partial<ImportReport>;
  return (
    typeof report.summary?.created === 'number' &&
    typeof report.summary.skipped === 'number' &&
    typeof report.summary.errors === 'number' &&
    Array.isArray(report.created) &&
    Array.isArray(report.skipped) &&
    Array.isArray(report.errors)
  );
}

async function importErrorMessage(error: unknown): Promise<string> {
  if (typeof error === 'object' && error !== null && 'context' in error) {
    const context = error.context;
    if (context instanceof Response) {
      try {
        const body: unknown = await context.json();
        if (
          typeof body === 'object' &&
          body !== null &&
          'error' in body &&
          typeof body.error === 'string'
        )
          return body.error;
      } catch {
        // A gateway error can have no JSON body; show the generic message.
      }
    }
  }
  return 'Importul CSV a eșuat. Verifică fișierul și reîncearcă.';
}

/**
 * "Import CSV" (#72, #949): the second of the Membri header's two ways in,
 * beside "Invită membru" and opened the same way. The file's rows go through
 * the same invitation path one at a time, every one as a Recrut; the report
 * stays in the dialog until it is closed. Mounted only behind
 * `provisionMembers`, the function's own level-6 gate.
 */
export function CsvImportDialog({
  onShowUninvited,
}: {
  /** Leaves the dialog for the "De invitat" list after a volunteer import. */
  onShowUninvited?: () => void;
} = {}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  /** The volunteer sheet's text (#992): its own flow, a dry run first. */
  const [volunteerCsv, setVolunteerCsv] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onBusy = useCallback((next: boolean) => setBusy(next), []);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!file || pending) return;
    setPending(true);
    setReport(null);
    setError(null);
    try {
      if (file.size > 256 * 1024) {
        setError('Fișierul CSV depășește limita de 256 KB.');
        return;
      }
      const csv = await file.text();
      const result = await supabase.functions.invoke('csv-import', {
        body: { csv },
      });
      if (result.error) throw result.error;
      if (!isReport(result.data)) throw new Error('invalid_csv_import_report');
      setReport(result.data);
      if (result.data.summary.created > 0) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: keys.members.all }),
          queryClient.invalidateQueries({ queryKey: keys.groups.all }),
          queryClient.invalidateQueries({ queryKey: keys.points.all }),
        ]);
      }
    } catch (failure) {
      setError(await importErrorMessage(failure));
    } finally {
      setPending(false);
    }
  }

  async function choose(next: File | null) {
    setFile(next);
    setReport(null);
    setError(null);
    setVolunteerCsv(null);
    if (!next) return;
    if (next.size > 256 * 1024) {
      setError('Fișierul CSV depășește limita de 256 KB.');
      return;
    }
    const csv = await next.text();
    if (isVolunteerSheet(csv)) setVolunteerCsv(csv);
  }

  function reset() {
    setFile(null);
    setVolunteerCsv(null);
    setReport(null);
    setError(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending || busy) return;
        setOpen(next);
        if (next) reset();
      }}
    >
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Upload aria-hidden="true" />
        Import CSV
      </Button>
      <DialogContent
        className={cn(
          'grid-cols-[minmax(0,1fr)]',
          // The volunteer preview is a table: as wide as the screen allows.
          volunteerCsv !== null && 'sm:max-w-5xl',
        )}
      >
        <DialogHeader>
          <DialogTitle>Import CSV</DialogTitle>
          <DialogDescription>
            Adaugă membri dintr-unul din cele două fișiere de mai jos.
          </DialogDescription>
        </DialogHeader>
        {/* The format is read from the header row, so both share one picker. */}
        <ul className="grid list-inside list-disc gap-1 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">
              Baza de voluntari
            </span>{' '}
            (coloana „Nume & Prenume”): se verifică întâi, apoi membrii se
            creează fără niciun email. Invitațiile pleacă din „De invitat”.
          </li>
          <li>
            <span className="font-medium text-foreground">
              name,email,dept,team
            </span>
            : fiecare primește o invitație și intră ca Recrut. Pentru dept și
            team, folosește numele scurt sau numele afișat al Grupului; literele
            mari și diacriticele nu contează.
          </li>
        </ul>
        <a
          className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
          href="/model-import-membri.csv"
          download="model-import-membri.csv"
        >
          Descarcă șablon
        </a>

        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <span className="block text-sm font-medium">Fișier CSV</span>
            <input
              id="csv-import-file"
              type="file"
              aria-label="Fișier CSV"
              accept=".csv,text/csv"
              disabled={pending || busy}
              className="peer sr-only"
              onChange={(event) => void choose(event.target.files?.[0] ?? null)}
            />
            <label
              htmlFor="csv-import-file"
              className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border px-4 text-sm font-medium hover:bg-muted peer-focus-visible:outline-2 peer-focus-visible:outline-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
            >
              Alege fișier CSV
            </label>
            {file && <span className="text-sm break-all">{file.name}</span>}
          </div>
          {volunteerCsv === null && (
            <Button
              type="button"
              disabled={!file || pending}
              onClick={() => void submit()}
            >
              {pending ? 'Se importă…' : 'Importă fișierul'}
            </Button>
          )}
        </div>

        {volunteerCsv !== null && (
          <VolunteerImportFlow
            csv={volunteerCsv}
            onBusy={onBusy}
            onShowUninvited={() => {
              setOpen(false);
              onShowUninvited?.();
            }}
          />
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {report && (
          <div
            className="flex min-w-0 flex-col gap-3 break-words"
            aria-live="polite"
          >
            <SubHeading variant="label">Rezultatul importului</SubHeading>
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div>
                <dt className="inline font-medium">Create</dt>
                <dd className="inline">: {report.summary.created}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Ignorate</dt>
                <dd className="inline">: {report.summary.skipped}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Erori</dt>
                <dd className="inline">: {report.summary.errors}</dd>
              </div>
            </dl>
            {report.created.length > 0 && (
              <ul
                aria-label="Membri creați"
                className="list-inside list-disc text-sm"
              >
                {report.created.map((row) => (
                  <li key={row.row}>
                    Rândul {row.row}: {row.email}
                  </li>
                ))}
              </ul>
            )}
            {report.skipped.length > 0 && (
              <ul
                aria-label="Membri ignorați"
                className="list-inside list-disc text-sm"
              >
                {report.skipped.map((row) => (
                  <li key={row.row}>
                    Rândul {row.row}: {row.email} ({skipReason(row.code)})
                  </li>
                ))}
              </ul>
            )}
            {report.errors.length > 0 && (
              <ul
                aria-label="Erori la import"
                className="list-inside list-disc space-y-1 text-sm"
              >
                {report.errors.map((row, index) => (
                  <li key={`${row.row}-${index}`}>
                    Rândul {row.row}
                    {row.email ? ` (${row.email})` : ''}: {row.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

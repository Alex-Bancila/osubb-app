import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import { supabase } from '../../lib/supabase';
import { keys } from '../../queries/keys';

type ImportRow = { row: number; email: string };
type SkippedRow = ImportRow & { code: string };
type ErrorRow = { row: number; email?: string; message: string };
type ImportReport = {
  summary: { created: number; skipped: number; errors: number };
  created: ImportRow[];
  skipped: SkippedRow[];
  errors: ErrorRow[];
};

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

export function CsvImportPanel() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
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

  return (
    <section
      className="min-w-0 space-y-4 rounded-lg border p-4"
      aria-labelledby="csv-import-title"
    >
      <div className="space-y-1">
        <h2 id="csv-import-title" className="text-xl font-semibold">
          Import CSV
        </h2>
        <p className="text-sm text-muted-foreground">
          Adaugă membri dintr-un fișier cu coloanele name,email,dept,team.
          Pentru dept și team, folosește numele scurt sau numele afișat al
          Grupului; literele mari și diacriticele nu contează.
        </p>
        <a
          className="text-sm font-medium underline underline-offset-4"
          href="/model-import-membri.csv"
          download="model-import-membri.csv"
        >
          Descarcă șablon
        </a>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <span className="block text-sm font-medium">Fișier CSV</span>
          <input
            id="csv-import-file"
            type="file"
            aria-label="Fișier CSV"
            accept=".csv,text/csv"
            disabled={pending}
            className="peer sr-only"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setReport(null);
              setError(null);
            }}
          />
          <label
            htmlFor="csv-import-file"
            className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border px-4 text-sm font-medium hover:bg-muted peer-focus-visible:outline-2 peer-focus-visible:outline-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
          >
            Alege fișier CSV
          </label>
          {file && <span className="ml-2 text-sm break-all">{file.name}</span>}
        </div>
        <Button
          type="button"
          disabled={!file || pending}
          onClick={() => void submit()}
        >
          {pending ? 'Se importă…' : 'Import CSV'}
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {report && (
        <div className="min-w-0 space-y-3 break-words" aria-live="polite">
          <h3 className="font-semibold">Rezultatul importului</h3>
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
                  Rândul {row.row}: {row.email} (
                  {row.code === 'already_exists'
                    ? 'există deja'
                    : 'duplicat în fișier'}
                  )
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
    </section>
  );
}

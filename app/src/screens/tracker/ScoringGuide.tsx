import { Button } from '../../components/ui/button';
import { useScoringGuide } from '../../queries/scoring-guide';

function pointsConsequence(points: number) {
  return points < 0
    ? 'Se scad puncte'
    : points === 0
      ? 'Nu se acordă puncte'
      : 'Se acordă puncte';
}

/** Reference values come from the database; this is a preview, never a ledger write. */
export function ScoringGuide() {
  const query = useScoringGuide();
  if (query.isPending)
    return <p role="status">Se încarcă ghidul de punctaj…</p>;
  if (query.isError)
    return (
      <div role="alert">
        <p>Ghidul de punctaj nu este disponibil.</p>
        <Button variant="outline" onClick={() => query.refetch()}>
          Reîncarcă ghidul
        </Button>
      </div>
    );
  return (
    <section
      aria-label="Ghid de punctaj"
      className="space-y-4 rounded-lg border border-border p-4"
    >
      <h3 className="font-semibold">Cum se calculează punctele</h3>
      <p className="text-sm">
        Puncte task = Dificultate × multiplicatorul calificativului. Punctele îi
        revin unui singur Executor.
      </p>
      <ul className="space-y-3">
        {query.data.ratings.map((row) => (
          <li key={row.rating} className="rounded-md bg-muted p-3 text-sm">
            <p className="font-semibold">
              {row.rating} — {row.label} · × {row.multiplier}
            </p>
            <p>{pointsConsequence(row.multiplier)}.</p>
            {row.note && <p className="mt-1">{row.note}</p>}
          </li>
        ))}
      </ul>
      <details>
        <summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-ring">
          Ghid de dificultate (1–5)
        </summary>
        <ul className="space-y-2 text-sm">
          {query.data.difficulties.map((row) => (
            <li key={row.stars}>
              <strong>{row.stars}</strong> — {row.note}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

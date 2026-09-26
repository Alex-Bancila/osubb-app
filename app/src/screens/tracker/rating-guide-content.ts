// The words of the rating guide (ruling R22 of the 2026-09-23 grill). Every
// Rating hint lives in this one module, so when the approved guide arrives
// (#638) the swap touches nothing else. The Difficulty hints are reference
// data (`difficulty_guide.note`, house rule 6) and are read from the server.

export type RatingHint = { value: 1 | 2 | 3 | 4 | 5; hint: string };

export const ratingGuide = {
  title: 'Ghid de evaluare',
  description:
    'Calificativul spune cât de bine a fost făcut taskul, iar dificultatea cât de greu a fost. Alege pentru fiecare treapta care descrie cel mai bine lucrarea.',
  ratingHeading: 'Calificativ',
  difficultyHeading: 'Dificultate',
  ratingHints: [
    { value: 1, hint: 'Nelivrat / inacceptabil' },
    { value: 2, hint: 'Sub așteptări' },
    { value: 3, hint: 'Conform așteptărilor' },
    { value: 4, hint: 'Peste așteptări' },
    { value: 5, hint: 'Excepțional' },
  ] satisfies RatingHint[],
};

/** The hint for one Rating, or null outside 1–5. */
export function ratingHint(value: number): string | null {
  return (
    ratingGuide.ratingHints.find((row) => row.value === value)?.hint ?? null
  );
}

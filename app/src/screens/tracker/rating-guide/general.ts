// The general part of OSUBB's rating guide — the "Ghid" sheet, verbatim (#986,
// superseding the placeholder hints of rulings R22 and R29a). Every word the
// guide, the Nota stepper and the Difficulty picker show comes from here. The
// three medal interpretations are the only sentences the sheet did not give
// (it held placeholders); they are written from how the department sheets use
// the medals.
import type { DifficultyLevel } from '../../../lib/difficulty-levels';
import type { Experience } from './types';

export type RatingValue = 1 | 2 | 3 | 4 | 5;

export const ratingGuide = {
  title: 'Ghid de evaluare',
  description:
    'Nota spune cât de bine a fost făcut taskul, iar dificultatea cât de greu a fost.',
  ratingHeading: 'Nota',
  difficultyHeading: 'Dificultate',
  experienceHeading: 'Nivel de experiență',
  ratings: [
    { value: 1, interpretation: 'Taskul nu a fost realizat.' },
    {
      value: 2,
      interpretation:
        'Taskul a fost realizat insuficient, necesitând intervenții sau corectări semnificative.',
    },
    {
      value: 3,
      interpretation:
        'Taskul a fost realizat parțial, dar nu în totalitate conform cerințelor.',
    },
    {
      value: 4,
      interpretation:
        'Taskul a fost realizat corespunzător, conform cerințelor și așteptărilor.',
    },
    {
      value: 5,
      interpretation:
        'Taskul a fost realizat foarte bine, complet și conform așteptărilor.',
    },
  ] satisfies { value: RatingValue; interpretation: string }[],
  difficulties: [
    {
      level: 1,
      interpretation:
        'Task simplu, punctual, cu instrucțiuni clare și autonomie redusă.',
    },
    {
      level: 2,
      interpretation:
        'Task operațional, care presupune câțiva pași și un nivel redus de organizare.',
    },
    {
      level: 3,
      interpretation:
        'Task care presupune autonomie, mai multe etape și asumarea unei responsabilități concrete.',
    },
    {
      level: 4,
      interpretation:
        'Task complex, care presupune autonomie ridicată, luarea unor decizii și gestionarea mai multor elemente.',
    },
    {
      level: 5,
      interpretation:
        'Task strategic sau foarte complex, cu responsabilitate majoră, impact ridicat și autonomie foarte mare.',
    },
    {
      level: 6,
      interpretation:
        'Responsabil pe o activitate sau o campanie delimitată în timp, cu monitorizarea voluntarilor implicați.',
    },
    {
      level: 7,
      interpretation:
        'Responsabil pe o linie de lucru sau o mini-echipă, pe care o organizează și o supraveghează constant.',
    },
    {
      level: 8,
      interpretation:
        'Responsabil pe o direcție de durată a grupului, gestionată autonom de la obiective la rezultate.',
    },
    { level: 9, interpretation: 'Responsabil echipă principală' },
    { level: 10, interpretation: 'Coordonator principal' },
  ] satisfies { level: DifficultyLevel; interpretation: string }[],
  experiences: {
    incepator: {
      name: 'Începător',
      rule: 'Se utilizează nivelul „Începător” atunci când voluntarul nu are experiență relevantă în realizarea taskului sau a realizat anterior foarte puține taskuri similare.',
      signs: [
        'nu a mai realizat / susținut taskul respectiv;',
        'a făcut foarte puține taskuri similare;',
        'are nevoie de ghidaj / feedback pentru realizarea taskului;',
        'nu are încă autonomie pe acel tip de activitate.',
      ],
    },
    intermediar: {
      name: 'Intermediar',
      rule: 'Unde lista grupului are și coloana „Intermediar”, ea se utilizează pentru voluntarul aflat între cele două niveluri.',
      signs: [],
    },
    avansat: {
      name: 'Avansat',
      rule: 'Se utilizează nivelul „Avansat” atunci când voluntarul a realizat în mod repetat taskuri similare și poate îndeplini responsabilitatea autonom, fără ghidaj semnificativ.',
      signs: [
        'a realizat deja în mod repetat taskuri similare;',
        'poate realiza taskul autonom;',
        'știe să gestioneze situațiile neprevăzute specifice taskului;',
        'nu are nevoie de suport semnificativ pentru realizare.',
      ],
    },
  } satisfies Record<
    Experience,
    { name: string; rule: string; signs: string[] }
  >,
};

/** The guide's interpretation of one Rating, or null outside 1–5. */
export function ratingHint(value: number): string | null {
  return (
    ratingGuide.ratings.find((row) => row.value === value)?.interpretation ??
    null
  );
}

/** The guide's interpretation of one Difficulty level, or null outside 1–10. */
export function difficultyHint(value: number): string | null {
  return (
    ratingGuide.difficulties.find((row) => row.level === value)
      ?.interpretation ?? null
  );
}

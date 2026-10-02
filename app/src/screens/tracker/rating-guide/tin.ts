// The "Tineret" sheet of OSUBB's rating guide, verbatim (#986). Generated from
// the Google Sheets export; edit the text here when the guide changes.
import type { GuideSheet } from './types';

export const tin = {
  key: 'TIN',
  name: 'Tineret',
  experiences: ['incepator', 'avansat'],
  sections: [
    {
      title: null,
      tasks: [
        { task: 'Ședință departamentală', description: null, difficulty: 2 },
        {
          task: 'Ședințe de lucru departamentale',
          description: null,
          difficulty: 3,
        },
        {
          task: 'Ambasadori de tineret- responsabil de conusultare',
          description:
            'Monitorizarea voluntarilor și a procesului de consultare',
          difficulty: 5,
        },
        {
          task: 'Ambasadori de tineret- voluntar plan si sistem de consultare',
          description: 'Lucrează pe partea de preimplementare a consultării',
          difficulty: 4,
        },
        {
          task: 'Ambasadori de tineret- voluntar colectare si date si metode',
          description:
            'Contribuie la colectarea datelor și participă la realizarea consultării',
          difficulty: 3,
        },
        {
          task: 'Ambasadori de tineret- voluntar monitorizare si interpretare',
          description:
            'Contribuie la realizarea raportului final de consultare',
          difficulty: 4,
        },
        {
          task: 'Responsabil Campanie',
          description:
            'Monitroizarea activităților din cadrul campaniei și a responsabililor de activități',
          difficulty: 'medalie',
        },
        {
          task: 'Responsabil activitate Campanie',
          description: 'Monitorizarea activității și a voluntarilor',
          difficulty: [4, 3],
        },
        {
          task: 'Voluntar Campanie',
          description:
            'Se ocupă de partea logistică și ajută la implementarea activităților aferente',
          difficulty: [3, 2],
        },
        {
          task: 'Workshop-uri departamentale',
          description: 'Participarea la workshop-urile departamentale',
          difficulty: 2,
        },
      ],
    },
  ],
} as const satisfies GuideSheet;

// The "Interne" sheet of OSUBB's rating guide, verbatim (#986). Generated from
// the Google Sheets export; edit the text here when the guide changes.
import type { GuideSheet } from './types';

export const interne = {
  key: 'Interne',
  name: 'Interne',
  experiences: [],
  sections: [
    {
      title: null,
      tasks: [
        {
          task: 'Ședință Generală',
          description: null,
          difficulty: 2,
          rating: 3,
        },
        {
          task: 'Ședință Comisia de Interne',
          description: 'Participare',
          difficulty: 2,
          rating: 3,
        },
        { task: 'Interviu AG', description: 'Evaluare', difficulty: 3 },
        {
          task: 'Grup de lucru AG',
          description: 'Decizie/strategie',
          difficulty: 5,
        },
      ],
    },
    {
      title: 'Evenimente externe',
      tasks: [
        { task: 'Deplasare Caravana UBB', description: null, difficulty: null },
        {
          task: 'Participare proiecte de scurtă durată',
          description: null,
          difficulty: null,
        },
        {
          task: 'Participare proiecte de lungă durată',
          description: null,
          difficulty: null,
        },
        { task: 'Participare gale', description: null, difficulty: null },
        { task: 'Participare proteste', description: null, difficulty: null },
      ],
    },
  ],
} as const satisfies GuideSheet;

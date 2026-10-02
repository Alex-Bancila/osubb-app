// The "FR" sheet of OSUBB's rating guide, verbatim (#986). Generated from
// the Google Sheets export; edit the text here when the guide changes.
import type { GuideSheet } from './types';

export const fin = {
  key: 'FIN',
  name: 'Financiar',
  experiences: ['incepator', 'intermediar', 'avansat'],
  sections: [
    {
      title: null,
      tasks: [
        { task: 'Ședință departamentală', description: null, difficulty: 2 },
        { task: 'Ședință de lucru', description: null, difficulty: 3 },
        {
          task: 'Script mail',
          description:
            'Realizarea unui script de mail cu toate detaliile relevante pentr un partener',
          difficulty: [2, 1, 1],
        },
        {
          task: 'Contactări mail',
          description: 'Contactarea pe mail a potențialilor parteneri',
          difficulty: [3, 2, 1],
        },
        {
          task: 'Contactări telefonice',
          description: 'Contactarea telefonică a potențialilor parteneri',
          difficulty: [4, 3, 2],
        },
        {
          task: 'Negocieri',
          description:
            'Negocierea termenilor și condițiilor unui parteneriat cu reprezentanții unei companii în format fizic sau online (meet)',
          difficulty: [5, 4, 4],
        },
        {
          task: 'Responsabil OSUBB Deals',
          description:
            'Obținere de vouchere, reduceri și alte beneficii pentru voluntari',
          difficulty: 8,
        },
        {
          task: 'Responsabil linie de finanțare',
          description:
            'se ocupa cu organizarea si supravegerea voluntarilor pe linia respectivă',
          difficulty: 7,
        },
        {
          task: 'Responsabil Campania 3,5%/20%',
          description:
            'Promovarea offline a campaniei intern și extern, contactat companii pentru completarea formularului, monitorizarea constantă a formularelor completate',
          difficulty: 6,
        },
        {
          task: 'Voluntar Campania 3,5%/20%',
          description: null,
          difficulty: [3, 2, 2],
        },
        {
          task: 'Bază de date',
          description:
            'Realizarea unei baze de date cu potențiale companii partenere și datele de contact',
          difficulty: [3, 2, 2],
        },
        {
          task: 'Menținere comunicare cu partenerii',
          description: null,
          difficulty: [4, 3, 2],
        },
        { task: 'Scop și obiective', description: null, difficulty: [3, 2, 2] },
        {
          task: 'Descriere organizație',
          description: null,
          difficulty: [2, 1, 1],
        },
        { task: 'Activități', description: null, difficulty: [5, 4, 4] },
        { task: 'Sustenabilitate', description: null, difficulty: [4, 3, 3] },
        { task: 'Caracter inovativ', description: null, difficulty: [4, 3, 3] },
        { task: 'Beneficiari', description: null, difficulty: 1 },
      ],
    },
  ],
} as const satisfies GuideSheet;

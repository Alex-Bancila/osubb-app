// The "HR" sheet of OSUBB's rating guide, verbatim (#986). Generated from
// the Google Sheets export; edit the text here when the guide changes.
import type { GuideSheet } from './types';

export const hr = {
  key: 'HR',
  name: 'Resurse Umane',
  experiences: ['incepator', 'avansat'],
  sections: [
    {
      title: null,
      tasks: [
        { task: 'Ședință departamentală', description: null, difficulty: 2 },
        { task: 'Ședință de lucru', description: null, difficulty: 3 },
        {
          task: 'Voluntar Contactări',
          description:
            'Voluntarii contactează telefonic membrii organizației pentru actualizarea informațiilor și a bazei de date',
          difficulty: [3, 2],
        },
        {
          task: 'Remindere',
          description:
            'Voluntarii trimit mesaje membrilor pentru a le reaminti despre ședințe, proteste și alte activități ale organizației',
          difficulty: 2,
        },
        {
          task: 'Responsabil Contactări',
          description:
            'Monitorizarea constantă a procesului de contactare pentru programarea interviurilor și quiz-urilor',
          difficulty: [4, 3],
        },
        {
          task: 'Responsabil Activitate Internă',
          description:
            'Monitorizarea voluntarilor și gestionarea task-urilor aferente activității',
          difficulty: [4, 3],
        },
        {
          task: 'Responsabil Campanie Internă',
          description:
            'Monitorizarea voluntarilor și gestionarea task-urilor aferente activității',
          difficulty: 'medalie',
        },
        {
          task: 'Voluntar Campanie Internă',
          description:
            'Îndeplinește task-uri și se implică activ în cadrul activității',
          difficulty: [3, 2],
        },
        {
          task: 'Responsabil Quiz & Buddy',
          description:
            'Gestionarea serilor de quiz și monitorizarea de tip buddy a recruților',
          difficulty: 5,
        },
        {
          task: 'Voluntar Quiz',
          description: 'Asigurarea logistică a quiz-urilor',
          difficulty: [3, 2],
        },
        {
          task: 'Voluntar Buddy',
          description:
            'Asigurarea bunăstării echipelor de noi oameni în organizație',
          difficulty: [4, 3],
        },
        {
          task: 'Membru echipă TB',
          description: 'Gândirea și gestionarea desfășurării TB-urilor',
          difficulty: 7,
        },
        {
          task: 'Voluntar HR Watch',
          description:
            'Completarea unei grile de observație și crearea unui raport',
          difficulty: [3, 2],
        },
      ],
    },
  ],
} as const satisfies GuideSheet;

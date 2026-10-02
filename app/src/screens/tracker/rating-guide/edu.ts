// The "EDU" sheet of OSUBB's rating guide, verbatim (#986). Generated from
// the Google Sheets export; edit the text here when the guide changes.
import type { GuideSheet } from './types';

export const edu = {
  key: 'EDU',
  name: 'Educațional',
  experiences: ['incepator', 'avansat'],
  sections: [
    {
      title: null,
      tasks: [
        { task: 'Ședință departamentală', description: null, difficulty: 2 },
        { task: 'Ședință de lucru', description: null, difficulty: 3 },
        {
          task: 'Voluntar contactări',
          description:
            'Mesaje/ apel voluntari pentru participare la proteste sau alte evenimente ex. ABC-ul reprezentarii',
          difficulty: [3, 2],
        },
        {
          task: 'Realizare pancarte',
          description: 'Scrierea si colorarea pancartelor pentru proteste',
          difficulty: 3,
        },
        {
          task: 'Redactare Raport CDOS',
          description: 'Interpretare rezultate CDOS în scris pentru raport',
          difficulty: 5,
        },
        {
          task: 'Participare ABC',
          description: 'Prezență la ABC-ul Reprezentării',
          difficulty: 3,
        },
        { task: 'EDUNights', description: 'Participare', difficulty: 2 },
        {
          task: 'Facilitare EDU Nights',
          description: 'Realizarea și facilitarea activităților',
          difficulty: [5, 4],
        },
        {
          task: 'Amendamente',
          description: 'Redactarea amendamentelor pe regulamente ale UBB',
          difficulty: 5,
        },
        {
          task: 'Scriere postări',
          description: 'Redactare text postări',
          difficulty: [4, 3],
        },
        {
          task: 'Stand campanie',
          description:
            'Prezență stand, realizarea de activități fizic la stand',
          difficulty: [3, 2],
        },
        {
          task: 'Brigadă',
          description:
            'Echipa TalkEdu; care iese în grup pentru a promova demersuri edu spre studenți',
          difficulty: [3, 2],
        },
        {
          task: 'Responsabil echipă',
          description: null,
          difficulty: 'medalie',
        },
        {
          task: 'Pregătire materiale campanii',
          description: 'Taiat de stickere, indoirea zine-urilor/ flyere',
          difficulty: 2,
        },
        {
          task: 'Monitorizare',
          description:
            'Monitorizarea constantă a CSF-urilor, CA-ului, instituțiilor UBB',
          difficulty: [4, 3],
        },
        {
          task: 'Updatare resurse / bază de date',
          description:
            'Actualizarea manuala a Bazelor de date de admitere și cea cu Studenți Reprezentanți',
          difficulty: [4, 3],
        },
        {
          task: 'Actualizare documente',
          description: 'Echipa de resurse, TUDI, documente de pe site',
          difficulty: [4, 3],
        },
        {
          task: 'Moderare grup Admitere UBB',
          description:
            'Aprobarea postărilor de pe grupul de Facebook de admitere',
          difficulty: [3, 2],
        },
      ],
    },
  ],
} as const satisfies GuideSheet;

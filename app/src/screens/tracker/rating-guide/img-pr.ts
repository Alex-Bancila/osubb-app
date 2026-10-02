// The "IMG&PR" sheet of OSUBB's rating guide, verbatim (#986). Generated from
// the Google Sheets export; edit the text here when the guide changes.
import type { GuideSheet } from './types';

export const imgPr = {
  key: 'IMG&PR',
  name: 'Imagine & PR',
  experiences: ['incepator', 'intermediar', 'avansat'],
  sections: [
    {
      title: null,
      tasks: [
        {
          task: 'Ședință departamentală',
          description:
            'Participarea la ședințele departamentale cu scop informativ ale activității departamentului',
          difficulty: 2,
        },
        {
          task: 'Ședință de brainstorming',
          description:
            'Participarea la ședințe destinate brainstormingului pe campanii',
          difficulty: 3,
        },
        {
          task: 'Ședință de lucru',
          description:
            'Participarea la ședințele cu scop de formare a voluntarilor, în care aceștia lucrează pe task-uri delegate sau conceptuale',
          difficulty: 3,
        },
        {
          task: 'Vizual',
          description:
            'Realizarea unui vizual folosind elementele de identitatea vizuală prestabilite',
          difficulty: [2, 1, 1],
        },
        {
          task: 'Descriere',
          description:
            'Realizarea unei descrieri scurte pentru captions pe social media',
          difficulty: [2, 1, 1],
        },
        {
          task: 'Plan media',
          description:
            'Gândirea și programarea postărilor unei campanii într-un calendar de postări organizat pe date',
          difficulty: [3, 2, 2],
        },
        {
          task: 'Carusel',
          description:
            'Realizarea unui carusel pentru social media, care conține mai multe vizualuri coerente pe o anumită tematică, folosind elementele de identitate vizuală prestabilite',
          difficulty: [2, 1, 1],
        },
        {
          task: 'Identitate vizuală',
          description:
            'Conceperea unei identități vizuale coerente, aliniată cu viziunea și conceptul creativ al campaniei',
          difficulty: [5, 4, 3],
        },
        {
          task: 'Comunicat de presă',
          description:
            'Realizarea unui comunicat de presă destinat pentru comunicarea unor demersuri pe plan extern',
          difficulty: [5, 4, 3],
        },
        {
          task: 'Postări interne',
          description:
            'Realizarea vizualurilor pentru call-uri și postări interne',
          difficulty: [2, 1, 1],
        },
        {
          task: 'Postări alumni și onorifici',
          description:
            'Realizarea vizualurilor pe template-ul prestabilit, alături de descrierile aferente',
          difficulty: [3, 2, 2],
        },
        {
          task: 'Apariție în TikTok',
          description: 'Participarea într-un videoclip de tip TikTok/Reels',
          difficulty: 1,
        },
        {
          task: 'Filmat TikTok',
          description: 'Filmarea videoclipurilor de tip TikTok/Reels',
          difficulty: [3, 2, 2],
        },
        {
          task: 'Editare TikTok',
          description:
            'Editarea videoclipurilor de tip TikTok/Reels în programe destinate',
          difficulty: [4, 3, 2],
        },
        {
          task: 'Filmare video',
          description: 'Filmarea videoclipurilor long-form',
          difficulty: [5, 4, 4],
        },
        {
          task: 'Editare video',
          description:
            'Editarea videoclipurilor long-form în programe destinate',
          difficulty: 5,
        },
        {
          task: 'Apariție în video',
          description: 'Apariția în videoclipurilor de tip long-form',
          difficulty: 2,
        },
        {
          task: 'Realizare fotografii',
          description:
            'Realizarea fotografiilor în cadrul proiectelor sau activităților din cadrul organizației',
          difficulty: [5, 4, 4],
        },
        {
          task: 'Editare fotografii',
          description: 'Editarea fotografiilor realizate',
          difficulty: 5,
        },
        {
          task: 'Afiș',
          description:
            'Realizarea afișului pentru campanii, activități sau proiecte',
          difficulty: [3, 2, 2],
        },
        {
          task: 'Sticker',
          description:
            'Realizarea modelelor de stickere adaptatea la identitatea vizuală a activităților și campaniilor',
          difficulty: [3, 2, 2],
        },
        {
          task: 'Flyer',
          description:
            'Realizarea flyerelor promoționale pentru activități și campanii, adaptate la identitatea vizuală prestabilită',
          difficulty: [3, 2, 2],
        },
        {
          task: 'Badge-uri',
          description:
            'Realizarea badgeu-urilor în cadrul activităților interne sau extern din cadrul organizației',
          difficulty: [4, 3, 3],
        },
        {
          task: 'Cover facebook',
          description:
            'Realizarea cover-ului de facebook pentru evenimente sau campanii, adaptat la identitatea vizuală prestabilită',
          difficulty: [3, 2, 2],
        },
        {
          task: 'Merch',
          description:
            'Realizarea designului destinat merchului din cauza organizației',
          difficulty: 5,
        },
      ],
    },
  ],
} as const satisfies GuideSheet;

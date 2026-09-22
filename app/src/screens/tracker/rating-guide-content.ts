// PLACEHOLDER — the real rating guide does not exist yet. Issue #638 replaces
// this text with the approved document. Keep every word of the guide in this
// one module so that swap touches nothing else.

export type RatingGuideSection = {
  heading: string;
  paragraphs: string[];
};

export const ratingGuide = {
  title: 'Ghid de evaluare',
  placeholderNotice:
    'Text provizoriu: ghidul oficial de evaluare nu a fost încă aprobat.',
  sections: [
    {
      heading: 'Lorem ipsum',
      paragraphs: [
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      ],
    },
    {
      heading: 'Dolor sit amet',
      paragraphs: [
        'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
        'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
      ],
    },
    {
      heading: 'Consectetur adipiscing',
      paragraphs: [
        'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
      ],
    },
  ] satisfies RatingGuideSection[],
};

import { describe, expect, it } from 'vitest';
import {
  guideForGroup,
  guideSheets,
  ratingGuide,
  type GuideGroup,
} from './index';
import { fin } from './fin';
import { taskOptions } from './task-options';

const row = (
  id: number,
  name: string,
  short: string | null,
  category: string,
  path: number[],
  is_organization = false,
): [number, GuideGroup] => [
  id,
  { id, name, short, category, path, is_organization } as GuideGroup,
];

// The local hierarchy: top-level Departments, the Organization, Teams under a
// Department or under none, Projects, and a Group under a Project.
const groups = new Map([
  row(1, 'Imagine & PR', 'IMG&PR', 'department', [1]),
  row(2, 'Tineret', 'TIN', 'department', [2]),
  row(3, 'Financiar', 'FIN', 'department', [3]),
  row(4, 'Resurse Umane', 'HR', 'department', [4]),
  row(5, 'OSUBB', 'ORG', 'organization', [5], true),
  row(6, 'Diverse', 'DIV', 'department', [6]),
  row(7, 'Secretariat', 'SEC', 'department', [7]),
  row(8, 'Educațional', 'edu', 'department', [8]),
  row(58, 'Echipa Recruți', null, 'team', [8, 58]),
  row(59, 'Echipa Logistică', null, 'team', [59]),
  row(9, 'Echipa IT', null, 'team', [6, 9]),
  row(60, 'Festivalul Studențesc 2026', null, 'project', [60]),
  row(61, 'Logistică festival', null, 'team', [60, 61]),
  // If the Organization were the root of everything, a Department would still
  // show its own list.
  row(70, 'Educațional (sub OSUBB)', 'EDU', 'department', [5, 70]),
  row(71, 'Financiar (FR)', 'FR', 'department', [71]),
]);

describe('guideForGroup', () => {
  it.each([
    [8, 'EDU', null],
    [3, 'FIN', null],
    [4, 'HR', null],
    [1, 'IMG&PR', null],
    [2, 'TIN', null],
    [58, 'EDU', 'Educațional'],
    [5, 'Interne', null],
    [60, 'Proiecte', null],
    [61, 'Proiecte', 'Festivalul Studențesc 2026'],
    [70, 'EDU', null],
    [71, 'FIN', null],
  ])('Group %i shows the %s list (via %s)', (id, key, via) => {
    const guide = guideForGroup(id, groups);
    expect(guide.group?.id).toBe(id);
    expect(guide.sheet?.key).toBe(key);
    expect(guide.via?.name ?? null).toBe(via);
  });

  it.each([6, 7, 9, 59])(
    'Group %i has no list: the general guide only',
    (id) => {
      const guide = guideForGroup(id, groups);
      expect(guide.group?.id).toBe(id);
      expect(guide.sheet).toBeNull();
    },
  );

  it('waits for the Group, and needs one', () => {
    expect(guideForGroup(8, undefined).sheet).toBeNull();
    expect(guideForGroup(null, groups)).toEqual({
      group: null,
      sheet: null,
      via: null,
    });
    expect(guideForGroup(999, groups).group).toBeNull();
  });
});

describe('taskOptions', () => {
  const fr = fin;
  const task = (name: string) => {
    const found = fr.sections[0]?.tasks.find(
      (candidate) => candidate.task === name,
    );
    if (!found) throw new Error(`No row ${name}`);
    return found;
  };

  it('merges the experience columns that share a value, as the sheet does', () => {
    expect(taskOptions(task('Script mail'), fr.experiences)).toEqual([
      { experiences: ['incepator'], level: 2 },
      { experiences: ['intermediar', 'avansat'], level: 1 },
    ]);
    expect(taskOptions(task('Contactări mail'), fr.experiences)).toEqual([
      { experiences: ['incepator'], level: 3 },
      { experiences: ['intermediar'], level: 2 },
      { experiences: ['avansat'], level: 1 },
    ]);
    expect(taskOptions(task('Beneficiari'), fr.experiences)).toEqual([
      { experiences: null, level: 1 },
    ]);
  });

  it('offers every medal where the sheet leaves the choice, and nothing where it gives none', () => {
    expect(
      taskOptions({ task: 'x', description: null, difficulty: 'medalie' }, [
        'incepator',
        'avansat',
      ]).map((option) => option.level),
    ).toEqual([6, 7, 8]);
    expect(
      taskOptions({ task: 'x', description: null, difficulty: null }, []),
    ).toEqual([]);
  });
});

it('keeps the guide content (structure snapshot)', () => {
  expect({
    ratings: ratingGuide.ratings.map((rating) => rating.value),
    difficulties: ratingGuide.difficulties.map(
      (difficulty) => difficulty.level,
    ),
    sheets: guideSheets.map((sheet) => ({
      key: sheet.key,
      name: sheet.name,
      experiences: sheet.experiences,
      sections: sheet.sections.map((section) => ({
        title: section.title,
        tasks: section.tasks.map((task) =>
          [
            task.task,
            JSON.stringify(task.difficulty),
            task.rating ? `Nota ${task.rating}` : '',
          ]
            .filter(Boolean)
            .join(' · '),
        ),
      })),
    })),
  }).toMatchSnapshot();
});

it('gives every row a level the app knows, and every sheet column a Setează', () => {
  for (const sheet of guideSheets) {
    // A row is identified by its task name (the guide marks the last Setează).
    const names = sheet.sections.flatMap((section) =>
      section.tasks.map((task) => task.task),
    );
    expect(new Set(names).size).toBe(names.length);
  }
  for (const sheet of guideSheets)
    for (const section of sheet.sections)
      for (const task of section.tasks) {
        const cells =
          task.difficulty === null
            ? []
            : Array.isArray(task.difficulty)
              ? task.difficulty
              : [task.difficulty];
        if (Array.isArray(task.difficulty))
          expect(task.difficulty).toHaveLength(sheet.experiences.length);
        for (const cell of cells)
          expect(
            cell === 'medalie' || (Number(cell) >= 1 && Number(cell) <= 10),
          ).toBe(true);
      }
});

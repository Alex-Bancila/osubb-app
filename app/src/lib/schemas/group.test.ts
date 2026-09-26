import { describe, expect, it } from 'vitest';
import {
  expectMapComplete,
  expectRoutable,
  issues,
} from '../../test/schema-issues';
import {
  fieldForReason,
  groupCreateSchema,
  groupSettingsSchema,
  groupStructureSchema,
} from './group';

const create = {
  name: 'Logistică',
  category: 'team',
  minLevel: null as number | null,
  color: '',
  short: '',
};
const settings = {
  name: 'Logistică',
  managerTitle: '',
  acceptsApplications: false,
  applicationLevel: null as number | null,
  sharedWorkVisibility: false,
  minLevel: 1,
};
function check<T extends object>(
  schema: { safeParse: (value: unknown) => Parameters<typeof issues>[0] },
  base: T,
  patch: Partial<T>,
) {
  const result = schema.safeParse({ ...base, ...patch });
  expectRoutable(result, fieldForReason);
  return issues(result);
}

describe('Group name', () => {
  it.each([
    ['   ', ['name: invalid_group_name']],
    ['ab', ['name: name_too_short']],
    ['abc', []],
    ['g'.repeat(120), []],
    ['g'.repeat(121), ['name: name_too_long']],
  ])(
    'measures %j at the boundary, on create and on settings',
    (name, expected) => {
      expect(check(groupCreateSchema, create, { name })).toEqual(expected);
      expect(check(groupSettingsSchema, settings, { name })).toEqual(expected);
    },
  );

  it('trims the name and turns blank optional texts into null', () => {
    expect(
      groupCreateSchema.parse({ ...create, name: '  Logistică  ', short: ' ' }),
    ).toMatchObject({ name: 'Logistică', color: null, short: null });
    expect(
      groupSettingsSchema.parse({ ...settings, managerTitle: '  ' }),
    ).toMatchObject({ managerTitle: null });
  });
});

describe('Group settings', () => {
  it('checks the category, levels and colour the commands check', () => {
    expect(check(groupCreateSchema, create, { category: 'club' })).toEqual([
      'category: invalid_group_category',
    ]);
    expect(check(groupCreateSchema, create, { minLevel: 4 })).toEqual([
      'minLevel: invalid_group_min_level',
    ]);
    expect(check(groupCreateSchema, create, { color: '#C8102E' })).toEqual([]);
    expect(check(groupCreateSchema, create, { color: 'red' })).toEqual([
      'color: invalid_group_color',
    ]);
    expect(
      issues(groupStructureSchema.safeParse({ color: '#12345', short: '' })),
    ).toEqual(['color: invalid_group_color']);
  });

  it('asks for an Application Level at or above the Minimum Level when the Group takes Applications', () => {
    expect(
      check(groupSettingsSchema, settings, { acceptsApplications: true }),
    ).toEqual(['applicationLevel: invalid_application_level']);
    expect(
      check(groupSettingsSchema, settings, {
        acceptsApplications: true,
        applicationLevel: 0,
      }),
    ).toEqual(['applicationLevel: application_level_below_min_level']);
    expect(
      check(groupSettingsSchema, settings, {
        acceptsApplications: true,
        applicationLevel: 3,
      }),
    ).toEqual([]);
  });
});

it('maps every reason a Group command raises to a Group field', () => {
  expectMapComplete(
    fieldForReason,
    [
      'name',
      'category',
      'color',
      'short',
      'managerTitle',
      'minLevel',
      'applicationLevel',
    ],
    [
      'invalid_group_name',
      'name_too_short',
      'name_too_long',
      'group_name_taken',
      'invalid_group_category',
      'invalid_group_color',
      'invalid_group_min_level',
      'invalid_position_title',
      'invalid_application_level',
      'application_level_below_min_level',
      'group_min_level_below_parent',
      'group_min_level_above_actor',
      'group_min_level_above_children',
    ],
  );
});

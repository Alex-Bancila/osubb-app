import { describe, expect, it } from 'vitest';
import {
  expectMapComplete,
  expectRoutable,
  issues,
} from '../../test/schema-issues';
import { CommandError } from '../command-reasons';
import {
  applicationFormFailure,
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
  applicationForm: { label: '', url: '' },
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
      'applicationForm.label',
      'applicationForm.url',
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
      // update_group's application form link (#697): #684's link reasons.
      'link_incomplete',
      'link_label_too_long',
      'link_url_invalid',
      'link_url_too_long',
    ],
  );
});

describe('Application form link (#698)', () => {
  const url = 'https://forms.example.org/logistica';
  const form = (label: string, address: string) =>
    issues(
      groupSettingsSchema.safeParse({
        ...settings,
        applicationForm: { label, url: address },
      }),
    );

  it('takes both or neither, trimmed, blank as no value', () => {
    expect(form('', '')).toEqual([]);
    expect(form('  ', ' ')).toEqual([]);
    expect(form('Înscrie-te', url)).toEqual([]);
    expect(
      groupSettingsSchema.parse({
        ...settings,
        applicationForm: { label: ' Înscrie-te ', url: ` ${url} ` },
      }).applicationForm,
    ).toEqual({ label: 'Înscrie-te', url });
    expect(groupSettingsSchema.parse(settings).applicationForm).toEqual({
      label: null,
      url: null,
    });
    // The half left empty is the one named.
    expect(form('Înscrie-te', '')).toEqual([
      'applicationForm.url: application_form_incomplete',
    ]);
    expect(form('', url)).toEqual([
      'applicationForm.label: application_form_incomplete',
    ]);
  });

  it('measures the label at 60 characters, as char_length counts them', () => {
    expect(
      check(groupSettingsSchema, settings, {
        applicationForm: { label: 'ș'.repeat(60), url },
      }),
    ).toEqual([]);
    expect(
      check(groupSettingsSchema, settings, {
        applicationForm: { label: 'ș'.repeat(61), url },
      }),
    ).toEqual(['applicationForm.label: application_form_label_too_long']);
  });

  it('asks for an http(s) address of at most 2048 characters', () => {
    for (const ok of [
      'http://a.ro',
      'https://a.ro',
      `https://${'a'.repeat(2040)}`,
    ])
      expect(form('Formular', ok), ok).toEqual([]);
    expect(
      check(groupSettingsSchema, settings, {
        applicationForm: { label: 'Formular', url: 'forms.example.org' },
      }),
    ).toEqual(['applicationForm.url: application_form_url_invalid']);
    // The server's prefix check is case-sensitive; so is this one.
    expect(form('Formular', 'HTTPS://a.ro')).toEqual([
      'applicationForm.url: application_form_url_invalid',
    ]);
    expect(
      check(groupSettingsSchema, settings, {
        applicationForm: {
          label: 'Formular',
          url: `https://${'a'.repeat(2041)}`,
        },
      }),
    ).toEqual(['applicationForm.url: link_url_too_long']);
  });

  it("renames update_group's Attached Link reasons into this form's words", () => {
    for (const [server, renamed] of [
      ['link_incomplete', 'application_form_incomplete'],
      ['link_label_too_long', 'application_form_label_too_long'],
      ['link_url_invalid', 'application_form_url_invalid'],
    ] as const) {
      const failure = applicationFormFailure(
        new CommandError({ code: 'PT400', message: server }, 'x'),
      );
      expect(failure, server).toBeInstanceOf(CommandError);
      expect((failure as CommandError).reason).toBe(renamed);
      // A raw PostgREST error is renamed the same way.
      expect(
        (applicationFormFailure({ message: server }) as CommandError).reason,
      ).toBe(renamed);
    }
    const other = new CommandError({ message: 'group_name_taken' }, 'x');
    expect(applicationFormFailure(other)).toBe(other);
  });
});

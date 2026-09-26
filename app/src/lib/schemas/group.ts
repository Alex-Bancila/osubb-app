import { z } from 'zod';
import { emptyToNull, trimText } from '../normalize';
import { requiredText } from './text';

/**
 * A Group, as `create_group`, `update_group` and `update_group_structure`
 * accept it (#582, #673, ruling R8): a name of 3–120 characters, a Minimum
 * Level and Application Level from the Role levels, and a colour written as
 * `#RRGGBB`. Authority and tree rules (a parent's floor, the actor's own
 * level) stay with the commands and the pickers that offer only valid levels.
 */
const LEVELS = [0, 1, 2, 3, 5, 6, 9];
const CATEGORIES = ['department', 'project', 'team'];

export const groupName = requiredText({
  required: 'invalid_group_name',
  min: 3,
  tooShort: 'name_too_short',
  max: 120,
  tooLong: 'name_too_long',
});

/** Blank is no value; anything else is trimmed. */
const optional = z
  .string()
  .nullish()
  .transform((value) => emptyToNull(trimText(value)));

const color = optional.superRefine((value, ctx) => {
  if (value !== null && !/^#[0-9A-Fa-f]{6}$/.test(value))
    ctx.addIssue({ code: 'custom', message: 'invalid_group_color' });
});

const level = (reason: string) =>
  z.number().refine((value) => LEVELS.includes(value), reason);

export const groupCreateSchema = z.object({
  name: groupName,
  category: z
    .string()
    .refine((value) => CATEGORIES.includes(value), 'invalid_group_category'),
  minLevel: level('invalid_group_min_level').nullable(),
  color,
  short: optional,
});

export const groupSettingsSchema = z
  .object({
    name: groupName,
    managerTitle: optional,
    acceptsApplications: z.boolean(),
    applicationLevel: level('invalid_application_level').nullable(),
    sharedWorkVisibility: z.boolean(),
    minLevel: level('invalid_group_min_level'),
  })
  .superRefine((settings, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', path: ['applicationLevel'], message });
    // update_group: a Group that takes Applications names the level they
    // start at, and it is never below the Group's own Minimum Level.
    if (settings.acceptsApplications && settings.applicationLevel === null)
      issue('invalid_application_level');
    else if (
      settings.applicationLevel !== null &&
      settings.applicationLevel < settings.minLevel
    )
      issue('application_level_below_min_level');
  });

export const groupStructureSchema = z.object({
  color,
  short: optional,
});

/** Where each reason a Group command (or these schemas) raises is shown. */
export const fieldForReason: Readonly<Record<string, string>> = {
  invalid_group_name: 'name',
  name_too_short: 'name',
  name_too_long: 'name',
  group_name_taken: 'name',
  invalid_group_category: 'category',
  invalid_group_color: 'color',
  invalid_position_title: 'managerTitle',
  invalid_group_min_level: 'minLevel',
  group_min_level_below_parent: 'minLevel',
  group_min_level_above_actor: 'minLevel',
  group_min_level_above_children: 'minLevel',
  invalid_application_level: 'applicationLevel',
  application_level_below_min_level: 'applicationLevel',
};

import { z } from 'zod';
import { CommandError, commandReason } from '../command-reasons';
import { charLength, emptyToNull, trimText } from '../normalize';
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

/**
 * The Group's application form link (#697, #698, ruling R18): an Attached
 * Link, "Formular de înscriere", judged as update_group judges it through
 * #684's private.require_attached_link -- trimmed, blank as no value, both or
 * neither, a label of at most 60 characters, an http(s) address of at most
 * 2048. The copy names this form's own fields (Eticheta butonului, Adresa
 * formularului), so the reasons are this form's, not the Task link's.
 */
const applicationForm = z
  .object({
    label: z.string().nullish(),
    url: z.string().nullish(),
  })
  .transform((link) => ({
    label: emptyToNull(trimText(link.label)),
    url: emptyToNull(trimText(link.url)),
  }))
  .superRefine((link, ctx) => {
    const issue = (path: 'label' | 'url', message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    // Both or neither: the half left empty is the one to fill in.
    if (link.label !== null && link.url === null)
      issue('url', 'application_form_incomplete');
    if (link.url !== null && link.label === null)
      issue('label', 'application_form_incomplete');
    if (link.label !== null && charLength(link.label) > 60)
      issue('label', 'application_form_label_too_long');
    if (link.url !== null) {
      if (charLength(link.url) > 2048) issue('url', 'link_url_too_long');
      else if (!/^https?:\/\//.test(link.url))
        issue('url', 'application_form_url_invalid');
    }
  });

export const groupSettingsSchema = z
  .object({
    name: groupName,
    managerTitle: optional,
    acceptsApplications: z.boolean(),
    applicationLevel: level('invalid_application_level').nullable(),
    sharedWorkVisibility: z.boolean(),
    minLevel: level('invalid_group_min_level'),
    applicationForm,
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
  // The application form link (#698): the browser's reasons, and the
  // server's Attached Link reasons for the same rules. The server's pair rule
  // cannot say which half is missing; the address is the one most often left.
  application_form_incomplete: 'applicationForm.url',
  application_form_label_too_long: 'applicationForm.label',
  application_form_url_invalid: 'applicationForm.url',
  link_incomplete: 'applicationForm.url',
  link_label_too_long: 'applicationForm.label',
  link_url_invalid: 'applicationForm.url',
  link_url_too_long: 'applicationForm.url',
};

/**
 * update_group refuses a bad form link with #684's Attached Link reasons,
 * whose copy speaks of "numele linkului". The settings form shows the same
 * rule in its own words, so a refusal reads like the browser's check would.
 */
const APPLICATION_FORM_REASON: Readonly<Record<string, string>> = {
  link_incomplete: 'application_form_incomplete',
  link_label_too_long: 'application_form_label_too_long',
  link_url_invalid: 'application_form_url_invalid',
};

/** A failed settings save, with an Attached Link reason renamed for this form. */
export function applicationFormFailure(failure: unknown): unknown {
  const reason =
    failure instanceof CommandError ? failure.reason : commandReason(failure);
  const renamed =
    reason === undefined ? undefined : APPLICATION_FORM_REASON[reason];
  // A renamed reason always has copy, so the fallback is never shown.
  return renamed === undefined
    ? failure
    : new CommandError({ message: renamed }, '');
}

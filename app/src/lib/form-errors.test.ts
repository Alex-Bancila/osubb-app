import { expect, it } from 'vitest';
import { CommandError } from './command-reasons';
import { FORM_ERROR, fieldErrors, parseOrRefuse } from './form-errors';
import { fieldForReason, noteSchema } from './schemas/note';
import {
  fieldForReason as taskFields,
  taskDuplicateSchema,
} from './schemas/task';

it('puts a zod issue and a server reason for the same field under that field', () => {
  const local = noteSchema.safeParse({ note: 'n'.repeat(1001) });
  expect(fieldErrors(local, undefined, fieldForReason)).toEqual({
    note: 'Nota are cel mult 1000 de caractere.',
  });
  // The server has the last word on the same field.
  expect(fieldErrors(local, 'note_required', fieldForReason)).toEqual({
    note: 'Scrie o notă.',
  });
  expect(
    fieldErrors(noteSchema.safeParse({ note: 'ok' }), 'note_too_long', {
      ...fieldForReason,
    }),
  ).toEqual({ note: 'Nota are cel mult 1000 de caractere.' });
});

it('sends a reason that names no field to the form-level slot', () => {
  expect(fieldErrors(undefined, 'task_manage_forbidden', taskFields)).toEqual({
    [FORM_ERROR]: 'Nu mai ai permisiunea să gestionezi taskurile acestui grup.',
  });
  // An unknown reason is not ours to show at all.
  expect(fieldErrors(undefined, 'private_detail', taskFields)).toEqual({});
});

it('keeps the first broken rule of a field and never shows zod English', () => {
  const result = taskDuplicateSchema().safeParse({ deadline: 42 });
  expect(fieldErrors(result, undefined, taskFields)).toEqual({
    deadline: 'Verifică valoarea acestui câmp.',
  });
});

it('refuses at the command door with the first broken rule as a reason', () => {
  expect(parseOrRefuse(noteSchema, { note: '  Surse ' }, 'fallback')).toEqual({
    note: 'Surse',
  });
  let refusal: unknown;
  try {
    parseOrRefuse(noteSchema, { note: ' ' }, 'fallback');
  } catch (failure) {
    refusal = failure;
  }
  expect(refusal).toBeInstanceOf(CommandError);
  expect(refusal).toMatchObject({
    reason: 'note_required',
    message: 'Scrie o notă.',
  });
});

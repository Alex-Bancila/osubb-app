import { useEffect, useId, useRef, useState } from 'react';
import type { z } from 'zod';
import { describeFailure } from './command-reasons';
import { FORM_ERROR, fieldErrors, type FieldErrors } from './form-errors';

/** A message and the value it was about: a changed value hides it. */
type Judged = Partial<Record<string, { message: string; value: unknown }>>;

function valueAt(values: unknown, field: string): unknown {
  return field
    .split('.')
    .reduce<unknown>(
      (current, key) =>
        current !== null && typeof current === 'object'
          ? (current as Record<string, unknown>)[key]
          : undefined,
      values,
    );
}

const FOCUSABLE =
  'input:not([type=hidden]),select,textarea,button,[tabindex]:not([tabindex="-1"])';

/**
 * One form's validation contract (ruling R8, #674).
 *
 * - A field is checked when it loses focus, and the whole draft on submit;
 *   nothing is disabled before the first submit, so a member can always try.
 * - Submit focuses the first invalid field and returns the parsed value — the
 *   schema's output, trimmed and normalised — or `null`.
 * - `fail(error, fallback)` puts a server refusal under the field its reason
 *   belongs to (`fieldForReason`); any other failure lands in `formError`.
 * - A message stays while the value it judged is unchanged: editing the field
 *   hides it until the next blur or submit.
 *
 * Every field that can show an error is registered with `field()` (an input)
 * or `slot()` (a wrapper around a picker). An error for a field that is not on
 * screen falls back to the form-level slot, so a rule is never broken
 * silently.
 */
export function useFormValidation<S extends z.ZodType>(
  schema: S,
  values: z.input<S>,
  fieldForReason: Readonly<Record<string, string>>,
) {
  const baseId = useId();
  const [judged, setJudged] = useState<Judged>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const elements = useRef(new Map<string, HTMLElement>());
  const focusRequest = useRef<string[] | null>(null);

  // Focus once the errors (and any re-enabled fieldset) are on screen.
  useEffect(() => {
    const fields = focusRequest.current;
    if (!fields) return;
    focusRequest.current = null;
    const targets = fields
      .map((field) => elements.current.get(field))
      .filter((element): element is HTMLElement => element !== undefined)
      .sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1,
      );
    const first = targets[0];
    const target = first?.matches(FOCUSABLE)
      ? first
      : first?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
  });

  const errorId = (field: string) => `${baseId}-${field}-error`;

  function error(field: string): string | undefined {
    const entry = judged[field];
    return entry && Object.is(entry.value, valueAt(values, field))
      ? entry.message
      : undefined;
  }

  function judge(field: string, message: string) {
    return { message, value: valueAt(values, field) };
  }

  /** Check one field against the whole draft (so cross-field rules apply). */
  function validateField(field: string) {
    const message = fieldErrors(
      schema.safeParse(values),
      undefined,
      fieldForReason,
    )[field];
    setJudged((current) => {
      const next = { ...current };
      if (message) next[field] = judge(field, message);
      else delete next[field];
      return next;
    });
  }

  /** Check everything; the parsed value, or `null` with the errors shown. */
  function validate(): z.output<S> | null {
    const result = schema.safeParse(values);
    if (result.success) {
      setJudged({});
      setFormError(undefined);
      return result.data;
    }
    const errors: FieldErrors = fieldErrors(result, undefined, fieldForReason);
    const next: Judged = {};
    let unplaced = errors[FORM_ERROR];
    for (const [field, message] of Object.entries(errors)) {
      if (field === FORM_ERROR || message === undefined) continue;
      if (elements.current.has(field)) next[field] = judge(field, message);
      else unplaced ??= message;
    }
    setJudged(next);
    setFormError(unplaced);
    focusRequest.current = Object.keys(next);
    return null;
  }

  /**
   * Show a failed command: under its field when the reason names one on
   * screen (then `true`), in the form-level slot otherwise.
   */
  function fail(failure: unknown, fallback: string): boolean {
    const { reason, message } = describeFailure(failure, fallback);
    const field = reason === undefined ? undefined : fieldForReason[reason];
    if (field !== undefined && elements.current.has(field)) {
      setJudged((current) => ({ ...current, [field]: judge(field, message) }));
      setFormError(undefined);
      focusRequest.current = [field];
      return true;
    }
    setFormError(message);
    return false;
  }

  function reset() {
    setJudged({});
    setFormError(undefined);
  }

  function register(field: string) {
    return (element: HTMLElement | null) => {
      if (element) elements.current.set(field, element);
      else elements.current.delete(field);
    };
  }

  /** Props for an input, select or textarea that shows its own errors. */
  function inputProps(name: string, describedBy?: string) {
    const invalid = error(name) !== undefined;
    return {
      ref: register(name),
      onBlur: () => validateField(name),
      'aria-invalid': invalid || undefined,
      'aria-describedby':
        [describedBy, invalid ? errorId(name) : undefined]
          .filter(Boolean)
          .join(' ') || undefined,
    };
  }

  /** A wrapper around a picker: its errors show, it is checked on submit. */
  function slot(name: string) {
    return { ref: register(name) };
  }

  /** Props for the `FieldError` under a field. */
  function errorProps(name: string) {
    return { id: errorId(name), children: error(name) };
  }

  return {
    validate,
    validateField,
    fail,
    reset,
    error,
    errorId,
    errorProps,
    field: inputProps,
    slot,
    formError,
  };
}

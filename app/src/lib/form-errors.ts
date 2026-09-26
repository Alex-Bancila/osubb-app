import { CommandError, reasonCopy } from './command-reasons';

/**
 * Where a form's errors go (ruling R8): each broken rule under the field it
 * belongs to, whether the browser found it (a zod issue) or the server
 * refused with it (a `CommandError.reason`). A reason that belongs to no
 * field lands in the form-level slot, `FORM_ERROR`.
 */
export const FORM_ERROR = 'form';

/** `{ [field]: message }`, plus `form` for what belongs to no field. */
export type FieldErrors = Partial<Record<string, string>>;

/** The copy for an issue that is not one of ours; no zod English leaks out. */
const UNKNOWN_ISSUE = 'Verifică valoarea acestui câmp.';

type Issue = { path: readonly PropertyKey[]; message: string };
type SchemaResult =
  { success: true } | { success: false; error: { issues: readonly Issue[] } };

/** The dotted field name of a zod path: `['link', 'url']` is `link.url`. */
export function issueField(issue: Issue): string | undefined {
  return issue.path.length ? issue.path.map(String).join('.') : undefined;
}

/**
 * Merge a schema result and a server reason into one message per field. The
 * first issue of a field wins; a server reason overrides it, because the
 * server has the last word. Messages are the shared Romanian copy.
 */
export function fieldErrors(
  schemaResult: SchemaResult | undefined,
  serverReason: string | undefined,
  fieldForReason: Readonly<Record<string, string>>,
): FieldErrors {
  const errors: FieldErrors = {};
  if (schemaResult && !schemaResult.success)
    for (const issue of schemaResult.error.issues) {
      const field =
        issueField(issue) ?? fieldForReason[issue.message] ?? FORM_ERROR;
      errors[field] ??= reasonCopy(issue.message) ?? UNKNOWN_ISSUE;
    }
  const copy = reasonCopy(serverReason);
  if (serverReason !== undefined && copy !== undefined)
    errors[fieldForReason[serverReason] ?? FORM_ERROR] = copy;
  return errors;
}

/**
 * The same schema, at the command's door: the parsed value, or a
 * `CommandError` carrying the first broken rule's reason, so a caller that
 * skipped the form still never sends what the server would refuse, and a form
 * that routes `CommandError.reason` shows it under the right field.
 */
export function parseOrRefuse<T>(
  schema: {
    safeParse: (
      value: unknown,
    ) =>
      | { success: true; data: T }
      | { success: false; error: { issues: readonly Issue[] } };
  },
  value: unknown,
  fallback: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new CommandError(
    { message: result.error.issues[0]?.message },
    fallback,
  );
}

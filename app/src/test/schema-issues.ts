import { expect } from 'vitest';
import { knownReasons } from '../lib/command-reasons';

type Parsed =
  | { success: true }
  | {
      success: false;
      error: { issues: readonly { path: PropertyKey[]; message: string }[] };
    };

/** A parse's issues as `field: reason` strings (`: reason` for no field). */
export function issues(result: Parsed): string[] {
  return result.success
    ? []
    : result.error.issues.map(
        (issue) => `${issue.path.map(String).join('.')}: ${issue.message}`,
      );
}

/**
 * Every issue a schema raises must be a reason with Romanian copy, and its
 * module's `fieldForReason` must send that reason to the same field — so a
 * server refusal with the same reason lands where the browser's would.
 */
export function expectRoutable(
  result: Parsed,
  fieldForReason: Readonly<Record<string, string>>,
) {
  if (result.success) return;
  for (const issue of result.error.issues) {
    expect(knownReasons().has(issue.message), issue.message).toBe(true);
    expect(fieldForReason[issue.message], issue.message).toBe(
      issue.path.map(String).join('.'),
    );
  }
}

/** Every reason a module maps has copy, and names one of its fields. */
export function expectMapComplete(
  fieldForReason: Readonly<Record<string, string>>,
  fields: readonly string[],
  serverReasons: readonly string[],
) {
  for (const reason of serverReasons)
    expect(fieldForReason[reason], reason).toBeDefined();
  for (const [reason, field] of Object.entries(fieldForReason)) {
    expect(knownReasons().has(reason), reason).toBe(true);
    expect(fields, reason).toContain(field);
  }
}

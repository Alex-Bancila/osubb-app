import { screen, waitFor, within } from '@testing-library/react';
import { beforeAll } from 'vitest';

// Every file that waits for the editor imports this helper, and Vitest hangs
// a hook called while a file loads on that file. The editor's chunk loads
// here once, before the file's first test, with time for a cold machine to
// transform it: inside that test it would spend the test's 5 s.
beforeAll(async () => {
  await import('../components/formatted-text/editor/FormattedTextEditor');
}, 30_000);

/**
 * A `FormattedTextField` by its label, once its editor's chunk has loaded:
 * the editable text (until then the field is a read-only text area with the
 * same name). Type into it with `user.click(field)` and `user.keyboard(…)`;
 * read it with `toHaveTextContent`.
 */
export async function findFormattedText(
  name: string | RegExp,
  container: HTMLElement = document.body,
): Promise<HTMLElement> {
  const scope = container === document.body ? screen : within(container);
  return waitFor(
    () => {
      const field = scope.getByRole('textbox', { name });
      if (field.getAttribute('contenteditable') === null)
        throw new Error(`The editor of “${String(name)}” is still loading.`);
      return field;
    },
    // Under the 5 s test timeout, so a chunk that never loads fails here,
    // with this message.
    { timeout: 4000 },
  );
}

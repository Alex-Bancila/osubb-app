import { screen, waitFor, within } from '@testing-library/react';

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
    { timeout: 5000 },
  );
}

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useEffect, useState, type ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { requiredFormattedText } from '../../lib/schemas/text';
import { useFormValidation } from '../../lib/use-form-validation';
import { findFormattedText } from '../../test/formatted-text';
import { FieldError } from '../ui/field';
import {
  FormattedTextField,
  type FormattedTextFieldProps,
} from './FormattedTextField';

const TOO_LONG = 'Mesajul are cel mult 2000 de caractere.';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('./editor/FormattedTextEditor');
  document.documentElement.style.removeProperty('--format-bar-h');
});

/** A device whose main pointer is a finger (`pointer: coarse`). */
function touchDevice() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const schema = z.object({
  body: requiredFormattedText({
    required: 'body_required',
    tooLong: 'body_too_long',
  }),
});

const fieldForReason = { body_required: 'body', body_too_long: 'body' };

/**
 * A form as the six sites build one: the label names the field by its id,
 * `form.field` is spread on it, the error sits under it.
 */
function Form({
  initial = '',
  onSubmit = () => {},
  onChange = () => {},
  Field = FormattedTextField,
}: {
  initial?: string;
  onSubmit?: (body: string) => void;
  onChange?: (body: string) => void;
  Field?: ComponentType<FormattedTextFieldProps>;
}) {
  const [values, setValues] = useState({ body: initial });
  const form = useFormValidation(schema, values, fieldForReason);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (form.validate()) onSubmit(values.body);
      }}
    >
      <label id="body-label" htmlFor="body">
        Mesaj
      </label>
      <Field
        id="body"
        labelId="body-label"
        name="body"
        required
        value={values.body}
        onChange={(body) => {
          onChange(body);
          setValues({ body });
        }}
        {...form.field('body')}
      />
      <FieldError {...form.errorProps('body')} />
      <input aria-label="Alt câmp" />
      <button type="submit">Publică</button>
    </form>
  );
}

describe('FormattedTextField (R60, §C)', () => {
  it('keeps a text it never changed exactly as stored (Review Focus 1)', async () => {
    const user = userEvent.setup();
    const legacy = '* unu\n* doi\n5*3*2';
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(<Form initial={legacy} onChange={onChange} onSubmit={onSubmit} />);
    const field = await findFormattedText('Mesaj');

    await user.click(field);
    await user.click(screen.getByLabelText('Alt câmp'));
    await user.click(screen.getByRole('button', { name: 'Publică' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith(legacy);
  });

  it('is a multi-line textbox named by its label, which focuses it', async () => {
    const user = userEvent.setup();
    render(<Form initial="x" />);
    const field = await findFormattedText('Mesaj');

    expect(field).toHaveAttribute('id', 'body');
    expect(field).toHaveAttribute('aria-multiline', 'true');
    expect(field).toBeRequired();

    await user.click(screen.getByText('Mesaj'));

    // Tiptap focuses on the next frame.
    await waitFor(() => expect(field).toHaveFocus());
  });

  it('sends the first key of a burst at once, the rest once typing rests (ruling 35)', async () => {
    const onChange = vi.fn();
    render(<Form initial="**a**" onChange={onChange} />);
    const field = await findFormattedText('Mesaj');
    // Real timers: Testing Library's async wrapper waits on a `setTimeout`
    // that Vitest's fake timers would hold for ever.
    const user = userEvent.setup();
    await user.click(field);

    // One burst: within one `keyboard` call the next key always comes before
    // the burst's timer, however slow the machine.
    await user.keyboard('bcd');

    // The first key went at once and alone; the rest as one once typing
    // rested. jsdom has no layout, so the press left the caret at the start,
    // in the bold run.
    await waitFor(() =>
      expect(onChange.mock.calls).toEqual([['**ba**'], ['**bcda**']]),
    );
  });

  it('sends a change still waiting when the field closes', async () => {
    const onChange = vi.fn();
    const view = render(<Form onChange={onChange} />);
    const field = await findFormattedText('Mesaj');
    const user = userEvent.setup();
    await user.click(field);

    await user.keyboard('ab');
    view.unmount();

    expect(onChange.mock.calls).toEqual([['a'], ['ab']]);
  });

  it('drops a change still waiting when the form resets the text (ruling 35)', async () => {
    const onChange = vi.fn();
    // The form's own reset, called from the test with no press (a press
    // would blur the text and send it first).
    const form = { reset: () => {} };
    function Resettable() {
      const [body, setBody] = useState('');
      useEffect(() => {
        form.reset = () => setBody('');
      });
      return (
        <>
          <label id="body-label" htmlFor="body">
            Mesaj
          </label>
          <FormattedTextField
            id="body"
            labelId="body-label"
            name="body"
            value={body}
            onChange={(next) => {
              onChange(next);
              setBody(next);
            }}
          />
          <input aria-label="Alt câmp" />
        </>
      );
    }
    const view = render(<Resettable />);
    const field = await findFormattedText('Mesaj');
    const user = userEvent.setup();
    await user.click(field);
    await user.keyboard('ab');
    // The first key went at once; "ab" waits for typing to rest.
    expect(onChange.mock.calls).toEqual([['a']]);

    // The form empties the field (Escape closing the compose sheet) before
    // typing rests.
    act(() => form.reset());
    expect(field.textContent).toBe('');

    // Neither the settling, nor the blur, nor closing the field sends "ab".
    await act(() => new Promise((done) => setTimeout(done, 300)));
    await user.click(screen.getByLabelText('Alt câmp'));
    view.unmount();
    expect(onChange.mock.calls).toEqual([['a']]);
  });

  it('submits what was just typed, when the submit button follows at once (ruling 33)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Form onSubmit={onSubmit} />);
    const field = await findFormattedText('Mesaj');
    await user.click(field);

    await user.keyboard('Ședința e joi');
    await user.click(screen.getByRole('button', { name: 'Publică' }));

    expect(onSubmit).toHaveBeenCalledWith('Ședința e joi');
  });

  it('checks a pasted text over 2000 characters on blur, with the flushed value (ruling 33)', async () => {
    const user = userEvent.setup();
    render(<Form />);
    const field = await findFormattedText('Mesaj');
    await user.click(field);

    await user.paste('a'.repeat(2001));
    await user.click(screen.getByLabelText('Alt câmp'));

    expect(await screen.findByText(TOO_LONG)).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('2001 / 2000 caractere')).toHaveClass(
      'text-destructive',
    );
  });

  it('counts the characters the reader shows', async () => {
    render(<Form initial="**ab**" />);
    await findFormattedText('Mesaj');

    expect(screen.getByText('2 / 2000 caractere')).toBeInTheDocument();
  });

  it('a failed submit focuses the text', async () => {
    const user = userEvent.setup();
    render(<Form />);
    const field = await findFormattedText('Mesaj');

    await user.click(screen.getByRole('button', { name: 'Publică' }));

    expect(await screen.findByText('Scrie mesajul.')).toBeInTheDocument();
    await waitFor(() => expect(field).toHaveFocus());
  });

  it('gives a mouse the top toolbar, and no keyboard bar', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Form initial="x" onSubmit={onSubmit} />);
    const field = await findFormattedText('Mesaj');
    await user.click(field);

    expect(
      document.querySelector('[data-slot="formatted-text-toolbar"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="formatted-text-keyboard-bar"]'),
    ).toBeNull();
    // Its controls sit inside the form and never submit it.
    await user.click(screen.getByRole('button', { name: 'Aldin' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('gives touch the keyboard bar while the text has focus, and no top toolbar', async () => {
    touchDevice();
    const user = userEvent.setup();
    render(<Form initial="x" />);
    const field = await findFormattedText('Mesaj');

    expect(
      document.querySelector('[data-slot="formatted-text-toolbar"]'),
    ).toBeNull();

    await user.click(field);

    const bar = document.querySelector<HTMLElement>(
      '[data-slot="formatted-text-keyboard-bar"]',
    );
    expect(bar).toBeInTheDocument();
    // Inside the field's own tree, so inside a sheet's popup.
    expect(field.closest('form')).toContainElement(bar);
    expect(
      within(bar as HTMLElement).getByRole('button', { name: 'Stiluri' }),
    ).toBeInTheDocument();
  });

  it('sends a change made without the text’s focus at once (the Aa panel)', async () => {
    touchDevice();
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Form initial="x" onChange={onChange} />);
    const field = await findFormattedText('Mesaj');
    await user.click(field);
    await user.click(screen.getByRole('button', { name: 'Stiluri' }));
    await waitFor(() => expect(field).not.toHaveFocus());
    const panel = screen.getByRole('toolbar', { name: 'Stiluri' });

    await user.click(within(panel).getByRole('button', { name: 'Titlu' }));

    expect(onChange).toHaveBeenLastCalledWith('# x');
  });

  it('shows the text the form resets it to', async () => {
    const user = userEvent.setup();
    function Resettable() {
      const [body, setBody] = useState('vechi');
      return (
        <>
          <label id="body-label" htmlFor="body">
            Mesaj
          </label>
          <FormattedTextField
            id="body"
            labelId="body-label"
            name="body"
            value={body}
            onChange={setBody}
          />
          <button type="button" onClick={() => setBody('')}>
            Golește
          </button>
        </>
      );
    }
    render(<Resettable />);
    const field = await findFormattedText('Mesaj');

    await user.click(screen.getByRole('button', { name: 'Golește' }));

    expect(field.textContent).toBe('');
    expect(screen.getByText('0 / 2000 caractere')).toBeInTheDocument();
  });

  it('locks the text while its fieldset is disabled', async () => {
    function Locked({ disabled }: { disabled: boolean }) {
      return (
        <fieldset disabled={disabled}>
          <label id="body-label" htmlFor="body">
            Mesaj
          </label>
          <FormattedTextField
            id="body"
            labelId="body-label"
            name="body"
            value="x"
            onChange={() => {}}
          />
        </fieldset>
      );
    }
    const { rerender } = render(<Locked disabled={false} />);
    const field = await findFormattedText('Mesaj');

    rerender(<Locked disabled />);
    expect(field).toHaveAttribute('contenteditable', 'false');

    rerender(<Locked disabled={false} />);
    expect(field).toHaveAttribute('contenteditable', 'true');
  });

  it('never sends a text it did not change, whatever its props do (Minor 6)', async () => {
    const onChange = vi.fn();
    const legacy = '* unu\n* doi\n5*3*2';
    function Field(props: Partial<FormattedTextFieldProps>) {
      return (
        <>
          <label id="body-label" htmlFor="body">
            Mesaj
          </label>
          <FormattedTextField
            id="body"
            labelId="body-label"
            name="body"
            value={legacy}
            onChange={onChange}
            {...props}
          />
        </>
      );
    }
    const view = render(<Field />);
    const field = await findFormattedText('Mesaj');

    // A refusal marks the field and names its message.
    view.rerender(<Field aria-invalid aria-describedby="refuz" />);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby')).toMatch(/^refuz /);
    // The Member edits another field: the message goes.
    view.rerender(<Field aria-describedby="alt" />);
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(field.getAttribute('aria-describedby')).toMatch(/^alt /);
    view.unmount();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('passes axe once the editor has loaded', async () => {
    const { container } = render(<Form initial="**Ședința** e joi." />);
    await findFormattedText('Mesaj');

    expect((await axe.run(container)).violations).toEqual([]);
  });
});

describe('the form’s check while the field opens its own panels (Minor 2)', () => {
  const MISSING = 'Scrie mesajul.';

  it('waits while the Aa panel is open, and runs once focus leaves the field', async () => {
    touchDevice();
    const user = userEvent.setup();
    render(<Form />);
    const field = await findFormattedText('Mesaj');
    await user.click(field);

    await user.click(screen.getByRole('button', { name: 'Stiluri' }));
    await waitFor(() => expect(field).not.toHaveFocus());

    expect(
      screen.getByRole('toolbar', { name: 'Stiluri' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(MISSING)).toBeNull();
    expect(field).not.toHaveAttribute('aria-invalid');

    await user.click(screen.getByLabelText('Alt câmp'));

    expect(await screen.findByText(MISSING)).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('runs once Ascunde tastatura puts the panel away', async () => {
    touchDevice();
    const user = userEvent.setup();
    render(<Form />);
    const field = await findFormattedText('Mesaj');
    await user.click(field);
    await user.click(screen.getByRole('button', { name: 'Stiluri' }));
    await waitFor(() => expect(field).not.toHaveFocus());
    expect(screen.queryByText(MISSING)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Ascunde tastatura' }));

    expect(await screen.findByText(MISSING)).toBeInTheDocument();
  });

  it('does not run on a press on the toolbar that misses every control', async () => {
    const user = userEvent.setup();
    render(<Form />);
    const field = await findFormattedText('Mesaj');
    await user.click(field);

    await user.click(screen.getByRole('toolbar', { name: 'Formatare' }));

    expect(field).toHaveFocus();
    expect(screen.queryByText(MISSING)).toBeNull();
  });

  it('waits while the Stil menu is open, and runs once focus leaves the field', async () => {
    const user = userEvent.setup();
    render(<Form />);
    const field = await findFormattedText('Mesaj');
    await user.click(field);

    await user.click(screen.getByRole('button', { name: /^Stil/ }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();

    expect(screen.queryByText(MISSING)).toBeNull();
    expect(field).not.toHaveAttribute('aria-invalid');

    await user.click(screen.getByLabelText('Alt câmp'));

    expect(await screen.findByText(MISSING)).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('waits while the link dialog is open, and while focus is back in the text', async () => {
    const user = userEvent.setup();
    render(<Form />);
    const field = await findFormattedText('Mesaj');
    await user.click(field);

    await user.click(screen.getByRole('button', { name: 'Link' }));
    const dialog = await screen.findByRole('dialog', { name: 'Adaugă link' });
    expect(screen.queryByText(MISSING)).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Renunță' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(field).toHaveFocus());
    expect(screen.queryByText(MISSING)).toBeNull();

    await user.click(screen.getByLabelText('Alt câmp'));

    expect(await screen.findByText(MISSING)).toBeInTheDocument();
  });
});

describe('FormattedTextField while its chunk loads', () => {
  it('shows the text read-only under the same label, then the editor', async () => {
    vi.resetModules();
    const { FormattedTextField: Fresh } = await import('./FormattedTextField');
    render(<Form initial="Ne vedem joi." Field={Fresh} />);

    const waiting = screen.getByRole('textbox', { name: 'Mesaj' });
    expect(waiting.tagName).toBe('TEXTAREA');
    expect(waiting).toHaveAttribute('readonly');
    expect(waiting).toHaveValue('Ne vedem joi.');

    const field = await findFormattedText('Mesaj');
    expect(field).toHaveTextContent('Ne vedem joi.');
  });

  it('falls back to a plain text area when the chunk cannot load', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.resetModules();
    vi.doMock('./editor/FormattedTextEditor', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const { FormattedTextField: Offline } =
      await import('./FormattedTextField');
    const onSubmit = vi.fn();
    render(<Form Field={Offline} onSubmit={onSubmit} />);

    const field = await waitFor(() => {
      const found = screen.getByRole('textbox', { name: 'Mesaj' });
      expect(found).not.toHaveAttribute('readonly');
      return found;
    });
    expect(field.tagName).toBe('TEXTAREA');

    await user.type(field, 'Ședința e joi');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Publică' }));
    });

    expect(onSubmit).toHaveBeenCalledWith('Ședința e joi');
  });
});

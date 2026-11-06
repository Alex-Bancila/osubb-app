import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { findFormattedText } from '../../test/formatted-text';
import { FormattedTextField } from '../formatted-text/FormattedTextField';
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxTrigger,
  ComboboxValue,
} from './combobox';
import { fieldControlClass, Input, Textarea } from './input';

/**
 * iOS Safari zooms the page in when a field whose text is under 16 px takes
 * focus, and the page stays zoomed after it. A zoomed page has no keyboard
 * inset (`measureKeyboard`), so the Formatted Text keyboard bar sat under an
 * iPhone's keyboard, out of sight. On a touch screen every field a Member
 * types in is 16 px; a mouse keeps the 14 px control text (DESIGN.md).
 */
const TOUCH_TEXT = 'pointer-coarse:text-base';

describe('fields are 16 px on a touch screen, so iOS never zooms in', () => {
  it('the one field surface: Input, Textarea, and through it Select and the date picker', () => {
    render(
      <>
        <Input aria-label="Titlu" />
        <Textarea aria-label="Motiv" />
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'Titlu' })).toHaveClass(
      'text-sm',
      TOUCH_TEXT,
    );
    expect(screen.getByRole('textbox', { name: 'Motiv' })).toHaveClass(
      'text-sm',
      TOUCH_TEXT,
    );
    expect(fieldControlClass.split(' ')).toContain(TOUCH_TEXT);
  });

  it('a combobox’s search', async () => {
    const user = userEvent.setup();
    render(
      <Combobox items={['Ana Pop']}>
        <ComboboxTrigger aria-label="Executant">
          <ComboboxValue placeholder="Alege un membru" />
        </ComboboxTrigger>
        <ComboboxContent>
          <ComboboxInput placeholder="Caută un membru" />
        </ComboboxContent>
      </Combobox>,
    );
    await user.click(screen.getByRole('combobox', { name: 'Executant' }));
    expect(await screen.findByPlaceholderText('Caută un membru')).toHaveClass(
      TOUCH_TEXT,
    );
  });

  it('Formatted Text, whose paragraphs take the field’s size', async () => {
    render(
      <>
        <span id="body-label">Mesaj</span>
        <FormattedTextField
          id="body"
          labelId="body-label"
          name="body"
          value="Ședința de vineri"
          onChange={() => {}}
        />
      </>,
    );
    const text = await findFormattedText('Mesaj');
    expect(text.closest('[data-slot="formatted-text-input"]')).toHaveClass(
      TOUCH_TEXT,
    );
  });
});

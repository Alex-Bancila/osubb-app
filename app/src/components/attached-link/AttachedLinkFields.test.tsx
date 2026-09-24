import * as axe from 'axe-core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  attachedLinkSchema,
  fieldForReason,
} from '../../lib/schemas/attached-link';
import { useFormValidation } from '../../lib/use-form-validation';
import {
  AttachedLinkFields,
  type AttachedLinkValue,
} from './AttachedLinkFields';

/**
 * A minimal caller: `useFormValidation` wired to the real `attached-link`
 * schema, the same way `AnnouncementComposeSheet` wires it (#679's own
 * boundary is the two components; validation behaviour is `attachedLinkSchema`'s,
 * proven again here through the component that renders it).
 */
function Harness({ name }: { name?: string } = {}) {
  const [value, setValue] = useState<AttachedLinkValue>({
    label: '',
    url: '',
  });
  const form = useFormValidation(attachedLinkSchema, value, fieldForReason);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.validate();
      }}
    >
      <AttachedLinkFields
        value={value}
        onChange={setValue}
        form={form}
        name={name}
      />
      <button
        type="button"
        onClick={() =>
          form.fail({ message: 'link_label_too_long' }, 'fallback')
        }
      >
        Simulează refuz server
      </button>
      <button type="submit">Validează</button>
    </form>
  );
}

const submit = () => screen.getByRole('button', { name: 'Validează' });
const labelBox = () => screen.getByRole('textbox', { name: 'Etichetă link' });
const urlBox = () => screen.getByRole('textbox', { name: 'Adresă link' });

/** A stub `form` for tests that only check delegation, not real validation. */
function stubForm() {
  const field = vi.fn(() => ({
    ref: () => {},
    onBlur: () => {},
    'aria-invalid': undefined,
    'aria-describedby': undefined,
  }));
  const errorProps = vi.fn(() => ({ id: 'stub-error', children: undefined }));
  return { field, errorProps };
}

describe('AttachedLinkFields', () => {
  it('accepts the empty pair', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await user.click(submit());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it('refuses a label without an address, under the address field', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(labelBox(), 'Formular');
    await user.click(submit());
    expect(urlBox()).toHaveAccessibleDescription(
      'Scrie adresa linkului sau lasă linkul gol.',
    );
  });

  it('refuses an address without a label, under the label field', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(urlBox(), 'https://osubb.ro');
    await user.click(submit());
    expect(labelBox()).toHaveAccessibleDescription(
      'Scrie numele linkului sau lasă linkul gol.',
    );
  });

  it('shows the 60-character label limit under the label field', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(labelBox(), 'l'.repeat(61));
    await user.type(urlBox(), 'https://osubb.ro');
    await user.click(submit());
    expect(labelBox()).toHaveAccessibleDescription(
      'Numele linkului are cel mult 60 de caractere.',
    );
  });

  it('shows a non-http(s) address under the address field', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(labelBox(), 'Formular');
    await user.type(urlBox(), 'ftp://osubb.ro');
    await user.click(submit());
    expect(urlBox()).toHaveAccessibleDescription(
      'Adresa trebuie să înceapă cu http:// sau https://.',
    );
  });

  it('shows the https hint under the address field', () => {
    render(<Harness />);
    expect(screen.getByText('Adresa începe cu https://')).toBeInTheDocument();
  });

  it('puts a server reason under the field it names', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(
      screen.getByRole('button', { name: 'Simulează refuz server' }),
    );
    expect(labelBox()).toHaveAccessibleDescription(
      'Numele linkului are cel mult 60 de caractere.',
    );
  });

  it('reads and writes the pair through value/onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const value: AttachedLinkValue = { label: '', url: '' };
    render(
      <AttachedLinkFields
        value={value}
        onChange={onChange}
        form={stubForm()}
      />,
    );
    await user.type(labelBox(), 'F');
    expect(onChange).toHaveBeenCalledWith({ label: 'F', url: '' });
  });

  it('prefixes the field path with `name` for a schema where the pair is nested', () => {
    const form = stubForm();
    render(
      <AttachedLinkFields
        value={{ label: '', url: '' }}
        onChange={() => {}}
        form={form}
        name="link"
      />,
    );
    expect(form.field).toHaveBeenCalledWith('link.label');
    expect(form.field).toHaveBeenCalledWith('link.url');
    expect(form.errorProps).toHaveBeenCalledWith('link.label');
    expect(form.errorProps).toHaveBeenCalledWith('link.url');
  });

  it('uses the bare field names when no `name` prefix is given', () => {
    const form = stubForm();
    render(
      <AttachedLinkFields
        value={{ label: '', url: '' }}
        onChange={() => {}}
        form={form}
      />,
    );
    expect(form.field).toHaveBeenCalledWith('label');
    expect(form.field).toHaveBeenCalledWith('url');
  });
});

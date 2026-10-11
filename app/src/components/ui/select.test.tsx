import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { chooseOption } from '../../test/select';
import { Select } from './select';

const options = [
  { value: 'meeting', label: 'Ședință' },
  { value: 'activity', label: 'Activitate' },
  { value: 'deadline', label: 'Termen' },
  { value: 'other', label: 'Altele', disabled: true },
] as const;

function Field({ onChange = () => {} }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState<string>('');
  return (
    <>
      <label htmlFor="tip">Tip</label>
      <Select
        id="tip"
        value={value}
        placeholder="Alege tipul"
        options={options}
        onValueChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    </>
  );
}

describe('Select', () => {
  it('is a field named by its label that shows the placeholder, then the chosen option', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);

    const field = screen.getByRole('combobox', { name: 'Tip' });
    expect(field).toHaveTextContent('Alege tipul');
    expect(field).toHaveAttribute('data-slot', 'select');

    await chooseOption(user, field, 'Activitate');
    expect(onChange).toHaveBeenLastCalledWith('activity');
    expect(field).toHaveTextContent('Activitate');
    expect(field).toHaveAttribute('data-value', 'activity');
  });

  it('lists its options in the app’s own pop-over, a disabled one marked', async () => {
    const user = userEvent.setup();
    render(<Field />);

    await user.click(screen.getByRole('combobox', { name: 'Tip' }));
    const names = (await screen.findAllByRole('option')).map(
      (option) => option.textContent,
    );
    expect(names).toEqual(['Ședință', 'Activitate', 'Termen', 'Altele']);
    expect(screen.getByRole('option', { name: 'Altele' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

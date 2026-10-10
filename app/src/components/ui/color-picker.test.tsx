import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { hexToHsv, hsvToHex, type Hsv } from '../../lib/color';

/** A hex the test knows is valid, as hue, saturation and value. */
function hsv(hex: string): Hsv {
  const parsed = hexToHsv(hex);
  if (!parsed) throw new Error(`Not a colour: ${hex}`);
  return parsed;
}
import { ColorPicker } from './color-picker';

function Field({
  initial = '#ED2025',
  onChange = () => {},
}: {
  initial?: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ColorPicker
      label="Alege culoarea avatarului"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('colour conversion', () => {
  it('round-trips a hex through hue, saturation and value', () => {
    for (const hex of ['#ED2025', '#284C93', '#007F33', '#0B0B0C', '#FFFFFF'])
      expect(hsvToHex(hsv(hex))).toBe(hex);
    expect(hexToHsv('url(x)')).toBeNull();
    expect(hexToHsv('#12345')).toBeNull();
  });
});

describe('ColorPicker', () => {
  it('opens on the OSUBB colours, the current one pressed, and picks another', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);

    expect(screen.getByRole('radio', { name: 'OSUBB' })).toBeChecked();
    const swatches = screen.getByRole('group', {
      name: 'Alege culoarea avatarului',
    });
    expect(within(swatches).getAllByRole('button')).toHaveLength(7);
    expect(
      within(swatches).getByRole('button', { name: 'Roșu OSUBB' }),
    ).toHaveAttribute('aria-pressed', 'true');

    await user.click(
      within(swatches).getByRole('button', { name: 'Financiar' }),
    );
    expect(onChange).toHaveBeenLastCalledWith('#007F33');
    expect(
      within(swatches).getByRole('button', { name: 'Financiar' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens on Personalizată for a colour of the member’s own, showing its code', () => {
    render(<Field initial="#1A5FD0" />);

    expect(screen.getByRole('radio', { name: 'Personalizată' })).toBeChecked();
    expect(screen.getByLabelText('Codul culorii')).toHaveValue('#1A5FD0');
    expect(
      screen.queryByRole('group', { name: 'Alege culoarea avatarului' }),
    ).toBeNull();
  });

  it('takes any colour: a typed code, the hue slider, the pad’s arrow keys', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Personalizată' }));

    const code = screen.getByLabelText('Codul culorii');
    await user.clear(code);
    // Half a code changes nothing and is marked; a whole one sets the colour.
    await user.type(code, '#12AB');
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).not.toHaveBeenCalled();
    await user.type(code, 'CD');
    expect(onChange).toHaveBeenLastCalledWith('#12ABCD');
    expect(code).toHaveAttribute('aria-invalid', 'false');

    // The slider turns the hue and keeps saturation and brightness.
    const before = hsv('#12ABCD');
    fireEvent.change(screen.getByRole('slider', { name: 'Nuanță' }), {
      target: { value: '120' },
    });
    const turned = hsv(onChange.mock.lastCall?.[0] as string);
    expect(Math.round(turned.h)).toBe(120);
    expect(turned.s).toBeCloseTo(before.s, 1);
    expect(turned.v).toBeCloseTo(before.v, 1);

    // The pad answers the arrow keys: down is darker.
    const pad = screen.getByRole('slider', {
      name: 'Saturație și luminozitate',
    });
    pad.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const darker = hsv(onChange.mock.lastCall?.[0] as string);
    expect(darker.v).toBeLessThan(turned.v);
    expect(code).toHaveValue(onChange.mock.lastCall?.[0]);
  });

  it('goes back to an OSUBB colour from Personalizată', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Field initial="#1A5FD0" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'OSUBB' }));
    await user.click(screen.getByRole('button', { name: 'Negru' }));
    expect(onChange).toHaveBeenLastCalledWith('#0B0B0C');
  });

  it('offers an empty swatch for an optional colour, which clears the value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Optional() {
      const [value, setValue] = useState('#284C93');
      return (
        <ColorPicker
          label="Alege culoarea grupului"
          noneLabel="Fără culoare"
          value={value}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
        />
      );
    }
    render(<Optional />);

    const none = screen.getByRole('button', { name: 'Fără culoare' });
    expect(none).toHaveAttribute('aria-pressed', 'false');
    await user.click(none);
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(none).toHaveAttribute('aria-pressed', 'true');
    // A required colour (an avatar's) has no such swatch.
    expect(screen.getAllByRole('button')).toHaveLength(8);
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { InfoHint } from './info-hint';

describe('InfoHint', () => {
  it('describes its field while closed and opens the text in a pop-over', async () => {
    const user = userEvent.setup();
    render(
      <>
        <label htmlFor="campanie">Campanie</label>
        <input id="campanie" aria-describedby="campanie-hint" />
        <InfoHint label="Despre campanie" id="campanie-hint">
          O etichetă pentru raportare.
        </InfoHint>
      </>,
    );

    // Closed: nothing drawn, yet the field is described.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Campanie')).toHaveAccessibleDescription(
      'O etichetă pentru raportare.',
    );

    await user.click(screen.getByRole('button', { name: 'Despre campanie' }));
    expect(
      await screen.findByRole('dialog', { name: 'Despre campanie' }),
    ).toHaveTextContent('O etichetă pentru raportare.');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionScreen } from './SessionScreen';

describe('SessionScreen', () => {
  it('centres a card on the screen at every width (#844, layout S1)', () => {
    render(
      <SessionScreen>
        <h1>Conectare</h1>
      </SessionScreen>,
    );
    const frame = screen.getByRole('main');
    // The screen above a phone keyboard, not the whole screen (#1013).
    expect(frame).toHaveClass(
      'grid',
      'place-items-center',
      'h-[calc(100dvh-var(--keyboard-inset))]',
    );
    // `place-content` would clip a card taller than the screen at its top.
    expect(frame).not.toHaveClass('place-content-center');
  });

  it('starts the reading-width Notice at the top, where it is read', () => {
    render(
      <SessionScreen wide>
        <h1>Notă de informare</h1>
      </SessionScreen>,
    );
    expect(screen.getByRole('main')).not.toHaveClass('place-items-center');
  });
});

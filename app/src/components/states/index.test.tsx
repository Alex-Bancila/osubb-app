import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Empty, Loading } from './index';

describe('Empty', () => {
  it('explains the empty state using the screen-specific message', () => {
    render(<Empty text="Nu există evenimente viitoare." />);

    expect(
      screen.getByText('Nu există evenimente viitoare.'),
    ).toBeInTheDocument();
  });
});

describe('Loading', () => {
  it('holds the place of the rows with skeletons and says its label to a screen reader', () => {
    const { container } = render(<Loading label="Se încarcă taskurile…" />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Se încarcă taskurile…');
    expect(screen.getByText('Se încarcă taskurile…')).toHaveClass('sr-only');
    const rows = container.querySelectorAll('[data-slot="skeleton"]');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toHaveAttribute('aria-hidden', 'true');
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Empty } from './index';

describe('Empty', () => {
  it('explains the empty state using the screen-specific message', () => {
    render(<Empty text="Nu există evenimente viitoare." />);

    expect(
      screen.getByText('Nu există evenimente viitoare.'),
    ).toBeInTheDocument();
  });
});

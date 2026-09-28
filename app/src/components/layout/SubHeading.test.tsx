import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SubHeading } from './SubHeading';

describe('SubHeading', () => {
  it('is an h3 in the eyebrow style by default — never above the 19 px section title (X10)', () => {
    render(<SubHeading>Grupuri</SubHeading>);
    const heading = screen.getByRole('heading', { level: 3, name: 'Grupuri' });
    expect(heading).toHaveClass(
      'text-[length:var(--fs-xs)]',
      'font-extrabold',
      'uppercase',
      'm-0',
    );
    expect(heading.className).not.toMatch(/text-(lg|xl|2xl)\b/);
  });

  it('can be a 14 px / 600 label at another level', () => {
    render(
      <SubHeading as="h4" variant="label">
        Rol organizațional
      </SubHeading>,
    );
    expect(
      screen.getByRole('heading', { level: 4, name: 'Rol organizațional' }),
    ).toHaveClass('text-sm', 'font-semibold');
  });
});

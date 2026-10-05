import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { MemberCount } from './MemberCount';

it.each([
  [1, 1, '1 membru'],
  [3, 3, '3 membri'],
  [20, 20, '20 de membri'],
  [101, 101, '101 membri'],
  [1, 3, '1 din 3 membri'],
  [0, 1, '0 din 1 membru'],
  [5, 40, '5 din 40 de membri'],
])('shown %i of %i reads "%s" (#1018)', (shown, total, text) => {
  render(<MemberCount shown={shown} total={total} />);
  const count = screen.getByRole('status');
  expect(count).toHaveTextContent(text);
  expect(count).toHaveClass('text-sm', 'text-muted-foreground');
});

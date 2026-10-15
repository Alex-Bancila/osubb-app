import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { BootShell } from './BootShell';

it('is the shell index.html draws, so the hand-over to React does not flicker', () => {
  const { container } = render(<BootShell />);
  expect(
    screen.getByRole('status', { name: 'Se încarcă aplicația' }),
  ).toBeInTheDocument();
  const html = readFileSync(path.resolve('index.html'), 'utf8');
  const root =
    /<div id="root">([\s\S]*?)<\/div>\s*<script/.exec(html)?.[1] ?? '';
  const classes = (markup: string) =>
    [...markup.matchAll(/class="([^"]+)"/g)].map((match) => match[1]);
  expect(classes(container.innerHTML)).toEqual(classes(root));
});

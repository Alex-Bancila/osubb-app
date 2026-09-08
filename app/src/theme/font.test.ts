/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import indexHtml from '../../index.html?raw';
import packageJson from '../../package.json';
import mainTsx from '../main.tsx?raw';

const tokensCss = readFileSync('src/theme/tokens.css', 'utf8');

describe('Montserrat local bundling (#214)', () => {
  it('removes Google Fonts runtime links from index.html', () => {
    expect(indexHtml).not.toContain('fonts.googleapis.com');
    expect(indexHtml).not.toContain('fonts.gstatic.com');
  });

  it('pins @fontsource-variable/montserrat exactly at 5.3.0 in package.json', () => {
    const pkg = packageJson as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.['@fontsource-variable/montserrat']).toBe('5.3.0');
  });

  it('imports @fontsource-variable/montserrat in main.tsx', () => {
    expect(mainTsx).toContain('@fontsource-variable/montserrat');
  });

  it('configures Montserrat Variable as primary font in tokens.css', () => {
    expect(tokensCss).toMatch(
      /--font-family-base:\s*["']Montserrat Variable["']/,
    );
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Montserrat local bundling (#214)', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const indexHtmlPath = path.join(rootDir, 'index.html');
  const packageJsonPath = path.join(rootDir, 'package.json');
  const tokensCssPath = path.join(rootDir, 'src/theme/tokens.css');
  const mainTsxPath = path.join(rootDir, 'src/main.tsx');

  it('removes Google Fonts runtime links from index.html', () => {
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');
    expect(indexHtml).not.toContain('fonts.googleapis.com');
    expect(indexHtml).not.toContain('fonts.gstatic.com');
  });

  it('pins @fontsource-variable/montserrat exactly at 5.3.0 in package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    expect(pkg.dependencies?.['@fontsource-variable/montserrat']).toBe('5.3.0');
  });

  it('imports @fontsource-variable/montserrat in main.tsx', () => {
    const mainTsx = fs.readFileSync(mainTsxPath, 'utf-8');
    expect(mainTsx).toContain('@fontsource-variable/montserrat');
  });

  it('configures Montserrat Variable as primary font in tokens.css', () => {
    const tokensCss = fs.readFileSync(tokensCssPath, 'utf-8');
    expect(tokensCss).toMatch(
      /--font-family-base:\s*["']Montserrat Variable["']/,
    );
  });
});

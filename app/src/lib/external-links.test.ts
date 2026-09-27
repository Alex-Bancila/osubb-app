import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Every link that opens a new tab cuts the new page off from this one
 * (`noopener`) and sends it no Referer (`noreferrer`). A source sweep, so a
 * new `target="_blank"` anywhere in the app is held to the same rule.
 */

const SRC = path.resolve('src');

const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
  .map((file) => ({
    file: file.replaceAll('\\', '/'),
    text: readFileSync(path.join(SRC, file), 'utf8'),
  }));

/** The JSX opening tag around `index`: from its `<` to the `>` that closes it. */
function openingTag(text: string, index: number): string {
  const start = text.lastIndexOf('<', index);
  let depth = 0;
  for (let at = start; at < text.length; at += 1) {
    const character = text[at];
    if (character === '{') depth += 1;
    else if (character === '}') depth -= 1;
    else if (character === '>' && depth === 0) return text.slice(start, at + 1);
  }
  return text.slice(start);
}

describe('links that open a new tab', () => {
  const blanks = sources.flatMap(({ file, text }) =>
    [...text.matchAll(/target="_blank"/g)].map((match) => ({
      file,
      tag: openingTag(text, match.index),
    })),
  );

  it('exist, so this sweep is looking at real code', () => {
    expect(blanks.length).toBeGreaterThanOrEqual(3);
  });

  it('all carry rel="noopener noreferrer"', () => {
    const missing = blanks
      .filter(({ tag }) => !tag.includes('rel="noopener noreferrer"'))
      .map(({ file }) => file);
    expect(missing).toEqual([]);
  });

  it('never go through window.open, which the rule above cannot see', () => {
    const opens = sources
      .filter(({ text }) => /\bwindow\.open\(/.test(text))
      .map(({ file }) => file);
    expect(opens).toEqual([]);
  });
});

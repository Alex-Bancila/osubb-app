import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toPlainText, visibleLength } from './plain';

/*
 * The parity contract of R60: the TypeScript stripper gives the words the
 * database stripper gives. The fixtures are not copied here; they are the
 * one-line `select is(private.formatted_text_plain(E'..'), E'..', '..');`
 * assertions of supabase/tests/formatted_text_plain.test.sql, read from that
 * file, so a fixture added there is run through both sides and a change to
 * either chain that the other does not follow fails one of the two suites.
 */

const SUITE = path.resolve(
  import.meta.dirname,
  '../../../../supabase/tests/formatted_text_plain.test.sql',
);

const FIXTURE_LINE =
  /^select is\(private\.formatted_text_plain\(E'(.*)'\), E'(.*)', '(.+)'\);$/;

/**
 * The text an `E'..'` literal holds: `''` is a quote, and a backslash escape is
 * what it names. One left-to-right pass, so `\\n` is a backslash then an `n`.
 * An escape this reader does not know throws, so a new fixture shape cannot be
 * misread without the test saying so.
 */
function unescapeSql(literal: string): string {
  return literal.replace(/\\(.)|''/g, (match, escaped?: string) => {
    if (match === "''") return "'";
    switch (escaped) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '\\':
        return '\\';
      default:
        throw new Error(`Unknown escape in a fixture: ${match}`);
    }
  });
}

const fixtures = readFileSync(SUITE, 'utf8')
  .split('\n')
  .flatMap((line) => {
    const match = FIXTURE_LINE.exec(line);
    return match
      ? [
          {
            name: match[3] ?? '',
            input: unescapeSql(match[1] ?? ''),
            output: unescapeSql(match[2] ?? ''),
          },
        ]
      : [];
  });

describe('toPlainText against the SQL suite', () => {
  it('found the fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(21);
  });

  it.each(fixtures)('$name', ({ input, output }) => {
    expect(toPlainText(input)).toBe(output);
  });
});

describe('visibleLength', () => {
  it('counts the words, not the markers', () => {
    expect(visibleLength('**ab**')).toBe(2);
  });

  it('counts characters the way Postgres does, an emoji once', () => {
    expect(visibleLength('**a😀**')).toBe(2);
  });
});

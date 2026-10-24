import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { charLength } from '../normalize';
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

const SUITE_TEXT = readFileSync(SUITE, 'utf8');
const SUITE_LINES = SUITE_TEXT.split('\n');

/** How every fixture line starts, whether or not FIXTURE_LINE reads it. */
const FIXTURE_PREFIX = "select is(private.formatted_text_plain(E'";

/**
 * The suite's assertions that are not fixtures: null in, null out; the
 * stripper is immutable; authenticated cannot execute it; it stays fast on a
 * long run of markers.
 */
const CONTRACT_ASSERTIONS = 4;

const PLAN = Number(/^select plan\((\d+)\);$/m.exec(SUITE_TEXT)?.[1]);

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

const fixtures = SUITE_LINES.flatMap((line) => {
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
  it('read every fixture line, and the plan counts the fixtures and the contract', () => {
    const fixtureLines = SUITE_LINES.filter((line) =>
      line.startsWith(FIXTURE_PREFIX),
    );
    expect(fixtures.length).toBe(fixtureLines.length);
    expect(fixtures.length).toBe(PLAN - CONTRACT_ASSERTIONS);
  });

  it.each(fixtures)('$name', ({ input, output }) => {
    expect(toPlainText(input)).toBe(output);
  });

  // The stripper removes markers or swaps one for a bullet, never adds: a text
  // stored under the old limit of 2000 characters as typed is at most 2000
  // visible, so every row already stored stays valid under the visible limit.
  it('never makes a text longer', () => {
    for (const { name, input } of fixtures) {
      expect(charLength(toPlainText(input)), name).toBeLessThanOrEqual(
        charLength(input),
      );
    }
  });
});

describe('toPlainText on a long run of markers (#1109)', () => {
  // Every block step is anchored at a line start and the join only grows a
  // line by what follows it, so a whole text is one pass: under a millisecond
  // here, as in the database (pinned there too).
  it.each([
    ['quote markers', '>'.repeat(4000)],
    ['list markers', '- '.repeat(2000)],
    ['backslashes', '\\'.repeat(4000)],
    ['items opening on the next line', '-\n  '.repeat(1000)],
  ])('strips 4000 characters of %s in under 50 ms', (_, input) => {
    const start = performance.now();
    toPlainText(input);
    expect(performance.now() - start).toBeLessThan(50);
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

import type { Tokens } from 'marked';

/**
 * Two questions about the tokens of `lexFormattedText` that the reader
 * (`FormattedText`) and the editor (`editor/markdown.ts`) must answer the same
 * way, asked here once so the two cannot drift (ruling R60, ruling 26).
 */

/**
 * A Titlu or Subtitlu written with `#`, not underlined with `===` or `---`.
 * The `#` run must end the word, as the stripper's `#{1,6}[ \t]+` does:
 * `#voluntariat` underlined with `---` is an underlined heading, shown as typed.
 */
export function isDialectHeading(token: Tokens.Heading): boolean {
  return /^[ \t]*#{1,6}(?:[ \t]|\n|$)/.test(token.raw);
}

/**
 * A link in one of the dialect's two forms, with words: `[words](address)` or
 * a bare address typed with its `http(s)://`. A reference link, an
 * `<address>`, or a `www.` or e-mail address that `marked` also reads as a
 * link is not, and neither is one with no words. Its address must still pass
 * `safeHttpUrl` (through `textLinkTarget` in the reader) to be a Text Link.
 */
export function isWrittenTextLink(token: Tokens.Link): boolean {
  const written =
    (token.raw.startsWith('[') && token.raw.endsWith(')')) ||
    token.raw === token.href;
  return written && token.tokens.length > 0;
}

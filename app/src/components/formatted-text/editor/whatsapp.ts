/**
 * Text pasted from WhatsApp (or anywhere else that gives only plain text) as
 * Formatted Text (ruling R60, decision 14). WhatsApp's own markers, at word
 * boundaries, become the dialect's: `*x*` bold, `_x_` italic, `~x~` tăiat.
 * Every other marker of the dialect is escaped, so a paste never formats by
 * accident (`5*3*2`, `nume_prenume`, `a == b`); a list or a quote at the start
 * of a line stays one. An address is left exactly as it is, so the reader
 * links all of it.
 */

/**
 * A pair of one WhatsApp marker around words, on one line: not right after a
 * letter or digit, not right before one, and no space just inside either
 * marker. The words may hold the other two markers, converted in turn.
 */
const PAIR =
  /(?<![\p{L}\p{N}])([*_~])(?!\s)((?:(?!\1)[^\n])+?)(?<!\s)\1(?![\p{L}\p{N}])/gu;

/** The dialect's marker for each WhatsApp marker. */
const DIALECT: Record<string, string> = { '*': '**', _: '*', '~': '~~' };

/** What the dialect reads as a marker anywhere in a line. */
const MARKER = /[*_~=[\]`<\\]/g;

/**
 * An http(s) address as the reader's bare-address rule sees it: up to the
 * next space or `<`, without the punctuation that usually ends a sentence or
 * closes a marker.
 */
const ADDRESS = /https?:\/\/[^\s<]*[^\s<?!.,:;*_~'")\]]/giu;

/**
 * Where an address stood while the markers are converted: a letter first, as
 * the address starts with `h`, and its own last character last when that is a
 * letter or digit, so the word boundaries around it stay what they were.
 */
const STAND_IN = /h(\d+)./gu;

function standIn(address: string, index: number): string {
  const last = address.at(-1) ?? '/';
  return `h${index}${/[\p{L}\p{N}]/u.test(last) ? last : '/'}`;
}

function convert(text: string): string {
  let written = '';
  let from = 0;
  for (const match of text.matchAll(PAIR)) {
    const [whole, marker = '', words = ''] = match;
    const marks = DIALECT[marker] ?? '';
    written += text.slice(from, match.index).replace(MARKER, '\\$&');
    written += marks + convert(words) + marks;
    from = match.index + whole.length;
  }
  return written + text.slice(from).replace(MARKER, '\\$&');
}

export function whatsappToMarkdown(text: string): string {
  const addresses: string[] = [];
  const masked = text
    .replace(/\r\n/g, '\n')
    .replace(ADDRESS, (address) =>
      standIn(address, addresses.push(address) - 1),
    );
  return convert(masked).replace(
    STAND_IN,
    (_, index: string) => addresses[Number(index)] ?? '',
  );
}

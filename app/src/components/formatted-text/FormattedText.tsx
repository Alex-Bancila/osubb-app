import { Fragment, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { MarkedToken, Token, Tokens } from 'marked';
import {
  isDialectHeading,
  isWrittenTextLink,
} from '../../lib/formatted-text/dialect';
import { lexFormattedText } from '../../lib/formatted-text/lex';
import { textLinkTarget, type TextLinkTarget } from '../../lib/links';
import { cn } from '../../lib/utils';

type View = 'full' | 'preview';

/** `outline`: a Titlu is an `h3`, a Subtitlu an `h4`. `text`: a `p` with their look. */
type Headings = 'outline' | 'text';

type FormattedTextProps = {
  /** An Announcement's or Deal's body, or a Task's or an Event's description. */
  text: string;
  /**
   * `full`: every style, line breaks kept, for anything opened in full.
   * `preview`: for the three-line cards. Bold, italic, strikethrough and
   * highlight in one run, the blocks and list items joined by " · ", a line
   * break as a space, and links as their words, because the card is the tap
   * target. The page's own `line-clamp-*` shortens it.
   */
  view: View;
  /**
   * `outline` (the default): a Titlu is an `h3` and a Subtitlu an `h4`, as in a
   * sheet whose own title is the heading above. `text`: the same look in a `p`
   * with no heading role, for a card or a timeline entry that is not a sheet and
   * has headings of its own (ruling 22). Only `full` has headings to place.
   */
  headings?: Headings;
  className?: string;
};

/**
 * Formatted Text (ruling R60) as React elements: `marked`'s tokens
 * (`lexFormattedText`) mapped one by one, never through HTML, so nothing in
 * the text can become an element the dialect does not name. Whatever is
 * outside the dialect (raw HTML, images, tables, code, `---`, a heading
 * underlined with `===`, a reference link, a link `textLinkTarget` refuses)
 * shows as it was typed. The styles live in `theme/formatted-text.css`.
 */
export function FormattedText({
  text,
  view,
  headings = 'outline',
  className,
}: FormattedTextProps) {
  const content = useMemo(
    () => read(text, view, headings),
    [text, view, headings],
  );
  if (view === 'preview')
    return (
      <span className={cn('formatted-text-preview', className)}>{content}</span>
    );
  return <div className={cn('formatted-text', className)}>{content}</div>;
}

/**
 * `text` read in `view`, or, should reading it fail, the text as typed: one
 * `p` with its line breaks (one line in a preview). One Announcement or Task
 * must never take down the screen that lists it (ruling 16). In development the
 * error is logged, so a text that fails to read is not silently shown as typed.
 */
function read(text: string, view: View, headings: Headings): ReactNode {
  try {
    const tokens = lexFormattedText(text);
    return view === 'preview' ? joined(runs(tokens)) : blocks(tokens, headings);
  } catch (error) {
    if (import.meta.env.DEV) console.error('[formatted-text]', error);
    const typed = asTyped(text.replace(/\r\n/g, '\n'), view);
    return view === 'preview' ? typed : <p>{typed}</p>;
  }
}

/** Nothing to show: no node, or only the nothing a blank-worded link leaves. */
function isSilent(nodes: readonly ReactNode[]): boolean {
  return nodes.every((node) => node === null);
}

/** Text outside the dialect, as typed: its lines in `full`, one line in `preview`. */
function asTyped(raw: string, view: View): ReactNode {
  const lines = raw.replace(/\n+$/, '').split('\n');
  if (view === 'preview') return lines.join(' ');
  return lines.map((line, index) => (
    <Fragment key={index}>
      {index > 0 && <br />}
      {line}
    </Fragment>
  ));
}

/**
 * Where a link may go, or `null` to show it as typed. Only the dialect's two
 * forms are links: `[words](address)` and a bare address typed with its
 * `http(s)://`. A reference link, an `<address>`, or a `www.` or e-mail address
 * that `marked` also reads as a link is not, and neither is one with no words.
 */
function linkTarget(token: Tokens.Link): TextLinkTarget | null {
  return isWrittenTextLink(token) ? textLinkTarget(token.href) : null;
}

/**
 * A Text Link: inside the app through the router, outside it in a new tab cut
 * off from this page, which a screen reader is told as an Attached Link tells
 * it (`AttachedLinkButton`). A preview shows only its words.
 */
function linked(
  target: TextLinkTarget,
  words: ReactNode,
  view: View,
  key: number,
): ReactNode {
  if (view === 'preview') return <Fragment key={key}>{words}</Fragment>;
  if (target.kind === 'app')
    return (
      <Link key={key} to={target.path}>
        {words}
      </Link>
    );
  return (
    <a key={key} href={target.href} target="_blank" rel="noopener noreferrer">
      {words}
      <span className="sr-only"> (se deschide într-o filă nouă)</span>
    </a>
  );
}

function inline(tokens: readonly Token[], view: View): ReactNode[] {
  return tokens.map((token, key) => {
    if (token.type === 'highlight')
      return <mark key={key}>{inline(token.tokens ?? [], view)}</mark>;
    const span = token as MarkedToken;
    switch (span.type) {
      case 'text':
        return span.tokens ? (
          <Fragment key={key}>{inline(span.tokens, view)}</Fragment>
        ) : (
          span.text
        );
      case 'escape':
        return span.text;
      case 'br':
        return view === 'full' ? <br key={key} /> : ' ';
      case 'strong':
        return <strong key={key}>{inline(span.tokens, view)}</strong>;
      case 'em':
        return <em key={key}>{inline(span.tokens, view)}</em>;
      case 'del':
        return <s key={key}>{inline(span.tokens, view)}</s>;
      case 'link': {
        const target = linkTarget(span);
        if (target) {
          // Words of only spaces would be a link with no name to a screen
          // reader: no link, and nothing for the words.
          if (!span.text.trim()) return null;
          return linked(target, inline(span.tokens, view), view, key);
        }
        break;
      }
    }
    return <Fragment key={key}>{asTyped(token.raw, view)}</Fragment>;
  });
}

/**
 * A Titlu or a Subtitlu: an `h3` or an `h4`, or, where the page already has
 * headings of its own, a `p` that only looks like one (`.formatted-text-title`
 * and `.formatted-text-subtitle`).
 */
function heading(
  level: 'title' | 'subtitle',
  words: ReactNode[],
  headings: Headings,
  key: number,
): ReactNode {
  if (headings === 'text')
    return (
      <p key={key} className={`formatted-text-${level}`}>
        {words}
      </p>
    );
  return level === 'title' ? (
    <h3 key={key}>{words}</h3>
  ) : (
    <h4 key={key}>{words}</h4>
  );
}

/** The `full` view: one element per block. */
function blocks(tokens: readonly Token[], headings: Headings): ReactNode[] {
  return tokens.map((token, key) => {
    const block = token as MarkedToken;
    switch (block.type) {
      case 'space':
        return null;
      case 'paragraph': {
        const words = inline(block.tokens, 'full');
        return isSilent(words) ? null : <p key={key}>{words}</p>;
      }
      case 'heading':
        if (!isDialectHeading(block)) break;
        // A `#` with no words titles nothing.
        if (!block.text.trim()) return null;
        return heading(
          block.depth === 1 ? 'title' : 'subtitle',
          inline(block.tokens, 'full'),
          headings,
          key,
        );
      case 'blockquote':
        return (
          <blockquote key={key}>{blocks(block.tokens, headings)}</blockquote>
        );
      case 'list': {
        const items = block.items.map((item, index) => (
          <li key={index}>{blocks(item.tokens, headings)}</li>
        ));
        if (!block.ordered) return <ul key={key}>{items}</ul>;
        const start =
          typeof block.start === 'number' && block.start !== 1
            ? block.start
            : undefined;
        return (
          <ol key={key} start={start}>
            {items}
          </ol>
        );
      }
      // A tight list item's words, which sit in the `li` itself.
      case 'text':
        return (
          <Fragment key={key}>
            {inline(block.tokens ?? [block], 'full')}
          </Fragment>
        );
    }
    return <p key={key}>{asTyped(token.raw, 'full')}</p>;
  });
}

/** The `preview` view: each block and list item as one run of inline content. */
function runs(tokens: readonly Token[]): ReactNode[][] {
  return tokens.flatMap((token): ReactNode[][] => {
    const block = token as MarkedToken;
    switch (block.type) {
      case 'space':
        return [];
      case 'paragraph':
        return [inline(block.tokens, 'preview')];
      case 'heading':
        if (!isDialectHeading(block)) break;
        if (!block.text.trim()) return [];
        return [inline(block.tokens, 'preview')];
      case 'blockquote':
        return runs(block.tokens);
      case 'list':
        return block.items.flatMap((item) => runs(item.tokens));
      case 'text':
        return [inline(block.tokens ?? [block], 'preview')];
    }
    return [[asTyped(token.raw, 'preview')]];
  });
}

function joined(parts: ReactNode[][]): ReactNode[] {
  return parts
    .filter((part) => !isSilent(part))
    .map((part, index) => (
      <Fragment key={index}>
        {index > 0 && ' · '}
        {part}
      </Fragment>
    ));
}

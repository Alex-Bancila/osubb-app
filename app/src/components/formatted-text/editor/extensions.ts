import {
  commands,
  Extension,
  wrappingInputRule,
  type Content,
  type EditorOptions,
  type Extensions,
  type JSONContent,
} from '@tiptap/core';
import { Highlight } from '@tiptap/extension-highlight';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import { safeHttpUrl } from '../../../lib/links';
import { parseFormattedText, serializeFormattedText } from './markdown';
import { whatsappToMarkdown } from './whatsapp';

/**
 * The Formatted Text editor's Tiptap setup (ruling R60): only the extensions
 * of the dialect, and Markdown read and written as the reader and the
 * stripper read it (`markdown.ts`).
 */

/** What `content` is: Formatted Text, or Tiptap's own JSON or HTML. */
export type FormattedTextContentType = 'markdown' | 'json' | 'html';

declare module '@tiptap/core' {
  interface Editor {
    /** The document as Formatted Text (`serializeFormattedText`). */
    getMarkdown: () => string;
  }

  interface EditorOptions {
    /** `'markdown'`: a string `content` is Formatted Text. */
    contentType?: FormattedTextContentType;
  }

  interface SetContentOptions {
    /** `'markdown'`: a string `content` is Formatted Text. */
    contentType?: FormattedTextContentType;
  }

  interface InsertContentOptions {
    /** `'markdown'`: a string `value` is Formatted Text. */
    contentType?: FormattedTextContentType;
  }

  interface InsertContentAtOptions {
    /** `'markdown'`: a string `value` is Formatted Text. */
    contentType?: FormattedTextContentType;
  }
}

/** A Text Link goes only to an http(s) address (decision 7): `osubb.ro` stays text. */
function isTextLinkAddress(url: string): boolean {
  return safeHttpUrl(url) !== null;
}

function read<T>(content: T, contentType?: FormattedTextContentType) {
  return contentType === 'markdown' && typeof content === 'string'
    ? (parseFormattedText(content) as Content)
    : content;
}

/**
 * Formatted Text in and out of the editor (ruling 23): `editor.getMarkdown()`,
 * and `contentType: 'markdown'` on the editor's options and on `setContent`,
 * `insertContent` and `insertContentAt`.
 */
const FormattedTextMarkdown = Extension.create({
  name: 'formattedTextMarkdown',

  onBeforeCreate() {
    this.editor.getMarkdown = () =>
      serializeFormattedText(this.editor.getJSON());
    const { content, contentType } = this.editor.options;
    if (contentType === 'markdown' && typeof content === 'string')
      this.editor.options.content = parseFormattedText(content);
  },

  addCommands() {
    return {
      setContent: (content, options) =>
        commands.setContent(read(content, options?.contentType), options),
      insertContent: (value, options) =>
        commands.insertContent(read(value, options?.contentType), options),
      insertContentAt: (position, value, options) =>
        commands.insertContentAt(
          position,
          read(value, options?.contentType),
          options,
        ),
    };
  },
});

/**
 * `1. ` at the start of a line opens a numbered list, with one to three
 * digits only (ruling 25): a phone number typed `0740123456. ` stays words.
 */
const NumberedListShortcut = Extension.create({
  name: 'numberedListShortcut',

  addInputRules() {
    const type = this.editor.schema.nodes.orderedList;
    if (!type) return [];
    return [
      wrappingInputRule({
        find: /^(\d{1,3})\.\s$/,
        type,
        getAttributes: (match) => ({ start: Number(match[1]) }),
        // Joins a list just above that this number continues.
        joinPredicate: (match, node) =>
          (!node.attrs.type || node.attrs.type === '1') &&
          node.childCount + Number(node.attrs.start) === Number(match[1]),
      }),
    ];
  },
});

/**
 * The extensions of one editor; call it once per editor. Nothing here writes a
 * `style` attribute: no text style, colour, font or alignment, and Highlight in
 * one colour, a plain `<mark>`. No trailing paragraph is added after a list,
 * a quote or a title (ruling 24), so a text opened and left alone is written
 * back as it was.
 */
export function formattedTextExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2] },
      code: false,
      codeBlock: false,
      horizontalRule: false,
      underline: false,
      trailingNode: false,
      link: {
        autolink: true,
        linkOnPaste: true,
        openOnClick: false,
        isAllowedUri: isTextLinkAddress,
        shouldAutoLink: isTextLinkAddress,
      },
    }),
    Highlight.configure({ multicolor: false }),
    NumberedListShortcut,
    FormattedTextMarkdown,
  ];
}

/**
 * Pasted HTML as the dialect's schema reads it best: a third-to-sixth level
 * heading as a Subtitlu (the reader reads `###` and beyond as one), and a
 * table as its rows, one line each, its cells' text joined by " · ". Images,
 * fonts, colours and anything else outside the schema fall away when Tiptap
 * parses the rest.
 */
function transformPastedHTML(html: string): string {
  const page = new DOMParser().parseFromString(html, 'text/html');
  for (const heading of page.body.querySelectorAll('h3, h4, h5, h6')) {
    const subtitle = page.createElement('h2');
    subtitle.append(...heading.childNodes);
    heading.replaceWith(subtitle);
  }
  for (const table of page.body.querySelectorAll('table')) {
    const rows = [...table.querySelectorAll('tr')].map((row) => {
      const line = page.createElement('p');
      line.textContent = [...row.querySelectorAll('td, th')]
        .map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' · ');
      return line;
    });
    table.replaceWith(...rows);
  }
  return page.body.innerHTML;
}

/**
 * The document of `markdown`, with the spaces `text` had at its very start and
 * end kept, as a paste into the middle of a line needs them.
 */
function pastedContent(text: string, markdown: string): JSONContent[] {
  const content = parseFormattedText(markdown).content ?? [];
  const lead = /^[ \t]+/.exec(text)?.[0];
  const trail = /[ \t]+$/.exec(text)?.[0];
  const first = content[0];
  const last = content.at(-1);
  if (lead && first?.type === 'paragraph')
    first.content = [{ type: 'text', text: lead }, ...(first.content ?? [])];
  if (trail && last?.type === 'paragraph')
    last.content = [...(last.content ?? []), { type: 'text', text: trail }];
  return content;
}

/**
 * A paste of plain text only (WhatsApp, a notes app): its WhatsApp markers
 * become formatting and every other marker stays a word (decision 14). An
 * address pasted over selected words is left to Link, which links the words.
 * A paste that carries HTML goes through Tiptap's schema instead.
 */
function handlePaste(view: EditorView, event: ClipboardEvent): boolean {
  const data = event.clipboardData;
  if (!data) return false;
  const types = Array.from(data.types);
  if (types.includes('text/html') || !types.includes('text/plain'))
    return false;
  const text = data.getData('text/plain');
  if (!text) return false;
  const { state } = view;
  if (!state.selection.empty && isTextLinkAddress(text.trim())) return false;
  const content = pastedContent(text, whatsappToMarkdown(text));
  const slice = Slice.maxOpen(Fragment.fromJSON(state.schema, content));
  view.dispatch(state.tr.replaceSelection(slice).scrollIntoView());
  return true;
}

/**
 * The options every Formatted Text editor is created with. No injected style
 * sheet (the CSP forbids inline `<style>`; the few rules live in our
 * stylesheet). Of the typing shortcuts, only the line-start ones: `# `, `## `,
 * `- `, `1. ` (one to three digits), `> ` (decision 15); `**word**` typed
 * inside a line stays the symbols it is. Of the paste rules, only Link's: a
 * pasted address becomes a Text Link.
 */
export const EDITOR_OPTIONS = {
  injectCSS: false,
  enableInputRules: [
    'heading',
    'bulletList',
    'numberedListShortcut',
    'blockquote',
  ],
  enablePasteRules: ['link'],
  editorProps: { handlePaste, transformPastedHTML },
} satisfies Partial<EditorOptions>;

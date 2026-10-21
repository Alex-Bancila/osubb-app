import type { EditorOptions, Extensions, JSONContent } from '@tiptap/core';
import { Highlight } from '@tiptap/extension-highlight';
import { Markdown, MarkdownManager } from '@tiptap/markdown';
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

/** A Text Link goes only to an http(s) address (decision 7): `osubb.ro` stays text. */
function isTextLinkAddress(url: string): boolean {
  return safeHttpUrl(url) !== null;
}

/**
 * `@tiptap/markdown`'s manager with the dialect's reading and writing. Its
 * own would write `&amp;` for `&`, `  \n` for a line break and `&nbsp;` for an
 * empty paragraph, read raw HTML as formatting and a single line break as a
 * space, none of which the reader and the stripper read the same way.
 */
class FormattedTextMarkdownManager extends MarkdownManager {
  constructor() {
    super({ extensions: [] });
  }

  override parse(markdown: string): JSONContent {
    return parseFormattedText(markdown);
  }

  override serialize(doc: JSONContent): string {
    return serializeFormattedText(doc);
  }
}

/**
 * `Markdown` with the dialect's manager: `editor.getMarkdown()`,
 * `contentType: 'markdown'`, and `setContent` / `insertContent` with that
 * content type all read and write Formatted Text.
 */
const FormattedTextMarkdown = Markdown.extend({
  addStorage() {
    return { manager: new FormattedTextMarkdownManager() };
  },

  onBeforeCreate() {
    const { manager } = this.storage;
    this.editor.markdown = manager;
    this.editor.getMarkdown = () => manager.serialize(this.editor.getJSON());
    const { content, contentType } = this.editor.options;
    if (contentType === 'markdown' && typeof content === 'string')
      this.editor.options.content = manager.parse(content);
  },
});

/**
 * The extensions of one editor; call it once per editor. Nothing here writes a
 * `style` attribute: no text style, colour, font or alignment, and Highlight in
 * one colour, a plain `<mark>`.
 */
export function formattedTextExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2] },
      code: false,
      codeBlock: false,
      horizontalRule: false,
      underline: false,
      link: {
        autolink: true,
        linkOnPaste: true,
        openOnClick: false,
        isAllowedUri: isTextLinkAddress,
        shouldAutoLink: isTextLinkAddress,
      },
    }),
    Highlight.configure({ multicolor: false }),
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
 * `- `, `1. `, `> ` (decision 15); `**word**` typed inside a line stays the
 * symbols it is. Of the paste rules, only Link's: a pasted address becomes a
 * Text Link.
 */
export const EDITOR_OPTIONS = {
  injectCSS: false,
  enableInputRules: ['heading', 'bulletList', 'orderedList', 'blockquote'],
  enablePasteRules: ['link'],
  editorProps: { handlePaste, transformPastedHTML },
} satisfies Partial<EditorOptions>;

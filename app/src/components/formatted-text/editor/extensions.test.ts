import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { lexFormattedText } from '../../../lib/formatted-text/lex';
import { toPlainText } from '../../../lib/formatted-text/plain';
import { EDITOR_OPTIONS, formattedTextExtensions } from './extensions';

const SAMPLE =
  'Ne vedem **joi**.\n\n## Ordinea de zi\n\n- unu\n- doi\n\n> citat\n\n==nou== ~~vechi~~ [formular](https://forms.gle/x)';

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function editorWith(markdown: string): Editor {
  const editor = new Editor({
    ...EDITOR_OPTIONS,
    element: document.createElement('div'),
    extensions: formattedTextExtensions(),
    content: markdown,
    contentType: 'markdown',
  });
  editors.push(editor);
  return editor;
}

/** `text` typed as a keyboard types it: one character at a time, through the input rules. */
function type(editor: Editor, text: string) {
  const { view } = editor;
  for (const character of text) {
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(character, from, to);
    const handled = view.someProp('handleTextInput', (handle) =>
      handle(view, from, to, character, insert),
    );
    if (!handled) view.dispatch(insert());
  }
}

function press(editor: Editor, key: string, init: KeyboardEventInit = {}) {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
}

/** A paste event carrying `data`, as a browser's clipboard gives it. */
function paste(editor: Editor, data: Record<string, string>) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      types: Object.keys(data),
      getData: (format: string) => data[format] ?? '',
    },
  });
  editor.view.dom.dispatchEvent(event);
}

/** Every text node of `json` with the mark types on it. */
function texts(json: JSONContent): [string, string[]][] {
  if (json.type === 'text')
    return [[json.text ?? '', (json.marks ?? []).map((mark) => mark.type)]];
  return (json.content ?? []).flatMap(texts);
}

describe('the editor’s configuration (ruling R60, decision 15)', () => {
  it('holds only the dialect’s nodes and marks, and injects no style sheet', () => {
    const editor = editorWith('');
    expect(Object.keys(editor.schema.nodes).sort()).toEqual(
      [
        'blockquote',
        'bulletList',
        'doc',
        'hardBreak',
        'heading',
        'listItem',
        'orderedList',
        'paragraph',
        'text',
      ].sort(),
    );
    expect(Object.keys(editor.schema.marks).sort()).toEqual(
      ['bold', 'highlight', 'italic', 'link', 'strike'].sort(),
    );
    expect(document.querySelector('style[data-tiptap-style]')).toBeNull();
  });

  it('opens the spec’s sample as it reads, and writes it back byte for byte', () => {
    const editor = editorWith(SAMPLE);
    expect(editor.getMarkdown()).toBe(SAMPLE);
    expect(editorWith(editor.getMarkdown()).getJSON()).toEqual(
      editor.getJSON(),
    );
    // The reader and the stripper read what the editor wrote as it showed it.
    expect(
      lexFormattedText(editor.getMarkdown())
        .map((token) => token.type)
        .filter((kind) => kind !== 'space'),
    ).toEqual(['paragraph', 'heading', 'list', 'blockquote', 'paragraph']);
    expect(toPlainText(editor.getMarkdown())).toBe(
      'Ne vedem joi.\n\nOrdinea de zi\n\n• unu\n• doi\n\ncitat\n\nnou vechi formular',
    );
  });

  it('keeps the line breaks of a text written before the editor', () => {
    const editor = editorWith('Rândul 1\nRândul 2');
    expect(
      editor.getJSON().content?.[0]?.content?.map((node) => node.type),
    ).toEqual(['text', 'hardBreak', 'text']);
    expect(editor.getMarkdown()).toBe('Rândul 1\nRândul 2');
  });

  it.each([
    ['bold', '**ab**', '**a**\n**b**'],
    ['italic', '*ab*', '*a*\n*b*'],
    ['strikethrough', '~~ab~~', '~~a~~\n~~b~~'],
    ['highlight', '==ab==', '==a==\n==b=='],
  ])(
    'closes %s before Shift+Enter and opens it again after',
    (_, before, after) => {
      const editor = editorWith(before);
      editor.commands.setTextSelection(2);
      press(editor, 'Enter', { shiftKey: true });
      expect(editor.getMarkdown()).toBe(after);
      expect(toPlainText(after)).toBe('a\nb');
    },
  );

  it.each(['**a**', '*a*', '_a_', '~~a~~', '~a~', '==a=='])(
    'leaves %s typed inside a line as the symbols it is',
    (symbols) => {
      const editor = editorWith('');
      type(editor, symbols);
      expect(texts(editor.getJSON())).toEqual([[symbols, []]]);
      expect(toPlainText(editor.getMarkdown())).toBe(symbols);
    },
  );

  it('leaves **a** inserted as text with the input rules as literal stars', async () => {
    const editor = editorWith('');
    editor.commands.insertContent('**a**', { applyInputRules: true });
    await new Promise((resolve) => setTimeout(resolve));
    expect(texts(editor.getJSON())).toEqual([['**a**', []]]);
    expect(editor.getMarkdown()).toBe('\\*\\*a\\*\\*');
  });

  it.each([
    ['- ', 'bulletList', '- unu'],
    ['1. ', 'orderedList', '1. unu'],
    ['# ', 'heading', '# unu'],
    ['## ', 'heading', '## unu'],
    ['> ', 'blockquote', '> unu'],
  ])(
    'turns %s at the start of a line into its block',
    (start, node, markdown) => {
      const editor = editorWith('');
      type(editor, start);
      expect(editor.getJSON().content?.[0]?.type).toBe(node);
      type(editor, 'unu');
      expect(editor.getMarkdown()).toBe(markdown);
    },
  );

  it('reads Markdown inserted as Markdown in the dialect', () => {
    const editor = editorWith('');
    editor.commands.insertContent('5*3*2 și **gras**', {
      contentType: 'markdown',
    });
    expect(texts(editor.getJSON())).toEqual([
      ['5*3*2 și ', []],
      ['gras', ['bold']],
    ]);
  });
});

describe('Text Links (decisions 6 and 7)', () => {
  it('links a typed http(s) address, and leaves osubb.ro as text', () => {
    const editor = editorWith('');
    type(editor, 'vezi https://osubb.ro/x și osubb.ro ');
    expect(editor.getMarkdown()).toBe('vezi https://osubb.ro/x și osubb.ro');
    expect(texts(editor.getJSON())).toEqual([
      ['vezi ', []],
      ['https://osubb.ro/x', ['link']],
      [' și osubb.ro ', []],
    ]);
  });

  it('refuses a link to anything but an http(s) address', () => {
    const editor = editorWith('formular');
    editor.commands.setTextSelection({ from: 1, to: 9 });
    expect(editor.commands.setLink({ href: 'osubb.ro' })).toBe(false);
    expect(editor.commands.setLink({ href: 'javascript:alert(1)' })).toBe(
      false,
    );
    expect(editor.commands.setLink({ href: 'https://osubb.ro' })).toBe(true);
    expect(editor.getMarkdown()).toBe('[formular](https://osubb.ro)');
  });

  it('links the selected words to an address pasted over them', () => {
    const editor = editorWith('formular');
    editor.commands.setTextSelection({ from: 1, to: 9 });
    paste(editor, { 'text/plain': 'https://forms.gle/x' });
    expect(editor.getMarkdown()).toBe('[formular](https://forms.gle/x)');
  });

  it('pastes a lone address as a Text Link, and osubb.ro as text', () => {
    const editor = editorWith('');
    paste(editor, { 'text/plain': 'https://forms.gle/x' });
    expect(texts(editor.getJSON())).toEqual([
      ['https://forms.gle/x', ['link']],
    ]);
    editor.commands.setContent('');
    paste(editor, { 'text/plain': 'osubb.ro' });
    expect(texts(editor.getJSON())).toEqual([['osubb.ro', []]]);
  });
});

describe('pasting (decision 14)', () => {
  it('keeps what the dialect holds from a web page, and drops the rest', () => {
    const editor = editorWith('');
    paste(editor, {
      'text/html':
        '<h3>x</h3><table><tr><td>c</td></tr></table><img src=y><span style="color:red">s</span><a href="javascript:x">j</a><ul><li>a<ul><li>b</li></ul></li></ul>',
      'text/plain': 'x c s j a b',
    });
    expect(editor.getMarkdown()).toBe('## x\n\nc\n\nsj\n\n- a\n  - b');
    expect(texts(editor.getJSON())).toEqual([
      ['x', []],
      ['c', []],
      ['sj', []],
      ['a', []],
      ['b', []],
    ]);
    expect(editor.view.dom.querySelector('[style], img, table, a')).toBeNull();
  });

  it('keeps a table’s cells apart, a row to a line', () => {
    const editor = editorWith('');
    paste(editor, {
      'text/html':
        '<table><tr><th>Zi</th><th>Oră</th></tr><tr><td>Luni</td><td><b>10:00</b></td></tr></table>',
    });
    expect(editor.getMarkdown()).toBe('Zi · Oră\n\nLuni · 10:00');
  });

  it('keeps Google Docs’ bold, italic and titles', () => {
    const editor = editorWith('');
    paste(editor, {
      'text/html':
        '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><h1><span style="font-size:20pt">Titlu</span></h1><p><span style="font-weight:700">Gras</span> <span style="font-style:italic">cursiv</span> <span style="text-decoration:line-through">tăiat</span></p><h4>Mic</h4></b>',
    });
    expect(editor.getMarkdown()).toBe(
      '# Titlu\n\n**Gras** *cursiv* ~~tăiat~~\n\n## Mic',
    );
    expect(editor.view.dom.querySelector('[style]')).toBeNull();
  });

  it('turns WhatsApp’s markers in plain text into formatting', () => {
    const editor = editorWith('');
    paste(editor, { 'text/plain': '*Ședința* e _joi_ ~nu~ la 5*3*2' });
    expect(editor.getMarkdown()).toBe(
      '**Ședința** e *joi* ~~nu~~ la 5\\*3\\*2',
    );
  });

  it('pastes plain text into the line the cursor is on, spaces and all', () => {
    const editor = editorWith('Ne vedem.');
    editor.commands.setTextSelection(9);
    paste(editor, { 'text/plain': ' *joi*' });
    expect(editor.getMarkdown()).toBe('Ne vedem **joi**.');
  });

  it('pastes several lines as lines, and blank lines as paragraphs', () => {
    const editor = editorWith('');
    paste(editor, { 'text/plain': 'Ordinea:\n- unu\n- doi\n\nAtât' });
    expect(editor.getMarkdown()).toBe('Ordinea:\n\n- unu\n- doi\n\nAtât');
  });

  it('leaves WhatsApp markers alone in a paste that also carries HTML', () => {
    const editor = editorWith('');
    paste(editor, { 'text/html': '<p>*a*</p>', 'text/plain': '*a*' });
    expect(editor.getMarkdown()).toBe('\\*a\\*');
  });
});

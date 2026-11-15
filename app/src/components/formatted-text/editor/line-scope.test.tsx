import { Editor } from '@tiptap/core';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { EDITOR_OPTIONS, formattedTextExtensions } from './extensions';
import { FormattedTextToolbar } from './FormattedTextToolbar';

/**
 * A block style or a list applies to the lines the selection touches, never to
 * the other lines of their paragraph. A paragraph's lines are the ones a
 * paste from WhatsApp or a notes app gives, or Shift+Enter: text a Member
 * reads as separate lines, which the dialect keeps as one paragraph with
 * hard breaks. A Titlu chosen on one of them once made every line one title.
 */

const LINES = 'Unu\nDoi\nTrei';

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) {
    const element = editor.view.dom.parentElement;
    editor.destroy();
    element?.remove();
  }
});

function editorWith(markdown: string): Editor {
  const element = document.createElement('div');
  document.body.append(element);
  const editor = new Editor({
    ...EDITOR_OPTIONS,
    element,
    extensions: formattedTextExtensions(),
    content: markdown,
    contentType: 'markdown',
  });
  editors.push(editor);
  return editor;
}

/** The document position where `words` start (its first occurrence). */
function positionOf(editor: Editor, words: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1 || !node.isText) return found === -1;
    const at = node.text?.indexOf(words) ?? -1;
    if (at !== -1) found = pos + at;
    return false;
  });
  if (found === -1) throw new Error(`no "${words}" in the text`);
  return found;
}

/** Selects from the start of `first` to the end of `last` (or of `first`). */
function select(editor: Editor, first: string, last = first) {
  editor.commands.setTextSelection({
    from: positionOf(editor, first),
    to: positionOf(editor, last) + last.length,
  });
}

/** `text` typed as a keyboard types it: through the input rules. */
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

/**
 * `keys` pressed as a keyboard presses them, `Mod` as Ctrl (not on a Mac).
 * Not Tiptap's `keyboardShortcut` command: it replays a change of several
 * steps each moved again by the ones before it.
 */
function press(editor: Editor, keys: string) {
  const parts = keys.split('-');
  const event = new KeyboardEvent('keydown', {
    key: parts.at(-1),
    ctrlKey: parts.includes('Mod'),
    altKey: parts.includes('Alt'),
    shiftKey: parts.includes('Shift'),
    bubbles: true,
    cancelable: true,
  });
  editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, event));
}

async function chooseStyle(editor: Editor, style: string) {
  const user = userEvent.setup();
  render(<FormattedTextToolbar editor={editor} />);
  await user.click(screen.getByRole('button', { name: /^Stil/ }));
  await user.click(await screen.findByRole('menuitemradio', { name: style }));
}

describe('a block style applies to the lines it touches, not their whole paragraph', () => {
  it('loads pasted lines as one paragraph, the case this guards', () => {
    const editor = editorWith(LINES);
    expect(editor.getJSON().content).toHaveLength(1);
    expect(editor.getMarkdown()).toBe(LINES);
  });

  it.each([
    ['Titlu', 'Unu\n\n# Doi\n\nTrei'],
    ['Subtitlu', 'Unu\n\n## Doi\n\nTrei'],
    ['Citat', 'Unu\n\n> Doi\n\nTrei'],
  ])(
    'Stil › %s on one selected line styles that line only',
    async (style, expected) => {
      const editor = editorWith(LINES);
      select(editor, 'Doi');
      await chooseStyle(editor, style);
      expect(editor.getMarkdown()).toBe(expected);
    },
  );

  it('Stil › Titlu with only the caret on a line makes that line the title', async () => {
    const editor = editorWith(LINES);
    editor.commands.setTextSelection(positionOf(editor, 'Doi') + 1);
    await chooseStyle(editor, 'Titlu');
    expect(editor.getMarkdown()).toBe('Unu\n\n# Doi\n\nTrei');
  });

  it('Stil › Titlu across two lines makes each of them a title, the others untouched', async () => {
    const editor = editorWith('Unu\nDoi\nTrei\nPatru');
    select(editor, 'oi', 'Tr');
    await chooseStyle(editor, 'Titlu');
    expect(editor.getMarkdown()).toBe('Unu\n\n# Doi\n\n# Trei\n\nPatru');
  });

  it('Stil › Citat across two lines quotes them together, as the lines they were', async () => {
    const editor = editorWith('Unu\nDoi\nTrei\nPatru');
    select(editor, 'Doi', 'Trei');
    await chooseStyle(editor, 'Citat');
    expect(editor.getMarkdown()).toBe('Unu\n\n> Doi\n> Trei\n\nPatru');
  });

  it.each([
    ['Listă', 'Unu\n\n- Doi\n- Trei'],
    ['Listă numerotată', 'Unu\n\n1. Doi\n2. Trei'],
  ])(
    '%s on two selected lines makes one item of each',
    async (label, expected) => {
      const user = userEvent.setup();
      const editor = editorWith(LINES);
      render(<FormattedTextToolbar editor={editor} />);
      select(editor, 'Doi', 'Trei');
      await user.click(screen.getByRole('button', { name: label }));
      expect(editor.getMarkdown()).toBe(expected);
    },
  );

  it.each([
    ['Mod-Alt-1', 'Unu\n\n# Doi\n\nTrei'],
    ['Mod-Alt-2', 'Unu\n\n## Doi\n\nTrei'],
    ['Mod-Shift-b', 'Unu\n\n> Doi\n\nTrei'],
    ['Mod-Shift-8', 'Unu\n\n- Doi\n\nTrei'],
    ['Mod-Shift-7', 'Unu\n\n1. Doi\n\nTrei'],
  ])('the shortcut %s styles the selected line only', (keys, expected) => {
    const editor = editorWith(LINES);
    select(editor, 'Doi');
    press(editor, keys);
    expect(editor.getMarkdown()).toBe(expected);
  });

  it.each([
    ['# ', '# Unu\n\nDoi\nTrei'],
    ['## ', '## Unu\n\nDoi\nTrei'],
    ['> ', '> Unu\n\nDoi\nTrei'],
    ['- ', '- Unu\n\nDoi\nTrei'],
    ['1. ', '1. Unu\n\nDoi\nTrei'],
  ])(
    '%s typed at the start of the first line styles that line only',
    (start, expected) => {
      const editor = editorWith(LINES);
      editor.commands.setTextSelection(1);
      type(editor, start);
      expect(editor.getMarkdown()).toBe(expected);
    },
  );

  it.each([
    ['Titlu', '> Unu\n\n# Doi\n\n> Trei'],
    ['Text', '> Unu\n\nDoi\n\n> Trei'],
    ['Citat', '> Unu\n> Doi\n> Trei'],
  ])(
    'Stil › %s on one line of a quote moves that line only',
    async (style, expected) => {
      const editor = editorWith('> Unu\n> Doi\n> Trei');
      select(editor, 'Doi');
      await chooseStyle(editor, style);
      expect(editor.getMarkdown()).toBe(expected);
    },
  );

  it('Stil › Citat on a title in a quote makes it quoted text', async () => {
    const editor = editorWith('> # Unu\n>\n> Doi');
    select(editor, 'Unu');
    await chooseStyle(editor, 'Citat');
    expect(editor.getMarkdown()).toBe('> Unu\n>\n> Doi');
  });

  it.each([
    ['> Unu\n> Doi\n> Trei', 'Mod-Alt-0', '> Unu\n\nDoi\n\n> Trei'],
    ['> Unu\n> Doi\n> Trei', 'Mod-Shift-b', '> Unu\n\nDoi\n\n> Trei'],
    [LINES, 'Mod-Alt-0', LINES],
  ])(
    'in %j the shortcut %s changes the selected line only',
    (markdown, keys, expected) => {
      const editor = editorWith(markdown);
      select(editor, 'Doi');
      press(editor, keys);
      expect(editor.getMarkdown()).toBe(expected);
    },
  );

  it('Stil › Text on lines already text leaves them one paragraph', async () => {
    const editor = editorWith(LINES);
    select(editor, 'Doi');
    await chooseStyle(editor, 'Text');
    expect(editor.getJSON().content).toHaveLength(1);
    expect(editor.getMarkdown()).toBe(LINES);
  });

  it('Stil › Titlu on the first line of a list item takes that line out of the list', async () => {
    const editor = editorWith('- Unu\n  Doi\n  Trei');
    select(editor, 'Unu');
    await chooseStyle(editor, 'Titlu');
    expect(editor.getMarkdown()).toBe('# Unu\n\n- Doi\n  Trei');
  });

  it('one undo puts the lines back as they were', async () => {
    const editor = editorWith(LINES);
    select(editor, 'Doi');
    await chooseStyle(editor, 'Titlu');
    editor.commands.undo();
    expect(editor.getJSON().content).toHaveLength(1);
    expect(editor.getMarkdown()).toBe(LINES);
  });

  it('still styles a whole paragraph of one line, as before', async () => {
    const editor = editorWith('Unu\n\nDoi');
    select(editor, 'Doi');
    await chooseStyle(editor, 'Titlu');
    expect(editor.getMarkdown()).toBe('Unu\n\n# Doi');
  });

  it('turning a list off keeps an item of two lines one paragraph', async () => {
    const user = userEvent.setup();
    const editor = editorWith('- Unu\n  Doi');
    render(<FormattedTextToolbar editor={editor} />);
    editor.commands.setTextSelection(positionOf(editor, 'Doi') + 1);
    await user.click(screen.getByRole('button', { name: 'Listă' }));
    expect(editor.getMarkdown()).toBe('Unu\nDoi');
  });
});

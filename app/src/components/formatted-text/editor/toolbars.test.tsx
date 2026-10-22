import { Editor } from '@tiptap/core';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { EDITOR_OPTIONS, formattedTextExtensions } from './extensions';
import {
  FormattedTextKeyboardBar,
  type KeyboardBarMode,
} from './FormattedTextKeyboardBar';
import { FormattedTextToolbar } from './FormattedTextToolbar';

const ADDRESS_ERROR = 'Adresa trebuie să înceapă cu http:// sau https://.';

const editors: Editor[] = [];

// A focused editor scrolls its selection into view, measuring a text range;
// jsdom lays nothing out and has no range geometry, so it measures nothing.
const rangeGeometry = ['getClientRects', 'getBoundingClientRect'] as const;
beforeAll(() => {
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: {
      configurable: true,
      value: () => DOMRect.fromRect(),
    },
  });
});
afterAll(() => {
  for (const name of rangeGeometry)
    Reflect.deleteProperty(Range.prototype, name);
});

afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) {
    const element = editor.view.dom.parentElement;
    editor.destroy();
    element?.remove();
  }
  document.documentElement.style.removeProperty('--format-bar-h');
});

/** An editor on the page (so it can take focus) holding `markdown`. */
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

/** Selects every word of a one-paragraph text. */
function selectWords(editor: Editor) {
  editor.commands.setTextSelection({
    from: 1,
    to: editor.state.doc.content.size - 1,
  });
}

function focusText(editor: Editor) {
  act(() => editor.view.dom.focus());
}

describe('the top toolbar, for a mouse (R60, decision 4)', () => {
  it.each([
    ['Aldin', '**x**'],
    ['Cursiv', '*x*'],
    ['Tăiat', '~~x~~'],
    ['Evidențiază', '==x=='],
    ['Listă', '- x'],
    ['Listă numerotată', '1. x'],
  ])('%s writes %s, and shows itself pressed', async (label, markdown) => {
    const user = userEvent.setup();
    const editor = editorWith('x');
    render(<FormattedTextToolbar editor={editor} />);
    selectWords(editor);
    const button = screen.getByRole('button', { name: label });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await user.click(button);

    expect(editor.getMarkdown()).toBe(markdown);
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    ['Titlu', 'x', '# x'],
    ['Subtitlu', 'x', '## x'],
    ['Citat', 'x', '> x'],
    ['Text', '# x', 'x'],
    ['Text', '> x', 'x'],
    ['Titlu', '> x', '# x'],
  ])('Stil › %s turns %j into %j', async (style, markdown, expected) => {
    const user = userEvent.setup();
    const editor = editorWith(markdown);
    render(<FormattedTextToolbar editor={editor} />);
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);

    await user.click(screen.getByRole('button', { name: /^Stil/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: style }));

    expect(editor.getMarkdown()).toBe(expected);
    expect(screen.getByRole('button', { name: /^Stil/ })).toHaveTextContent(
      style,
    );
  });

  it('Fără formatare takes every mark off the selection', async () => {
    const user = userEvent.setup();
    const editor = editorWith('**x** ==y==');
    render(<FormattedTextToolbar editor={editor} />);
    selectWords(editor);

    await user.click(screen.getByRole('button', { name: 'Fără formatare' }));

    expect(editor.getMarkdown()).toBe('x y');
  });

  it('is one toolbar in the order of decision 4, moved through with the arrow keys', async () => {
    const user = userEvent.setup();
    const editor = editorWith('x');
    render(<FormattedTextToolbar editor={editor} />);
    const toolbar = screen.getByRole('toolbar');
    const buttons = within(toolbar).getAllByRole('button');

    expect(
      buttons.map((button) => button.getAttribute('aria-label') ?? 'Stil'),
    ).toEqual([
      'Stil',
      'Aldin',
      'Cursiv',
      'Tăiat',
      'Listă',
      'Listă numerotată',
      'Link',
      'Evidențiază',
      'Fără formatare',
    ]);
    // One stop for Tab; the arrows move inside.
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    act(() => buttons[0]?.focus());
    await user.keyboard('{ArrowRight}');
    expect(buttons[1]).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(buttons.at(-1)).toHaveFocus();
  });

  it('sticks to the top of the field, with 44 px controls and their shortcuts named', () => {
    const editor = editorWith('x');
    render(<FormattedTextToolbar editor={editor} />);
    const toolbar = screen.getByRole('toolbar');

    expect(toolbar).toHaveClass('sticky', 'top-0');
    // 44 px tall, and 44 px wide or wider (min-w-11 = 2.75rem).
    for (const button of within(toolbar).getAllByRole('button')) {
      expect(button).toHaveClass('min-h-11');
      const width = /\bmin-w-(\d+)\b/.exec(button.className)?.[1];
      expect(Number(width)).toBeGreaterThanOrEqual(11);
    }
    expect(screen.getByRole('button', { name: 'Aldin' })).toHaveAttribute(
      'title',
      'Aldin (Ctrl+B)',
    );
    expect(screen.getByRole('button', { name: 'Link' })).toHaveAttribute(
      'title',
      'Link (Ctrl+K)',
    );
  });

  it('keeps the focus in the text when a mark is clicked', () => {
    const editor = editorWith('x');
    render(<FormattedTextToolbar editor={editor} />);

    expect(
      fireEvent.mouseDown(screen.getByRole('button', { name: 'Aldin' })),
    ).toBe(false);
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
  ])('opens the link dialog on %s+K', async (_name, modifier) => {
    const editor = editorWith('x');
    render(<FormattedTextToolbar editor={editor} />);
    selectWords(editor);

    fireEvent.keyDown(editor.view.dom, { key: 'k', ...modifier });

    expect(
      await screen.findByRole('dialog', { name: 'Adaugă link' }),
    ).toBeInTheDocument();
  });
});

describe('the link dialog (R60, decisions 6 and 7)', () => {
  async function openLinkDialog(editor: Editor) {
    const user = userEvent.setup();
    render(<FormattedTextToolbar editor={editor} />);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    const dialog = await screen.findByRole('dialog');
    return { user, dialog };
  }

  it('refuses an address without http(s), and links the selected words to one with it', async () => {
    const editor = editorWith('x');
    selectWords(editor);
    const { user, dialog } = await openLinkDialog(editor);
    expect(dialog).toHaveAccessibleName('Adaugă link');
    // Words are selected: they are the link's words, so no Text field.
    expect(within(dialog).queryByLabelText(/^Text/)).toBeNull();
    const address = within(dialog).getByLabelText('Adresa');

    await user.type(address, 'osubb.ro');
    await user.click(within(dialog).getByRole('button', { name: 'Adaugă' }));

    expect(await within(dialog).findByText(ADDRESS_ERROR)).toBeInTheDocument();
    expect(address).toHaveAttribute('aria-invalid', 'true');
    expect(editor.getMarkdown()).toBe('x');

    await user.clear(address);
    await user.type(address, 'https://osubb.ro');
    await user.click(within(dialog).getByRole('button', { name: 'Adaugă' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(editor.getMarkdown()).toBe('[x](https://osubb.ro)');
  });

  it('asks for the words too when nothing is selected', async () => {
    const editor = editorWith('');
    const { user, dialog } = await openLinkDialog(editor);

    // An optional field says so (DESIGN.md; ruling 29).
    await user.type(
      within(dialog).getByLabelText('Text (opțional)'),
      'formular',
    );
    await user.type(
      within(dialog).getByLabelText('Adresa'),
      'https://forms.gle/x',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Adaugă' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(editor.getMarkdown()).toBe('[formular](https://forms.gle/x)');
  });

  it('changes the address of a link the caret is in, with Salvează', async () => {
    const editor = editorWith('vezi [site](https://osubb.ro)');
    editor.commands.setTextSelection(8);
    const { user, dialog } = await openLinkDialog(editor);
    expect(dialog).toHaveAccessibleName('Modifică linkul');
    // Ruling 28: an existing link is saved, not added.
    expect(within(dialog).queryByRole('button', { name: 'Adaugă' })).toBeNull();
    const address = within(dialog).getByLabelText('Adresa');
    expect(address).toHaveValue('https://osubb.ro');

    await user.clear(address);
    await user.type(address, 'https://ubbcluj.ro');
    await user.click(within(dialog).getByRole('button', { name: 'Salvează' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(editor.getMarkdown()).toBe('vezi [site](https://ubbcluj.ro)');
  });

  it('removes a link with Elimină linkul, last in the footer, keeping its words', async () => {
    const editor = editorWith('vezi [site](https://osubb.ro)');
    editor.commands.setTextSelection(8);
    const { user, dialog } = await openLinkDialog(editor);
    // Ruling 30: the destructive action comes last, at every width (the
    // footer stacks in reverse under `sm`, so it is ordered first there),
    // and is never filled.
    const footer = dialog.querySelector('[data-slot="dialog-footer"]');
    const buttons = within(footer as HTMLElement).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Renunță',
      'Salvează',
      'Elimină linkul',
    ]);
    const remove = within(dialog).getByRole('button', {
      name: 'Elimină linkul',
    });
    expect(remove).toHaveClass('max-sm:order-first', 'text-destructive');
    expect(remove).not.toHaveClass('bg-primary', 'sm:mr-auto');

    await user.click(remove);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(editor.getMarkdown()).toBe('vezi site');
  });

  it('offers no Elimină linkul nor Salvează for a new link', async () => {
    const editor = editorWith('x');
    selectWords(editor);
    const { dialog } = await openLinkDialog(editor);

    expect(
      within(dialog).queryByRole('button', { name: 'Elimină linkul' }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole('button', { name: 'Salvează' }),
    ).toBeNull();
    expect(
      within(dialog).getByRole('button', { name: 'Renunță' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Adaugă' }),
    ).toBeInTheDocument();
  });

  it('does not submit the form the field sits in', async () => {
    const user = userEvent.setup();
    const submitted = vi.fn((event: React.FormEvent) => event.preventDefault());
    const editor = editorWith('x');
    selectWords(editor);
    render(
      <form onSubmit={submitted}>
        <FormattedTextToolbar editor={editor} />
      </form>,
    );
    await user.click(screen.getByRole('button', { name: 'Link' }));
    const dialog = await screen.findByRole('dialog');

    await user.type(
      within(dialog).getByLabelText('Adresa'),
      'https://osubb.ro{Enter}',
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(editor.getMarkdown()).toBe('[x](https://osubb.ro)');
    expect(submitted).not.toHaveBeenCalled();
  });
});

describe('the keyboard bar, for touch (R60, decision 1)', () => {
  /** The bar as the field drives it: `mode` is the field's state. */
  function Field({ editor }: { editor: Editor }) {
    const [mode, setMode] = useState<KeyboardBarMode>('hidden');
    return (
      <>
        <output data-testid="mode">{mode}</output>
        <input aria-label="Alt câmp" />
        <FormattedTextKeyboardBar
          editor={editor}
          mode={mode}
          onModeChange={setMode}
        />
      </>
    );
  }

  function shownMode() {
    return screen.getByTestId('mode').textContent;
  }

  function bar() {
    return screen.getByRole('toolbar', { name: 'Formatare' });
  }

  it('shows only while the text has focus, above the keyboard', async () => {
    const user = userEvent.setup();
    const editor = editorWith('x');
    render(<Field editor={editor} />);
    expect(screen.queryByRole('toolbar')).toBeNull();

    focusText(editor);

    expect(shownMode()).toBe('keyboard');
    expect(
      within(bar())
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Stiluri',
      'Aldin',
      'Cursiv',
      'Listă',
      'Link',
      'Ascunde tastatura',
    ]);
    const surface = document.querySelector(
      '[data-slot="formatted-text-keyboard-bar"]',
    );
    expect(surface).toHaveClass(
      'fixed',
      'inset-x-0',
      'bottom-(--keyboard-inset)',
      'z-80',
    );
    for (const button of within(bar()).getAllByRole('button'))
      expect(button).toHaveClass('min-h-11', 'min-w-11');

    await user.click(screen.getByLabelText('Alt câmp'));
    expect(shownMode()).toBe('hidden');
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('keeps the focus and the keyboard when a bar button is pressed', async () => {
    const user = userEvent.setup();
    const editor = editorWith('x');
    render(<Field editor={editor} />);
    focusText(editor);
    selectWords(editor);
    const bold = within(bar()).getByRole('button', { name: 'Aldin' });

    expect(fireEvent.pointerDown(bold)).toBe(false);
    expect(fireEvent.mouseDown(bold)).toBe(false);

    await user.click(bold);

    expect(editor.getMarkdown()).toBe('**x**');
    expect(editor.view.dom).toHaveFocus();
    expect(shownMode()).toBe('keyboard');
    expect(bold).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the focus when a tap misses every button, inside a focusable sheet', async () => {
    const user = userEvent.setup();
    const editor = editorWith('x');
    // A FormSheet popup is focusable (Base UI gives it tabindex="-1"): a
    // press on the bar's gaps or padding would otherwise focus it.
    render(
      <div tabIndex={-1} data-testid="sheet">
        <Field editor={editor} />
      </div>,
    );
    focusText(editor);
    const surface = document.querySelector<HTMLElement>(
      '[data-slot="formatted-text-keyboard-bar"]',
    );
    if (!surface) throw new Error('no bar');

    expect(fireEvent.pointerDown(surface)).toBe(false);
    expect(fireEvent.mouseDown(surface)).toBe(false);
    await user.click(surface);
    await user.click(bar());

    expect(editor.view.dom).toHaveFocus();
    expect(shownMode()).toBe('keyboard');

    await user.click(within(bar()).getByRole('button', { name: 'Stiluri' }));
    await waitFor(() => expect(editor.view.dom).not.toHaveFocus());
    const panel = screen.getByRole('toolbar', { name: 'Stiluri' });

    await user.click(panel);

    expect(screen.getByTestId('sheet')).not.toHaveFocus();
    expect(shownMode()).toBe('panel');
  });

  it('Aa swaps the keyboard for the panel, keeping the selection; the text brings the keyboard back', async () => {
    const user = userEvent.setup();
    const editor = editorWith('x');
    render(<Field editor={editor} />);
    focusText(editor);
    selectWords(editor);
    const styles = within(bar()).getByRole('button', { name: 'Stiluri' });
    expect(styles).toHaveAttribute('aria-expanded', 'false');

    await user.click(styles);

    expect(shownMode()).toBe('panel');
    expect(styles).toHaveAttribute('aria-expanded', 'true');
    // The editor gives up focus, so the phone closes its keyboard.
    await waitFor(() => expect(editor.view.dom).not.toHaveFocus());
    expect(editor.isFocused).toBe(false);
    expect(shownMode()).toBe('panel');
    const panel = screen.getByRole('toolbar', { name: 'Stiluri' });
    expect(
      within(panel)
        .getAllByRole('button')
        .map(
          (button) => button.getAttribute('aria-label') ?? button.textContent,
        ),
    ).toEqual([
      'Titlu',
      'Subtitlu',
      'Text',
      'Citat',
      'Aldin',
      'Cursiv',
      'Tăiat',
      'Evidențiază',
      'Link',
      'Listă',
      'Listă numerotată',
      'Fără formatare',
    ]);

    // The panel's commands act on the kept selection without focusing.
    await user.click(within(panel).getByRole('button', { name: 'Titlu' }));
    await user.click(within(panel).getByRole('button', { name: 'Aldin' }));
    expect(editor.getMarkdown()).toBe('# **x**');
    expect(editor.view.dom).not.toHaveFocus();
    expect(shownMode()).toBe('panel');

    focusText(editor);

    expect(shownMode()).toBe('keyboard');
    expect(screen.queryByRole('toolbar', { name: 'Stiluri' })).toBeNull();
  });

  it('Aa again brings the keyboard back', async () => {
    const user = userEvent.setup();
    const editor = editorWith('x');
    render(<Field editor={editor} />);
    focusText(editor);
    const styles = within(bar()).getByRole('button', { name: 'Stiluri' });
    await user.click(styles);
    await waitFor(() => expect(editor.view.dom).not.toHaveFocus());

    await user.click(styles);

    await waitFor(() => expect(editor.view.dom).toHaveFocus());
    expect(shownMode()).toBe('keyboard');
  });

  it('Ascunde tastatura closes the keyboard and the bar', async () => {
    const user = userEvent.setup();
    const editor = editorWith('x');
    render(<Field editor={editor} />);
    focusText(editor);

    await user.click(
      within(bar()).getByRole('button', { name: 'Ascunde tastatura' }),
    );

    expect(shownMode()).toBe('hidden');
    await waitFor(() => expect(editor.view.dom).not.toHaveFocus());
    expect(shownMode()).toBe('hidden');
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('a field focused elsewhere closes the panel', async () => {
    const user = userEvent.setup();
    const editor = editorWith('x');
    render(<Field editor={editor} />);
    focusText(editor);
    await user.click(within(bar()).getByRole('button', { name: 'Stiluri' }));
    await waitFor(() => expect(editor.view.dom).not.toHaveFocus());

    await user.click(screen.getByLabelText('Alt câmp'));

    expect(shownMode()).toBe('hidden');
  });

  it('publishes its height as --format-bar-h while shown, so a sheet ends above it', async () => {
    const user = userEvent.setup();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: Element) {
        const tall = this.matches('[data-slot="formatted-text-keyboard-bar"]')
          ? this.querySelector('[aria-label="Stiluri"][role="toolbar"]')
            ? 212.4
            : 52
          : 0;
        return DOMRect.fromRect({ width: 0, height: tall });
      },
    );
    const root = document.documentElement;
    const editor = editorWith('x');
    render(<Field editor={editor} />);
    expect(root.style.getPropertyValue('--format-bar-h')).toBe('');

    focusText(editor);
    expect(root.style.getPropertyValue('--format-bar-h')).toBe('52px');

    await user.click(within(bar()).getByRole('button', { name: 'Stiluri' }));
    expect(root.style.getPropertyValue('--format-bar-h')).toBe('213px');

    await user.click(screen.getByLabelText('Alt câmp'));
    expect(root.style.getPropertyValue('--format-bar-h')).toBe('');
  });

  it('opens the link dialog from the bar', async () => {
    const user = userEvent.setup();
    const editor = editorWith('x');
    render(<Field editor={editor} />);
    focusText(editor);
    selectWords(editor);

    await user.click(within(bar()).getByRole('button', { name: 'Link' }));

    expect(
      await screen.findByRole('dialog', { name: 'Adaugă link' }),
    ).toBeInTheDocument();
  });
});

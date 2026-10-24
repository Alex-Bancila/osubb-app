import type { ChainedCommands, Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  BoldIcon,
  Heading1Icon,
  Heading2Icon,
  HighlighterIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  RemoveFormattingIcon,
  StrikethroughIcon,
  TextQuoteIcon,
  type LucideIcon,
} from 'lucide-react';

/**
 * What both Formatted Text toolbars offer (ruling R60, decisions 1, 3 and 4):
 * the controls' copy, icons and shortcuts, the commands they run, and the
 * state they show. The top toolbar runs each command with `.focus()`; the
 * keyboard bar runs it without, so a phone keeps its keyboard as it is.
 */

/** The style of the block the caret is in. */
export type BlockStyle = 'title' | 'subtitle' | 'text' | 'quote';

/** Titlu, Subtitlu, Text and Citat: the "different font size" of decision 2. */
export const BLOCK_STYLES: readonly {
  style: BlockStyle;
  label: string;
  icon: LucideIcon;
  keys: string;
}[] = [
  { style: 'title', label: 'Titlu', icon: Heading1Icon, keys: 'Mod-Alt-1' },
  {
    style: 'subtitle',
    label: 'Subtitlu',
    icon: Heading2Icon,
    keys: 'Mod-Alt-2',
  },
  { style: 'text', label: 'Text', icon: PilcrowIcon, keys: 'Mod-Alt-0' },
  { style: 'quote', label: 'Citat', icon: TextQuoteIcon, keys: 'Mod-Shift-B' },
];

/** A control that is on or off for the selection, shown with `aria-pressed`. */
export type Toggle =
  'bold' | 'italic' | 'strike' | 'highlight' | 'bulletList' | 'orderedList';

export const TOGGLES: Readonly<
  Record<
    Toggle,
    {
      label: string;
      icon: LucideIcon;
      keys: string;
      run: (chain: ChainedCommands) => ChainedCommands;
    }
  >
> = {
  bold: {
    label: 'Aldin',
    icon: BoldIcon,
    keys: 'Mod-B',
    run: (chain) => chain.toggleBold(),
  },
  italic: {
    label: 'Cursiv',
    icon: ItalicIcon,
    keys: 'Mod-I',
    run: (chain) => chain.toggleItalic(),
  },
  strike: {
    label: 'Tăiat',
    icon: StrikethroughIcon,
    keys: 'Mod-Shift-S',
    run: (chain) => chain.toggleStrike(),
  },
  highlight: {
    label: 'Evidențiază',
    icon: HighlighterIcon,
    keys: 'Mod-Shift-H',
    run: (chain) => chain.toggleHighlight(),
  },
  bulletList: {
    label: 'Listă',
    icon: ListIcon,
    keys: 'Mod-Shift-8',
    run: (chain) => chain.toggleBulletList(),
  },
  orderedList: {
    label: 'Listă numerotată',
    icon: ListOrderedIcon,
    keys: 'Mod-Shift-7',
    run: (chain) => chain.toggleOrderedList(),
  },
};

/** Opens the link dialog (`TextLinkDialog`, which also binds Ctrl/Cmd+K). */
export const LINK = { label: 'Link', icon: LinkIcon, keys: 'Mod-K' } as const;

/** Takes every mark off the selection (decision 16). */
export const CLEAR = {
  label: 'Fără formatare',
  icon: RemoveFormattingIcon,
} as const;

const APPLE_KEYS: Readonly<Record<string, string>> = {
  Mod: '⌘',
  Shift: '⇧',
  Alt: '⌥',
};

/** `Mod-Shift-S` as the device names it: `Ctrl+Shift+S`, or `⌘⇧S` on Apple. */
export function shortcutText(keys: string): string {
  const parts = keys.split('-');
  const key = (parts.pop() ?? '').toUpperCase();
  const apple =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  if (apple)
    return parts.map((part) => APPLE_KEYS[part] ?? part).join('') + key;
  return [...parts.map((part) => (part === 'Mod' ? 'Ctrl' : part)), key].join(
    '+',
  );
}

/** A control's tooltip: `Aldin (Ctrl+B)`. */
export function withShortcut(label: string, keys: string): string {
  return `${label} (${shortcutText(keys)})`;
}

export function blockStyleOf(editor: Editor): BlockStyle {
  if (editor.isActive('heading', { level: 1 })) return 'title';
  if (editor.isActive('heading', { level: 2 })) return 'subtitle';
  if (editor.isActive('blockquote')) return 'quote';
  return 'text';
}

/**
 * Gives the caret's block one style, the others off: a Citat chosen for a
 * Titlu is a quoted line of text, a Titlu chosen in a Citat leaves the quote.
 */
export function setBlockStyle(
  editor: Editor,
  chain: ChainedCommands,
  style: BlockStyle,
): ChainedCommands {
  const quoted = editor.isActive('blockquote');
  if (style === 'quote')
    return quoted ? chain.setParagraph() : chain.setParagraph().setBlockquote();
  const unquoted = quoted ? chain.unsetBlockquote() : chain;
  return style === 'text'
    ? unquoted.setParagraph()
    : unquoted.setHeading({ level: style === 'title' ? 1 : 2 });
}

/**
 * Fără formatare: every mark off the selection; with nothing selected, what
 * is typed next carries none either.
 */
export function clearFormatting(chain: ChainedCommands): ChainedCommands {
  return chain.unsetAllMarks().command(({ tr }) => {
    if (tr.selection.empty) tr.setStoredMarks([]);
    return true;
  });
}

export type FormatState = Readonly<
  Record<Toggle, boolean> & { link: boolean; style: BlockStyle }
>;

/** What the toolbar shows for the selection, kept current on every change. */
export function useFormatState(editor: Editor): FormatState {
  return useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      strike: current.isActive('strike'),
      highlight: current.isActive('highlight'),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      link: current.isActive('link'),
      style: blockStyleOf(current),
    }),
  });
}

/**
 * On `mousedown` and `pointerdown` of a control: the press does not take the
 * focus from the text, so the selection stays and a phone keeps its keyboard.
 */
export function keepFocus(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

/**
 * A toolbar control's look on top of the ghost button (44 px): muted until
 * pressed, then the ink on a soft tint, ringed so it never reads as a hover.
 */
export const toolbarControlClass =
  'text-muted-foreground hover:bg-muted/60 aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-border aria-pressed:ring-inset aria-expanded:bg-muted aria-expanded:text-foreground';

/**
 * The text's element, where focus goes back when the Stil menu or the link
 * dialog closes; `true` (Base UI's own choice) while it is not mounted.
 */
export function editorElement(editor: Editor): HTMLElement | true {
  if (editor.isDestroyed) return true;
  try {
    return editor.view.dom;
  } catch {
    return true;
  }
}

import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import { useCoarsePointer } from '../../../lib/use-coarse-pointer';
import { EDITOR_OPTIONS, formattedTextExtensions } from './extensions';
import {
  FormattedTextKeyboardBar,
  type KeyboardBarMode,
} from './FormattedTextKeyboardBar';
import { FormattedTextToolbar } from './FormattedTextToolbar';
import { parseFormattedText, serializeFormattedText } from './markdown';

/**
 * How long typing rests before the rest of a burst goes to the form. Writing
 * the Markdown takes a few milliseconds at 2000 characters, too long to
 * repeat on every key; the first change of a burst and a blur send it at once.
 */
const SETTLE_MS = 150;

/**
 * The field's surface: the look of `fieldControlClass` (`ui/input.tsx`) drawn
 * around the toolbar and the text. That class styles the control itself
 * (`focus-visible:`, `aria-invalid:`, `disabled:`); here the same border,
 * background, ring and muted look follow the text's own element
 * (`.ProseMirror`) through `has-[…]`. A long text scrolls inside it, under
 * the toolbar.
 */
const SURFACE =
  'group/field max-h-80 w-full min-w-0 overflow-y-auto rounded-lg border border-border bg-background font-sans text-sm text-foreground transition-colors [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] motion-reduce:transition-none dark:border-input dark:bg-input/30 has-[.ProseMirror:focus-visible]:border-ring has-[.ProseMirror:focus-visible]:outline-3 has-[.ProseMirror:focus-visible]:outline-offset-2 has-[.ProseMirror:focus-visible]:outline-ring has-[.ProseMirror:focus-visible]:outline-solid has-[.ProseMirror:focus-visible]:ring-3 has-[.ProseMirror:focus-visible]:ring-ring/50 has-[.ProseMirror[aria-invalid=true]]:border-destructive has-[.ProseMirror[aria-invalid=true]]:ring-3 has-[.ProseMirror[aria-invalid=true]]:ring-destructive/20 has-[.ProseMirror[contenteditable=false]]:bg-muted has-[.ProseMirror[contenteditable=false]]:text-muted-foreground';

/**
 * The sticky toolbar's background, opaque so text scrolling under it never
 * shows through, and the colour the surface shows: `bg-background` in light,
 * as the surface is; in dark the surface is `--input` at 30% over the sheet's
 * `--card`, which is this mix, channel for channel. A locked text (a save
 * running) turns the surface muted, and the toolbar with it.
 */
const TOOLBAR_SURFACE =
  'dark:bg-[color-mix(in_srgb,var(--input)_30%,var(--card))] group-has-[.ProseMirror[contenteditable=false]]/field:bg-muted';

/**
 * Where the caret is scrolled to when it nears the surface's edges, in
 * pixels: at the top, clear of the sticky toolbar (about 53 px tall), which
 * would otherwise cover it. ProseMirror's own margin is 5. The keyboard bar
 * on touch sits outside the scroller and needs none.
 */
const CLEAR_OF_TOOLBAR = { top: 60, right: 5, bottom: 5, left: 5 };

/**
 * Whether focus at `target` is still with the field: its text, its toolbar or
 * keyboard bar, or a panel one of them opened (the Stil menu and the link
 * dialog, drawn in portals and marked `data-formatted-text-panel`).
 */
function withinField(surface: HTMLElement | null, target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (surface?.contains(target)) return true;
  return (
    target.closest(
      '[data-slot="formatted-text-keyboard-bar"], [data-formatted-text-panel]',
    ) !== null
  );
}

export type FormattedTextEditorProps = {
  id: string;
  /** The id of the field's visible label, which names the text. */
  labelId: string;
  value: string;
  onChange: (markdown: string) => void;
  required?: boolean;
  /** Gets the text's editable element, the one a failed submit focuses. */
  inputRef?: Ref<HTMLElement>;
  onBlur?: () => void;
  invalid?: boolean;
  describedBy?: string;
};

/** A text, and that text as the editor writes it. */
type Canonical = { of: string; markdown: string };

/**
 * What the form gets for `markdown`, the editor's document: `given`, the text
 * the form gave the field, byte for byte when the document is that text again
 * (ruling 36). A legacy text the editor writes differently (three line
 * breaks, a `1)` list) that the Member touched and put back reads the same
 * either way, so it is not rewritten, recorded as changed or announced to an
 * audience. `memo` keeps `given` as the editor writes it, worked out once.
 */
function toForm(
  markdown: string,
  given: string,
  memo: { current: Canonical | null },
): string {
  if (markdown === given) return markdown;
  if (memo.current?.of !== given)
    memo.current = {
      of: given,
      markdown: serializeFormattedText(parseFormattedText(given)),
    };
  return markdown === memo.current.markdown ? given : markdown;
}

function assignRef(ref: Ref<HTMLElement> | undefined, element: HTMLElement) {
  if (typeof ref === 'function') {
    ref(element);
    return () => {
      ref(null);
    };
  }
  if (!ref) return undefined;
  ref.current = element;
  return () => {
    ref.current = null;
  };
}

/**
 * The editing half of `FormattedTextField` (ruling R60, §C), loaded only when
 * a form with Formatted Text opens, so no reading screen carries Tiptap.
 *
 * The text goes to the form only after a change to the document, so a text
 * opened and left alone is submitted exactly as it was stored, even where the
 * editor would write it differently; so is one changed and then put back
 * (ruling 36). The first change of a burst goes at once, so a Save that a
 * change enables is never left waiting (ruling 35); the rest go when typing
 * rests, and at once on a blur, when a change is made without the text's
 * focus (the Aa panel, the link dialog) and when the field closes.
 *
 * The form checks the field once its text has reached it, and only when
 * focus leaves the field: a move into the field's own panels (Aa, the Stil
 * menu, the link dialog) is not leaving it, so an empty Mesaj is not called
 * missing while a Member picks Titlu.
 *
 * Touch gets the keyboard bar, a mouse the top toolbar (decision 5). The bar
 * is drawn inside the field, so it stays in the sheet's own tree: Base UI
 * takes a press outside the sheet for a press that closes it.
 */
export default function FormattedTextEditor({
  id,
  labelId,
  value,
  onChange,
  required = false,
  inputRef,
  onBlur,
  invalid = false,
  describedBy,
}: FormattedTextEditorProps) {
  const coarse = useCoarsePointer();
  const [mode, setMode] = useState<KeyboardBarMode>('hidden');
  // The bar's mode as last asked for: Aa asks for the panel, then blurs the
  // text, before the new mode renders.
  const modeAsked = useRef<KeyboardBarMode>('hidden');
  const surface = useRef<HTMLDivElement>(null);

  const latest = useRef({ onChange, onBlur });
  useLayoutEffect(() => {
    latest.current = { onChange, onBlur };
  });

  /** The Markdown the form last had from this field, or gave it. */
  const sent = useRef(value);
  /** The text the form last gave the field: at its opening, or a reset. */
  const original = useRef(value);
  /** `original` as the editor writes it, once a change has needed it. */
  const canonical = useRef<Canonical | null>(null);
  /** A change the form has not had yet. */
  const unsent = useRef(false);
  /** Running while typing goes on: until it ends, a change waits. */
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function send(editor: Editor) {
    unsent.current = false;
    const markdown = toForm(editor.getMarkdown(), original.current, canonical);
    sent.current = markdown;
    latest.current.onChange(markdown);
  }

  function flush(editor: Editor) {
    if (unsent.current) send(editor);
  }

  // The form's check, once the text it judges has rendered: `onBlur` judges
  // the values of the render it came from.
  const [checks, setChecks] = useState(0);
  const checked = useRef(0);
  useEffect(() => {
    if (checks === checked.current) return;
    checked.current = checks;
    latest.current.onBlur?.();
  }, [checks]);

  /** The text lost focus to the field's own panels: the check waits. */
  const checkWaits = useRef(false);

  // Focus that lands outside the field ends the wait.
  useEffect(() => {
    const focusMoved = (event: FocusEvent) => {
      if (!checkWaits.current || withinField(surface.current, event.target))
        return;
      checkWaits.current = false;
      setChecks((count) => count + 1);
    };
    document.addEventListener('focusin', focusMoved);
    return () => document.removeEventListener('focusin', focusMoved);
  }, []);

  // So does the bar put away with focus nowhere (Ascunde tastatura from the
  // panel), but not the panel giving way to the link dialog.
  useEffect(() => {
    if (mode !== 'hidden' || !checkWaits.current) return;
    if (withinField(surface.current, document.activeElement)) return;
    checkWaits.current = false;
    setChecks((count) => count + 1);
  }, [mode]);

  const [extensions] = useState(formattedTextExtensions);
  const [content] = useState(value);
  const editorProps = useMemo(
    () => ({
      ...EDITOR_OPTIONS.editorProps,
      attributes: {
        id,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': labelId,
        ...(required && { 'aria-required': 'true' }),
        ...(invalid && { 'aria-invalid': 'true' }),
        ...(describedBy && { 'aria-describedby': describedBy }),
        class: 'formatted-text min-h-24 px-4 py-2.5 outline-none',
      },
      ...(!coarse && {
        scrollMargin: CLEAR_OF_TOOLBAR,
        scrollThreshold: CLEAR_OF_TOOLBAR,
      }),
    }),
    [id, labelId, required, invalid, describedBy, coarse],
  );

  const editor = useEditor({
    ...EDITOR_OPTIONS,
    extensions,
    content,
    contentType: 'markdown',
    editorProps,
    onUpdate: ({ editor: current, transaction, appendedTransactions }) => {
      const changed =
        transaction.docChanged ||
        appendedTransactions.some((appended) => appended.docChanged);
      if (!changed) return;
      if (!current.isFocused) {
        send(current);
        return;
      }
      if (settle.current === undefined) send(current);
      else unsent.current = true;
      clearTimeout(settle.current);
      settle.current = setTimeout(() => {
        settle.current = undefined;
        flush(current);
      }, SETTLE_MS);
    },
    onFocus: () => {
      checkWaits.current = false;
    },
    onBlur: ({ editor: current, event }) => {
      flush(current);
      if (
        modeAsked.current === 'panel' ||
        withinField(surface.current, event.relatedTarget)
      ) {
        checkWaits.current = true;
        return;
      }
      setChecks((count) => count + 1);
    },
  });

  // Closing the form with a change still waiting sends it.
  useEffect(
    () => () => {
      clearTimeout(settle.current);
      settle.current = undefined;
      if (!unsent.current || editor.isDestroyed) return;
      unsent.current = false;
      latest.current.onChange(
        toForm(editor.getMarkdown(), original.current, canonical),
      );
    },
    [editor],
  );

  // A text the form set itself (a reset) replaces the field's, and wins over
  // a change still waiting, which is dropped.
  useEffect(() => {
    if (value === sent.current || editor.isDestroyed) return;
    clearTimeout(settle.current);
    settle.current = undefined;
    unsent.current = false;
    sent.current = value;
    original.current = value;
    editor.commands.setContent(value, {
      contentType: 'markdown',
      emitUpdate: false,
    });
  }, [editor, value]);

  // `useEditor` destroys an editor whose component has not committed within
  // a millisecond and makes a new one; a render that waited (as one after
  // the chunk loads may) commits with the old one, already without a view.
  useLayoutEffect(() => {
    if (editor.isDestroyed) return;
    return assignRef(inputRef, editor.view.dom);
  }, [editor, inputRef]);

  // `<label for>` names form controls only: a press on the label focuses the
  // text, as it focuses a textarea.
  useEffect(() => {
    const label = document.getElementById(labelId);
    if (!label) return;
    const focus = () => editor.commands.focus();
    label.addEventListener('click', focus);
    return () => label.removeEventListener('click', focus);
  }, [editor, labelId]);

  // A disabled fieldset (a save running) locks the text, as it does a
  // textarea.
  useLayoutEffect(() => {
    if (editor.isDestroyed) return;
    const locked = surface.current?.closest('fieldset[disabled]') != null;
    if (editor.isEditable === locked) editor.setEditable(!locked, false);
  });

  return (
    <>
      <div ref={surface} data-slot="formatted-text-input" className={SURFACE}>
        {!coarse && (
          <FormattedTextToolbar editor={editor} className={TOOLBAR_SURFACE} />
        )}
        <EditorContent editor={editor} />
      </div>
      {coarse && (
        <FormattedTextKeyboardBar
          editor={editor}
          mode={mode}
          onModeChange={(next) => {
            modeAsked.current = next;
            setMode(next);
          }}
        />
      )}
    </>
  );
}

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

/**
 * How long typing rests before the text goes to the form. Writing the
 * Markdown takes a few milliseconds at 2000 characters, too long to repeat on
 * every key; a blur sends it at once.
 */
const SETTLE_MS = 150;

/**
 * The field's surface: the one field look (`fieldControlClass`) drawn around
 * the toolbar and the text, its focus ring and invalid border following the
 * text's own element. A long text scrolls inside it, under the toolbar.
 */
const SURFACE =
  'max-h-80 w-full min-w-0 overflow-y-auto rounded-lg border border-border bg-background font-sans text-sm text-foreground transition-colors [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] motion-reduce:transition-none dark:border-input dark:bg-input/30 has-[.ProseMirror:focus-visible]:border-ring has-[.ProseMirror:focus-visible]:outline-3 has-[.ProseMirror:focus-visible]:outline-offset-2 has-[.ProseMirror:focus-visible]:outline-ring has-[.ProseMirror:focus-visible]:outline-solid has-[.ProseMirror:focus-visible]:ring-3 has-[.ProseMirror:focus-visible]:ring-ring/50 has-[[aria-invalid=true]]:border-destructive has-[[aria-invalid=true]]:ring-3 has-[[aria-invalid=true]]:ring-destructive/20 has-[[contenteditable=false]]:bg-muted has-[[contenteditable=false]]:text-muted-foreground';

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
 * editor would write it differently. A change goes after typing rests, or at
 * once on a blur, when the change is made without the text's focus (the Aa
 * panel, the link dialog) and when the field closes; a blur is checked by the
 * form only once that text has reached it.
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
  const surface = useRef<HTMLDivElement>(null);

  const latest = useRef({ onChange, onBlur });
  useLayoutEffect(() => {
    latest.current = { onChange, onBlur };
  });

  /** The Markdown the form last had from this field, or gave it. */
  const sent = useRef(value);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function send(editor: Editor) {
    clearTimeout(settle.current);
    settle.current = undefined;
    const markdown = editor.getMarkdown();
    sent.current = markdown;
    latest.current.onChange(markdown);
  }

  function flush(editor: Editor) {
    if (settle.current !== undefined) send(editor);
  }

  // A blur waits for the text it sent to render, then the form checks it:
  // `onBlur` judges the values of the render it came from.
  const [blurs, setBlurs] = useState(0);
  const checkedBlurs = useRef(0);
  useEffect(() => {
    if (blurs === checkedBlurs.current) return;
    checkedBlurs.current = blurs;
    latest.current.onBlur?.();
  }, [blurs]);

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
    }),
    [id, labelId, required, invalid, describedBy],
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
      clearTimeout(settle.current);
      settle.current = setTimeout(() => send(current), SETTLE_MS);
    },
    onBlur: ({ editor: current }) => {
      flush(current);
      setBlurs((count) => count + 1);
    },
  });

  // Closing the form with a change still settling sends it.
  useEffect(
    () => () => {
      if (settle.current === undefined || editor.isDestroyed) return;
      clearTimeout(settle.current);
      settle.current = undefined;
      latest.current.onChange(editor.getMarkdown());
    },
    [editor],
  );

  // A text the form set itself (a reset) replaces the field's, and wins over
  // a change still settling.
  useEffect(() => {
    if (value === sent.current || editor.isDestroyed) return;
    clearTimeout(settle.current);
    settle.current = undefined;
    sent.current = value;
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
        {!coarse && <FormattedTextToolbar editor={editor} />}
        <EditorContent editor={editor} />
      </div>
      {coarse && (
        <FormattedTextKeyboardBar
          editor={editor}
          mode={mode}
          onModeChange={setMode}
        />
      )}
    </>
  );
}

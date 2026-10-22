import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { safeHttpUrl } from '../../../lib/links';
import { useFormValidation } from '../../../lib/use-form-validation';
import { Button } from '../../ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';
import { FieldError } from '../../ui/field';
import { Input } from '../../ui/input';
import { editorElement } from './formatting';

/**
 * A Text Link goes to an http(s) address only (decision 7), the rule an
 * Attached Link follows (`safeHttpUrl`), refused with the same copy:
 * `osubb.ro` stays text.
 */
const textLinkSchema = z
  .object({ text: z.string(), url: z.string() })
  .transform(({ text, url }) => ({ text: text.trim(), url: url.trim() }))
  .superRefine(({ url }, ctx) => {
    if (safeHttpUrl(url) === null)
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'link_url_invalid',
      });
  });

const fieldForReason: Readonly<Record<string, string>> = {
  link_url_invalid: 'url',
};

function isLinkShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'k'
  );
}

/**
 * The link dialog of both toolbars (ruling R60, decision 6): it turns the
 * selected words into a Text Link, or, with nothing selected, writes new
 * words linked; on a link already there it changes the address or removes
 * the link. Ctrl/Cmd+K in the text opens it. At most two fields, as a dialog
 * has (DESIGN.md): Adresa, and Text when no words are selected.
 */
export function TextLinkDialog({
  editor,
  open,
  onOpenChange,
}: {
  editor: Editor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const openChange = useRef(onOpenChange);
  useEffect(() => {
    openChange.current = onOpenChange;
  });

  // Ctrl/Cmd+K, through ProseMirror's own key handling: registered on the
  // editor's state, it holds before the editor is mounted and after.
  useEffect(() => {
    const key = new PluginKey('textLinkShortcut');
    editor.registerPlugin(
      new Plugin({
        key,
        props: {
          handleKeyDown: (_view, event) => {
            if (!isLinkShortcut(event)) return false;
            openChange.current(true);
            return true;
          },
        },
      }),
    );
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(key);
    };
  }, [editor]);

  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogContent finalFocus={() => editorElement(editor)}>
        <TextLinkForm editor={editor} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The dialog's form, mounted each time it opens: what it edits is read from
 * the selection then, and stays put while the Member types.
 */
function TextLinkForm({
  editor,
  onDone,
}: {
  editor: Editor;
  onDone: () => void;
}) {
  const id = useId();
  const [target] = useState(() => {
    const editing = editor.isActive('link');
    const href: unknown = editing ? editor.getAttributes('link').href : '';
    return {
      editing,
      // No words to link: the dialog asks for them.
      needsText: !editing && editor.state.selection.empty,
      href: typeof href === 'string' ? href : '',
    };
  });
  const [text, setText] = useState('');
  const [url, setUrl] = useState(target.href);
  const form = useFormValidation(textLinkSchema, { text, url }, fieldForReason);

  function submit(event: FormEvent) {
    event.preventDefault();
    // The dialog sits in the form the field belongs to, in React's tree: its
    // submit must not reach that form through the portal.
    event.stopPropagation();
    const values = form.validate();
    if (!values) return;
    const href = values.url;
    if (target.needsText)
      editor
        .chain()
        .insertContent({
          type: 'text',
          text: values.text || href,
          marks: [{ type: 'link', attrs: { href } }],
        })
        // What is typed next is not part of the link.
        .unsetMark('link')
        .run();
    else editor.chain().extendMarkRange('link').setLink({ href }).run();
    onDone();
  }

  function remove() {
    editor.chain().extendMarkRange('link').unsetLink().run();
    onDone();
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          {target.editing ? 'Modifică linkul' : 'Adaugă link'}
        </DialogTitle>
      </DialogHeader>
      {target.needsText && (
        <div className="grid gap-1.5">
          <label className="text-sm font-medium" htmlFor={`${id}-text`}>
            Text (opțional)
          </label>
          <Input
            id={`${id}-text`}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
      )}
      <div className="grid gap-1.5">
        <label className="text-sm font-medium" htmlFor={`${id}-url`}>
          Adresa
        </label>
        <Input
          id={`${id}-url`}
          type="url"
          inputMode="url"
          placeholder="https://"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          {...form.field('url')}
        />
        <FieldError {...form.errorProps('url')} />
      </div>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Renunță
        </DialogClose>
        {/* A link already there is saved, not added (ruling 28). */}
        <Button type="submit">{target.editing ? 'Salvează' : 'Adaugă'}</Button>
        {target.editing && (
          // The destructive action comes last at every width, tinted, never
          // filled (DESIGN.md, ruling 30): the rightmost from `sm`, and the
          // bottom under it, where the footer stacks in reverse.
          <Button
            type="button"
            variant="destructive"
            className="max-sm:order-first"
            onClick={remove}
          >
            Elimină linkul
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}

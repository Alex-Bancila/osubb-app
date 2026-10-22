import { Menu } from '@base-ui/react/menu';
import { Toolbar } from '@base-ui/react/toolbar';
import type { Editor } from '@tiptap/core';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../../lib/utils';
import { buttonVariants } from '../../ui/button';
import {
  BLOCK_STYLES,
  CLEAR,
  clearFormatting,
  editorElement,
  keepFocus,
  LINK,
  setBlockStyle,
  shortcutText,
  TOGGLES,
  toolbarControlClass,
  useFormatState,
  withShortcut,
  type Toggle,
} from './formatting';
import { TextLinkDialog } from './TextLinkDialog';

const iconControl = cn(
  buttonVariants({ variant: 'ghost', size: 'icon' }),
  toolbarControlClass,
);

const separator = 'mx-0.5 h-6 w-px shrink-0 bg-border';

/**
 * The top toolbar, for a mouse or trackpad (ruling R60, decision 4):
 * Stil ▾ (Titlu, Subtitlu, Text, Citat) | Aldin, Cursiv, Tăiat | Listă,
 * Listă numerotată | Link, Evidențiază, Fără formatare. One `toolbar` the
 * arrow keys move through; every control is 44 px, a Romanian name, a
 * tooltip naming its shortcut, and `aria-pressed` where it is on or off. It
 * sticks to the top of the field while a long text scrolls. A click keeps the
 * focus in the text; each command then runs on the selection as it was.
 */
export function FormattedTextToolbar({
  editor,
  className,
}: {
  editor: Editor;
  className?: string;
}) {
  const state = useFormatState(editor);
  const [linkOpen, setLinkOpen] = useState(false);
  const style =
    BLOCK_STYLES.find((choice) => choice.style === state.style) ??
    BLOCK_STYLES[2];

  function toggle(name: Toggle) {
    const control = TOGGLES[name];
    const Icon = control.icon;
    return (
      <Toolbar.Button
        aria-label={control.label}
        aria-pressed={state[name]}
        title={withShortcut(control.label, control.keys)}
        className={iconControl}
        onMouseDown={keepFocus}
        onClick={() => control.run(editor.chain().focus()).run()}
      >
        <Icon aria-hidden="true" />
      </Toolbar.Button>
    );
  }

  return (
    <>
      <Toolbar.Root
        aria-label="Formatare"
        data-slot="formatted-text-toolbar"
        className={cn(
          'sticky top-0 z-1 flex flex-wrap items-center gap-0.5 border-b border-border bg-background p-1',
          className,
        )}
      >
        <Menu.Root>
          <Toolbar.Button
            render={<Menu.Trigger />}
            className={cn(
              buttonVariants({ variant: 'ghost' }),
              toolbarControlClass,
              'min-w-30 justify-between px-3',
            )}
          >
            <span>
              <span className="sr-only">Stil: </span>
              {style?.label}
            </span>
            <ChevronDownIcon aria-hidden="true" />
          </Toolbar.Button>
          <Menu.Portal>
            <Menu.Positioner
              align="start"
              sideOffset={6}
              className="z-80 outline-none"
            >
              <Menu.Popup
                finalFocus={() => editorElement(editor)}
                className="min-w-56 origin-(--transform-origin) rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 transition-[opacity,scale] outline-none motion-reduce:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
              >
                <Menu.RadioGroup value={state.style}>
                  {BLOCK_STYLES.map((choice) => {
                    const Icon = choice.icon;
                    return (
                      <Menu.RadioItem
                        key={choice.style}
                        value={choice.style}
                        closeOnClick
                        onClick={() =>
                          setBlockStyle(
                            editor,
                            editor.chain().focus(),
                            choice.style,
                          ).run()
                        }
                        className="flex min-h-11 cursor-default items-center gap-2.5 rounded-md px-3 text-sm font-medium outline-none select-none data-highlighted:bg-muted [&_svg]:size-4 [&_svg]:shrink-0"
                      >
                        <Icon aria-hidden="true" />
                        <span className="flex-1">{choice.label}</span>
                        <span
                          aria-hidden="true"
                          className="text-xs font-normal text-muted-foreground"
                        >
                          {shortcutText(choice.keys)}
                        </span>
                        <span className="flex size-4 items-center justify-center">
                          <Menu.RadioItemIndicator>
                            <CheckIcon aria-hidden="true" />
                          </Menu.RadioItemIndicator>
                        </span>
                      </Menu.RadioItem>
                    );
                  })}
                </Menu.RadioGroup>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        <Toolbar.Separator className={separator} />
        {toggle('bold')}
        {toggle('italic')}
        {toggle('strike')}
        <Toolbar.Separator className={separator} />
        {toggle('bulletList')}
        {toggle('orderedList')}
        <Toolbar.Separator className={separator} />
        <Toolbar.Button
          aria-label={LINK.label}
          aria-haspopup="dialog"
          title={withShortcut(LINK.label, LINK.keys)}
          className={iconControl}
          onMouseDown={keepFocus}
          onClick={() => setLinkOpen(true)}
        >
          <LINK.icon aria-hidden="true" />
        </Toolbar.Button>
        {toggle('highlight')}
        <Toolbar.Button
          aria-label={CLEAR.label}
          title={CLEAR.label}
          className={iconControl}
          onMouseDown={keepFocus}
          onClick={() => clearFormatting(editor.chain().focus()).run()}
        >
          <CLEAR.icon aria-hidden="true" />
        </Toolbar.Button>
      </Toolbar.Root>
      <TextLinkDialog
        editor={editor}
        open={linkOpen}
        onOpenChange={setLinkOpen}
      />
    </>
  );
}

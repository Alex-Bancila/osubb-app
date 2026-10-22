import { Toolbar } from '@base-ui/react/toolbar';
import type { ChainedCommands, Editor } from '@tiptap/core';
import { CaseSensitiveIcon, KeyboardOffIcon } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '../../../lib/utils';
import { buttonVariants } from '../../ui/button';
import {
  BLOCK_STYLES,
  CLEAR,
  clearFormatting,
  keepFocus,
  LINK,
  setBlockStyle,
  TOGGLES,
  toolbarControlClass,
  useFormatState,
  type BlockStyle,
  type Toggle,
} from './formatting';
import { TextLinkDialog } from './TextLinkDialog';

/**
 * Where the keyboard bar is: `hidden` while the text has no focus, `keyboard`
 * above the phone's keyboard while the Member types, `panel` with the Aa
 * panel in the keyboard's place (the text keeps its selection, not focus).
 */
export type KeyboardBarMode = 'hidden' | 'keyboard' | 'panel';

const iconControl = cn(
  buttonVariants({ variant: 'ghost', size: 'icon' }),
  toolbarControlClass,
);

/** A panel cell: as wide as its column, 44 px tall. */
const panelControl = cn(
  buttonVariants({ variant: 'ghost' }),
  toolbarControlClass,
  'w-full min-w-0 px-1',
);

/** Each style's name in the panel, drawn a little like what it makes. */
const STYLE_LOOK: Readonly<Record<BlockStyle, string>> = {
  title: 'text-base font-bold',
  subtitle: 'font-bold',
  text: 'font-normal',
  quote: 'font-normal italic',
};

/**
 * On every bar control: a press keeps the focus (and so the phone's
 * keyboard) where it is, as `mousedown` and `pointerdown` do nothing of their
 * own; the control acts on `click`.
 */
const KEEP_FOCUS = {
  onMouseDown: keepFocus,
  onPointerDown: keepFocus,
} as const;

/**
 * The keyboard bar, for touch (ruling R60, decision 1): Stiluri (Aa), Aldin,
 * Cursiv, Listă, Link and Ascunde tastatura, fixed above the phone's keyboard
 * (`--keyboard-inset`, #1013) while the text has focus. Its controls never
 * take the focus, so B and I keep the keyboard open. Aa gives up the text's
 * focus, so the keyboard closes and the panel takes its place, its three rows
 * acting on the kept selection without focusing; Aa again, or a tap in the
 * text, brings the keyboard back.
 *
 * While shown it publishes its height (bar, or bar and panel) on `<html>` as
 * `--format-bar-h`, so a sheet ends above it (`sheet.tsx`). The field owns
 * `mode`; the bar reports what the Member did through `onModeChange`.
 */
export function FormattedTextKeyboardBar({
  editor,
  mode,
  onModeChange,
}: {
  editor: Editor;
  mode: KeyboardBarMode;
  onModeChange: (mode: KeyboardBarMode) => void;
}) {
  const state = useFormatState(editor);
  const surface = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [linkOpen, setLinkOpen] = useState(false);

  // The mode as last asked for: Aa's blur arrives a frame after the press,
  // and must find the panel already asked for.
  const current = useRef(mode);
  const report = useRef(onModeChange);
  useLayoutEffect(() => {
    current.current = mode;
    report.current = onModeChange;
  });
  const setMode = useCallback((next: KeyboardBarMode) => {
    current.current = next;
    report.current(next);
  }, []);

  // The text's focus decides: focused is the keyboard; focus gone anywhere
  // but the bar hides it, unless Aa gave it up for the panel.
  useEffect(() => {
    const focused = () => setMode('keyboard');
    const blurred = ({ event }: { event: FocusEvent }) => {
      const next = event.relatedTarget;
      if (next instanceof Node && surface.current?.contains(next)) return;
      if (current.current === 'panel') return;
      setMode('hidden');
    };
    editor.on('focus', focused);
    editor.on('blur', blurred);
    return () => {
      editor.off('focus', focused);
      editor.off('blur', blurred);
    };
  }, [editor, setMode]);

  // With the panel up the text has no focus; a field focused elsewhere (or
  // the link dialog) puts the panel away.
  useEffect(() => {
    if (mode !== 'panel') return;
    const focusMoved = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (surface.current?.contains(target)) return;
      if (editor.view.dom.contains(target)) return;
      setMode('hidden');
    };
    document.addEventListener('focusin', focusMoved);
    return () => document.removeEventListener('focusin', focusMoved);
  }, [mode, editor, setMode]);

  // `--format-bar-h`: 0px (tailwind.css) unless the bar is shown. Through
  // the CSSOM, as `--keyboard-inset` is: the CSP forbids a `style` attribute.
  useLayoutEffect(() => {
    const element = surface.current;
    if (mode === 'hidden' || !element) return;
    const root = document.documentElement;
    const publish = () =>
      root.style.setProperty(
        '--format-bar-h',
        `${Math.ceil(element.getBoundingClientRect().height)}px`,
      );
    publish();
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null;
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--format-bar-h');
    };
  }, [mode]);

  /** A command on the kept selection, never focusing the text. */
  function run(command: (chain: ChainedCommands) => ChainedCommands) {
    command(editor.chain()).run();
  }

  function toggle(name: Toggle, className: string) {
    const control = TOGGLES[name];
    const Icon = control.icon;
    return (
      <Toolbar.Button
        aria-label={control.label}
        aria-pressed={state[name]}
        className={className}
        {...KEEP_FOCUS}
        onClick={() => run(control.run)}
      >
        <Icon aria-hidden="true" />
      </Toolbar.Button>
    );
  }

  function link(className: string) {
    return (
      <Toolbar.Button
        aria-label={LINK.label}
        aria-haspopup="dialog"
        className={className}
        {...KEEP_FOCUS}
        onClick={() => setLinkOpen(true)}
      >
        <LINK.icon aria-hidden="true" />
      </Toolbar.Button>
    );
  }

  const panel = mode === 'panel';

  return (
    <>
      {mode !== 'hidden' && (
        <div
          ref={surface}
          data-slot="formatted-text-keyboard-bar"
          className="fixed inset-x-0 bottom-(--keyboard-inset) z-80 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] text-card-foreground keyboard:pb-0"
        >
          <Toolbar.Root
            aria-label="Formatare"
            className="flex items-center gap-1 px-2"
          >
            <Toolbar.Button
              aria-label="Stiluri"
              aria-expanded={panel}
              aria-controls={panel ? panelId : undefined}
              className={iconControl}
              {...KEEP_FOCUS}
              onClick={() => {
                if (current.current === 'panel') {
                  setMode('keyboard');
                  editor.commands.focus();
                } else {
                  setMode('panel');
                  editor.commands.blur();
                }
              }}
            >
              <CaseSensitiveIcon aria-hidden="true" />
            </Toolbar.Button>
            {toggle('bold', iconControl)}
            {toggle('italic', iconControl)}
            {toggle('bulletList', iconControl)}
            {link(iconControl)}
            <Toolbar.Button
              aria-label="Ascunde tastatura"
              className={cn(iconControl, 'ml-auto')}
              {...KEEP_FOCUS}
              onClick={() => {
                setMode('hidden');
                editor.commands.blur();
              }}
            >
              <KeyboardOffIcon aria-hidden="true" />
            </Toolbar.Button>
          </Toolbar.Root>
          {panel && (
            <Toolbar.Root
              id={panelId}
              aria-label="Stiluri"
              className="grid gap-1 border-t border-border p-2"
            >
              <div className="grid grid-cols-4 gap-1">
                {BLOCK_STYLES.map((choice) => (
                  <Toolbar.Button
                    key={choice.style}
                    aria-pressed={state.style === choice.style}
                    className={cn(panelControl, STYLE_LOOK[choice.style])}
                    {...KEEP_FOCUS}
                    onClick={() =>
                      run((chain) => setBlockStyle(editor, chain, choice.style))
                    }
                  >
                    {choice.label}
                  </Toolbar.Button>
                ))}
              </div>
              <div className="grid grid-cols-5 gap-1">
                {toggle('bold', panelControl)}
                {toggle('italic', panelControl)}
                {toggle('strike', panelControl)}
                {toggle('highlight', panelControl)}
                {link(panelControl)}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {toggle('bulletList', panelControl)}
                {toggle('orderedList', panelControl)}
                <Toolbar.Button
                  aria-label={CLEAR.label}
                  className={panelControl}
                  {...KEEP_FOCUS}
                  onClick={() => run(clearFormatting)}
                >
                  <CLEAR.icon aria-hidden="true" />
                </Toolbar.Button>
              </div>
            </Toolbar.Root>
          )}
        </div>
      )}
      <TextLinkDialog
        editor={editor}
        open={linkOpen}
        onOpenChange={setLinkOpen}
      />
    </>
  );
}

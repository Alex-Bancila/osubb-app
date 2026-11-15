import {
  commands,
  Extension,
  InputRule,
  isActive,
  textblockTypeInputRule,
  wrappingInputRule,
  type CommandProps,
  type Range,
} from '@tiptap/core';
import { Fragment, Slice, type Node } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { liftTarget, ReplaceStep } from '@tiptap/pm/transform';

/**
 * A block style or a list applies to the lines the selection touches, never to
 * the rest of their paragraph. A paragraph's lines are separated by hard
 * breaks: a paste from WhatsApp or a notes app, Shift+Enter, or a text stored
 * with single newlines. A Member reads each as a line of its own, yet a
 * Titlu, a Citat or a list once took the whole paragraph, and a Titlu then
 * joined every line into one title.
 *
 * So before such a style is turned on, the lines it touches become blocks of
 * their own, and the paragraph's other lines stay together around them.
 */

/**
 * How the touched lines are cut out: `each` one block per line (Titlu,
 * Subtitlu, a list: one title or item per line), `together` one block for all
 * of them (Citat: the quote keeps them as the lines they were).
 */
type LineScope = 'each' | 'together';

type Command = (props: CommandProps) => boolean;

/** The offsets of `block`'s hard breaks, in its content. */
function breaksOf(block: Node): number[] {
  const breaks: number[] = [];
  block.forEach((child, offset) => {
    if (child.type.name === 'hardBreak') breaks.push(offset);
  });
  return breaks;
}

/**
 * The first and last of a block's lines that `from`–`to` (offsets in its
 * content) touches: the lines it covers a character of or that are empty
 * inside it, else the line or two it only reaches, as a caret does.
 */
function touchedLines(
  breaks: readonly number[],
  size: number,
  from: number,
  to: number,
): [number, number] {
  let next = 0;
  const lines = [...breaks, size].map((end) => {
    const line = [next, end] as const;
    next = end + 1;
    return line;
  });
  const covered = lines.flatMap(([start, end], index) =>
    (start < to && end > from) || (start === end && from < start && end < to)
      ? [index]
      : [],
  );
  const touched = covered.length
    ? covered
    : lines.flatMap(([start, end], index) =>
        start <= to && end >= from ? [index] : [],
      );
  return [touched[0] ?? 0, touched.at(-1) ?? 0];
}

/**
 * Turns the hard break at `at` into the end of `block` and the start of a
 * copy of it, in one step: a position just before the break stays in the
 * first block, one just after it moves to the start of the second.
 */
function splitAt(tr: Transaction, block: Node, at: number) {
  const ends = new Slice(Fragment.from([block.copy(), block.copy()]), 1, 1);
  tr.step(new ReplaceStep(at, at + 1, ends));
}

/**
 * Splits the textblocks between `from` and `to` at the hard breaks around the
 * lines the range touches (see `LineScope`).
 */
function isolateLines(
  tr: Transaction,
  from: number,
  to: number,
  scope: LineScope,
) {
  const blocks: { block: Node; start: number }[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    blocks.push({ block: node, start: pos + 1 });
    return false;
  });
  // Last to first, so the positions still to split are not moved.
  for (const { block, start } of blocks.reverse()) {
    const breaks = breaksOf(block);
    if (!breaks.length) continue;
    const size = block.content.size;
    const clamp = (pos: number) => Math.min(Math.max(pos - start, 0), size);
    const [first, last] = touchedLines(breaks, size, clamp(from), clamp(to));
    const cuts =
      scope === 'each'
        ? breaks.slice(Math.max(first - 1, 0), last + 1)
        : [breaks[first - 1], breaks[last]].filter((at) => at !== undefined);
    for (const at of cuts.reverse()) splitAt(tr, block, start + at);
  }
}

/**
 * The transaction a command or an input rule writes on. A command's state
 * reads the transaction's document and selection anew only when its `tr` is
 * read, so it is read again after every change made here: the command run
 * next sees the lines already cut out.
 */
function transactionOf(state: EditorState): Transaction {
  return state.tr;
}

/**
 * `command` on the selected lines cut out as `scope` says. When it changes
 * nothing after all (the style was there already), the lines go back as they
 * were. Whatever it changed stays even when it answers false, as Tiptap
 * dispatches a command's changes either way.
 */
function onLines(scope: LineScope, command: Command): Command {
  return (props) => {
    if (!props.dispatch) return command(props);
    const tr = transactionOf(props.state);
    const steps = tr.steps.length;
    isolateLines(tr, tr.selection.from, tr.selection.to, scope);
    transactionOf(props.state);
    const cut = tr.doc;
    const done = command(props);
    if (tr.doc.eq(cut)) {
      const before = tr.docs.slice(steps);
      const undo = tr.steps.slice(steps).flatMap((step, index) => {
        const doc = before[index];
        return doc ? [step.invert(doc)] : [];
      });
      for (const step of undo.reverse()) tr.step(step);
      transactionOf(props.state);
    }
    return done;
  };
}

/** `command` on the selected lines only while `on` is false for them. */
function turningOn(
  on: (props: CommandProps) => boolean,
  scope: LineScope,
  command: Command,
): Command {
  return (props) =>
    on(props) ? command(props) : onLines(scope, command)(props);
}

const inList = ({ state }: CommandProps) =>
  isActive(state, 'bulletList') || isActive(state, 'orderedList');

/**
 * Tiptap's `clearNodes`, which `setNode` falls back to when a block cannot
 * take a style where it stands (a list item's first line, a quoted line made
 * Text): the block leaves its list or quote and becomes a paragraph. Tiptap's
 * maps each position through every change the transaction made before it as
 * well as its own, so after lines are cut out it lands on the wrong node; this
 * one maps through its own changes only, and is the same where nothing came
 * before it.
 */
const clearNodes = (): Command => (props) => {
  const { tr, dispatch } = props;
  if (!dispatch) return true;
  const { doc, selection } = tr;
  const steps = tr.steps.length;
  for (const { $from, $to } of selection.ranges)
    doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.type.isText) return;
      const mapping = tr.mapping.slice(steps);
      const $start = tr.doc.resolve(mapping.map(pos));
      const $end = tr.doc.resolve(mapping.map(pos + node.nodeSize));
      const range = $start.blockRange($end);
      if (!range) return;
      const target = liftTarget(range);
      if (node.type.isTextblock) {
        const { defaultType } = $start.parent.contentMatchAt($start.index());
        tr.setNodeMarkup(range.start, defaultType);
      }
      if (target !== null) tr.lift(range, target);
    });
  transactionOf(props.state);
  return true;
};

/**
 * `rule` turning only the line it is typed on into its block: `# ` at the
 * start of a paragraph's first line makes that line the title, not the
 * paragraph.
 */
export function lineScoped(rule: InputRule): InputRule {
  return new InputRule({
    find: rule.find,
    undoable: rule.undoable,
    handler: (props) => {
      const tr = transactionOf(props.state);
      const steps = tr.steps.length;
      isolateLines(tr, props.range.from, props.range.from, 'each');
      transactionOf(props.state);
      const mapping = tr.mapping.slice(steps);
      const range: Range = {
        from: mapping.map(props.range.from),
        to: mapping.map(props.range.to),
      };
      return rule.handler({ ...props, range });
    },
  });
}

export interface LineScopedBlocksOptions {
  /** The title levels of the dialect: 1 (Titlu) and 2 (Subtitlu). */
  levels: number[];
}

/**
 * Titlu, Subtitlu, Text, Citat and the two lists, from every toolbar,
 * keyboard shortcut and line-start shortcut, on the touched lines only. It
 * overrides the commands of the same names (listed after StarterKit, its
 * commands win) and brings the line-start shortcuts of `# `, `## `, `> ` and
 * `- `, enabled in place of the Heading, Blockquote and BulletList ones
 * (`EDITOR_OPTIONS`). Turning a title or a list off leaves the lines as they
 * are: a list item's lines stay one item.
 */
export const LineScopedBlocks = Extension.create<LineScopedBlocksOptions>({
  name: 'lineScopedBlocks',

  addOptions() {
    return { levels: [1, 2] };
  },

  addCommands() {
    const { levels } = this.options;
    return {
      clearNodes,
      setParagraph: () => onLines('together', commands.setNode('paragraph')),
      setHeading: (attributes) => (props) =>
        levels.includes(attributes.level) &&
        turningOn(
          ({ state }) => isActive(state, 'heading', attributes),
          'each',
          commands.setNode('heading', attributes),
        )(props),
      toggleHeading: (attributes) => (props) =>
        levels.includes(attributes.level) &&
        turningOn(
          ({ state }) => isActive(state, 'heading', attributes),
          'each',
          commands.toggleNode('heading', 'paragraph', attributes),
        )(props),
      setBlockquote: () => onLines('together', commands.wrapIn('blockquote')),
      toggleBlockquote: () =>
        onLines('together', commands.toggleWrap('blockquote')),
      unsetBlockquote: () => onLines('together', commands.lift('blockquote')),
      toggleBulletList: () =>
        turningOn(
          inList,
          'each',
          commands.toggleList('bulletList', 'listItem', false),
        ),
      toggleOrderedList: () =>
        turningOn(
          inList,
          'each',
          commands.toggleList('orderedList', 'listItem', false),
        ),
    };
  },

  addInputRules() {
    const { heading, blockquote, bulletList } = this.editor.schema.nodes;
    if (!heading || !blockquote || !bulletList) return [];
    const lowest = Math.min(...this.options.levels);
    return [
      ...this.options.levels.map((level) =>
        lineScoped(
          textblockTypeInputRule({
            find: new RegExp(`^(#{${lowest},${level}})\\s$`),
            type: heading,
            getAttributes: { level },
          }),
        ),
      ),
      lineScoped(wrappingInputRule({ find: /^\s*>\s$/, type: blockquote })),
      lineScoped(
        wrappingInputRule({ find: /^\s*([-+*])\s$/, type: bulletList }),
      ),
    ];
  },
});

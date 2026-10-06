import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { cn } from 'cn';
import { FilterSearch } from '../../components/work-filter/FilterToolbar';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import {
  Sheet,
  SheetBackdrop,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPopup,
  SheetPortal,
  SheetTitle,
} from '../../components/ui/sheet';
import { commandErrorMessage } from '../../lib/command-reasons';
import { safeHexColor } from '../../lib/color';
import {
  LOCK_REASON,
  searchTree,
  selectedSummary,
  tickState,
  toggleNode,
  unselectAll,
  unselectedPayload,
  type PreferenceNode,
} from '../../lib/preferred-groups';
import { useSaveGroupPreferences } from '../../queries/group-preferences';

/** Past this many Groups the tree gets a search. */
export const SEARCH_FROM = 10;

/** The width of one tree level: the branch line sits in its middle. */
const LEVEL_PX = 20;

function TreeRow({
  node,
  unselected,
  onToggle,
  disabled,
}: {
  node: PreferenceNode;
  unselected: ReadonlySet<number>;
  onToggle: (node: PreferenceNode) => void;
  disabled: boolean;
}) {
  const state = tickState(node, unselected);
  const reasonId = `preferred-group-${node.group.id}-lock`;
  const name = node.group.is_organization ? 'OSUBB' : node.group.name;
  return (
    <li className="flex min-w-0 items-stretch">
      {/* The branch lines: one rule per level above, so a subgroup reads as
          hanging from its parent without any extra words. */}
      {Array.from({ length: node.depth }, (_, level) => (
        <span
          key={level}
          aria-hidden="true"
          data-slot="tree-guide"
          className="relative shrink-0 before:absolute before:inset-y-0 before:left-1/2 before:border-l before:border-border"
          style={{ width: LEVEL_PX }}
        />
      ))}
      <label
        className={cn(
          'flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/60 motion-reduce:transition-none',
          node.lock && 'cursor-default hover:bg-transparent',
        )}
      >
        <Checkbox
          checked={state === 'checked'}
          indeterminate={state === 'mixed'}
          disabled={disabled || node.lock !== null}
          aria-describedby={node.lock ? reasonId : undefined}
          onCheckedChange={() => onToggle(node)}
        />
        <span
          aria-hidden="true"
          className={cn(
            'size-2.5 shrink-0 rounded-full ring-2 ring-background',
            state === 'unchecked' && 'opacity-35',
          )}
          style={{
            backgroundColor: safeHexColor(
              node.group.color,
              node.group.is_organization
                ? 'var(--brand-red)'
                : 'var(--ink-400)',
            ),
          }}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              'truncate',
              node.depth === 0 && 'font-medium',
              state === 'unchecked' && 'text-muted-foreground',
            )}
          >
            {name}
          </span>
          {node.lock && (
            // Hidden from the label, so the Group alone names the box; the
            // box's description still reads it.
            <span
              id={reasonId}
              aria-hidden="true"
              className="truncate text-xs text-muted-foreground"
            >
              {LOCK_REASON[node.lock]}
            </span>
          )}
        </span>
        {node.lock && (
          <Lock
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        )}
      </label>
    </li>
  );
}

function SheetBody({
  nodes,
  initial,
  onClose,
  onSaved,
}: {
  nodes: readonly PreferenceNode[];
  initial: ReadonlySet<number>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [unselected, setUnselected] = useState(initial);
  const [search, setSearch] = useState('');
  const save = useSaveGroupPreferences();
  const shown = useMemo(() => searchTree(nodes, search), [nodes, search]);
  const summary = selectedSummary(nodes, unselected);
  const allOff = unselectAll(nodes);
  const changed =
    unselectedPayload(unselected).join() !== unselectedPayload(initial).join();
  const busy = save.isPending;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p
          role="status"
          className="m-0 mr-auto text-sm text-muted-foreground tabular-nums"
        >
          <span className="font-medium text-foreground">
            {summary.selected}
          </span>{' '}
          din {summary.total} selectate
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || unselected.size === 0}
          onClick={() => setUnselected(new Set())}
        >
          Selectează tot
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || [...allOff].every((id) => unselected.has(id))}
          onClick={() => setUnselected(new Set([...unselected, ...allOff]))}
        >
          Deselectează tot
        </Button>
      </div>
      {nodes.length > SEARCH_FROM && (
        <FilterSearch
          label="Caută un grup"
          placeholder="Caută un grup"
          className="sm:max-w-none"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}
      {shown.length ? (
        <ul aria-label="Grupuri" className="m-0 grid min-w-0 gap-0.5 p-0">
          {shown.map((node) => (
            <TreeRow
              key={node.group.id}
              node={node}
              unselected={unselected}
              disabled={busy}
              onToggle={(target) =>
                setUnselected(toggleNode(target, unselected))
              }
            />
          ))}
        </ul>
      ) : (
        <p className="m-0 py-4 text-sm text-muted-foreground">
          Niciun grup nu se potrivește căutării.
        </p>
      )}
      {save.isError && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {commandErrorMessage(
            save.error,
            'Nu am putut salva grupurile preferate. Încearcă din nou.',
          )}
        </p>
      )}
      <SheetFooter>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onClose}
        >
          Renunță
        </Button>
        <Button
          type="button"
          disabled={busy || !changed}
          onClick={() =>
            save.mutate(unselectedPayload(unselected), {
              onSuccess: () => {
                onSaved();
                onClose();
              },
            })
          }
        >
          {busy ? 'Se salvează…' : 'Salvează'}
        </Button>
      </SheetFooter>
    </>
  );
}

/**
 * **Grupuri preferate** (ruling R43): the Group tree with a box per Group.
 * Unticking a Group unticks its subgroups; a subgroup can be unticked on its
 * own, and its parent then shows a mixed box. OSUBB, the Adunarea Generală,
 * Biroul de Conducere and every Group where the member holds a position stay
 * ticked, with a lock and one line saying why. Nothing is written until
 * **Salvează**, in one request; **Renunță** leaves everything as it was.
 */
export function PreferredGroupsSheet({
  open,
  nodes,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  nodes: readonly PreferenceNode[];
  initial: ReadonlySet<number>;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetPortal>
        <SheetBackdrop />
        <SheetPopup side="right" className="max-w-md gap-4 p-4 sm:p-6">
          <SheetHeader>
            <SheetTitle>Grupuri preferate</SheetTitle>
            <SheetDescription>
              Grupurile debifate nu îți mai trimit notificări și nu apar când
              deschizi Taskuri, Calendar, Anunțuri sau Clasament. Debifând un
              grup, debifezi și subgrupurile lui.
            </SheetDescription>
          </SheetHeader>
          {open && (
            <SheetBody
              nodes={nodes}
              initial={initial}
              onClose={onClose}
              onSaved={onSaved}
            />
          )}
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}

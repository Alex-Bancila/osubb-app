import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Panel } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { Button } from '../../components/ui/button';
import { formatTaskCount } from '../../lib/format';
import { useInView } from '../../lib/use-in-view';
import type { FinishedTasks } from '../../queries/task-lists';
import type { FinishedPart } from './finished-part';

/** The element that scrolls `element`: the shell's, or the document's. */
function scrollerOf(element: Element): Element {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      node.scrollHeight > node.clientHeight
    )
      return node;
  }
  return document.scrollingElement ?? document.documentElement;
}

/**
 * A Tracker list's finished part (`useFinishedPart`), under its open Tasks:
 * its loading and retry states, then **Taskuri încheiate** with how many the
 * filters match, `children` (the list's own rows for `finished.rows`), and
 * the end of the list — coming into view, it asks for the next page; the
 * **Încarcă mai multe** button does the same for a keyboard. A later page
 * that fails keeps what is read and offers its retry. De gestionat, Toate
 * and Taskurile mele draw it alike. Past a full window (`useFinishedPart`,
 * #1147) the end of the list asks for nothing by itself: the button moves
 * the window on, and **Arată taskurile anterioare** above the rows moves it
 * back.
 */
export function FinishedTasksPanel({
  finished,
  children,
}: {
  finished: FinishedTasks & Partial<Omit<FinishedPart, keyof FinishedTasks>>;
  children: ReactNode;
}) {
  // Armed only while nothing is read: not during the next page, nor while
  // the loaded pages are read again after a change, nor once the window is
  // full. Re-armed when that lands, it asks at once if the end is still in
  // view.
  // Back at the first rows, the button that brought them is gone: focus
  // moves to the rows rather than falling to the page.
  const earlierButton = useRef<HTMLButtonElement>(null);
  const shownRows = useRef<HTMLDivElement>(null);
  const showEarlier = () => {
    flushSync(() => finished.showEarlier?.());
    if (!earlierButton.current) shownRows.current?.focus();
  };
  // Moving a full window on drops its first page above the button. Where
  // the browser anchors the scroll nothing moves; where it does not
  // (Safari) the button is put back where it was pressed.
  const moreButton = useRef<HTMLButtonElement>(null);
  const pressedAt = useRef<number | null>(null);
  const earlier = finished.earlier ?? 0;
  const lastEarlier = useRef(earlier);
  useLayoutEffect(() => {
    const moved = earlier > lastEarlier.current;
    lastEarlier.current = earlier;
    const before = pressedAt.current;
    const button = moreButton.current;
    if (!moved || before === null || !button) return;
    pressedAt.current = null;
    const shift = button.getBoundingClientRect().top - before;
    if (shift !== 0) scrollerOf(button).scrollTop += shift;
  }, [earlier]);
  const loadMore = () => {
    pressedAt.current = moreButton.current?.getBoundingClientRect().top ?? null;
    finished.loadMore();
  };
  const sentinel = useInView(
    finished.loadMore,
    finished.hasMore &&
      !finished.isLoadingMore &&
      !finished.isFetching &&
      !finished.moreFailed &&
      !finished.full,
  );
  return (
    <>
      {finished.isPending && (
        <Loading label="Se încarcă taskurile încheiate…" />
      )}
      {finished.isError && (
        <ErrorState
          error={finished.error}
          text="Nu am putut încărca taskurile încheiate."
          onRetry={finished.refetch}
        />
      )}
      {finished.rows.length > 0 && (
        <Panel
          bare
          title="Taskuri încheiate"
          control={
            finished.total !== undefined && (
              <p className="text-sm text-muted-foreground tabular-nums">
                {formatTaskCount(finished.total)}
              </p>
            )
          }
        >
          {(finished.earlier ?? 0) > 0 && (
            <div className="flex justify-center pb-2">
              <Button
                ref={earlierButton}
                variant="outline"
                onClick={showEarlier}
              >
                Arată taskurile anterioare
              </Button>
            </div>
          )}
          <div ref={shownRows} tabIndex={-1} className="outline-none">
            {children}
          </div>
          {/* The next page holds its place under the rows read so far. */}
          {finished.isLoadingMore && (
            <Loading label="Se încarcă mai multe taskuri…" />
          )}
          {finished.moreFailed ? (
            <ErrorState
              text="Nu am putut încărca mai multe taskuri."
              onRetry={finished.loadMore}
            />
          ) : (
            finished.hasMore && (
              <div ref={sentinel} className="flex justify-center pt-2">
                <Button
                  ref={moreButton}
                  variant="outline"
                  disabled={finished.isLoadingMore}
                  onClick={loadMore}
                >
                  {finished.isLoadingMore ? 'Se încarcă…' : 'Încarcă mai multe'}
                </Button>
              </div>
            )
          )}
        </Panel>
      )}
    </>
  );
}

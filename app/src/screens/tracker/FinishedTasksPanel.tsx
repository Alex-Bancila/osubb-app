import type { ReactNode } from 'react';
import { Panel } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { Button } from '../../components/ui/button';
import { formatTaskCount } from '../../lib/format';
import { useInView } from '../../lib/use-in-view';
import type { FinishedTasks } from '../../queries/task-lists';

/**
 * A Tracker list's finished part (`useFinishedPart`), under its open Tasks:
 * its loading and retry states, then **Taskuri încheiate** with how many the
 * filters match, `children` (the list's own rows for `finished.rows`), and
 * the end of the list — coming into view, it asks for the next page; the
 * **Încarcă mai multe** button does the same for a keyboard. A later page
 * that fails keeps what is read and offers its retry. De gestionat, Toate
 * and Taskurile mele draw it alike.
 */
export function FinishedTasksPanel({
  finished,
  children,
}: {
  finished: FinishedTasks;
  children: ReactNode;
}) {
  // Armed only while nothing is read: not during the next page, nor while
  // the first page is read again after a change. Re-armed when that lands,
  // it asks at once if the end is still in view.
  const sentinel = useInView(
    finished.loadMore,
    finished.hasMore &&
      !finished.isLoadingMore &&
      !finished.isFetching &&
      !finished.moreFailed,
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
          {children}
          {finished.moreFailed ? (
            <ErrorState
              text="Nu am putut încărca mai multe taskuri."
              onRetry={finished.loadMore}
            />
          ) : (
            finished.hasMore && (
              <div ref={sentinel} className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  disabled={finished.isLoadingMore}
                  onClick={finished.loadMore}
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

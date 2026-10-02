import { useRef, useState } from 'react';
import {
  SEND_BATCH_LIMIT,
  SEND_FAILED,
  type SendResult,
} from '../../queries/volunteer-import';

/** Where one Member stands in a sending run. */
export type RowSendState =
  | { status: 'pending' }
  | { status: 'sending' }
  | { status: 'sent'; invitedAt: string }
  | { status: 'skipped'; message: string }
  | { status: 'error'; message: string }
  | { status: 'rate_limited' };

/**
 * The run as a whole: `paused` after "Pune pe pauză" or a failed batch,
 * `rate_limited` when Auth's email limit stopped it, `done` when nothing is
 * left to send.
 */
export type RunStatus = 'idle' | 'sending' | 'paused' | 'rate_limited' | 'done';

/** The sizes offered; the sender takes at most `SEND_BATCH_LIMIT` a call. */
export const BATCH_SIZES = [10, 25, SEND_BATCH_LIMIT] as const;
export const DEFAULT_BATCH_SIZE = SEND_BATCH_LIMIT;

type SendBatch = (memberIds: readonly string[]) => Promise<SendResult>;

const NOT_SENT = 'Invitația nu a plecat.';

/** The Members still to send in this run: never tried, or stopped by the limit. */
function remaining(
  order: readonly string[],
  rows: ReadonlyMap<string, RowSendState>,
) {
  return order.filter((id) => {
    const status = rows.get(id)?.status;
    return status === 'pending' || status === 'rate_limited';
  });
}

/** One Member's answer as the row shows it. */
function rowState(
  row: SendResult['results'][number] | undefined,
): RowSendState {
  switch (row?.status) {
    case 'sent':
      return {
        status: 'sent',
        invitedAt: row.invitedAt ?? new Date().toISOString(),
      };
    case 'skipped':
      return { status: 'skipped', message: row.message ?? 'Nimic de trimis.' };
    case 'failed':
      return { status: 'error', message: row.message ?? NOT_SENT };
    case 'rate_limited':
      return { status: 'rate_limited' };
    // After a stop, or not answered at all: still to send.
    default:
      return { status: 'pending' };
  }
}

/**
 * "Trimite invitațiile" (#992): sends to a list of Members one batch at a time
 * through `send-invitations` (#991), which stamps `invited_at` per sent
 * Member. Pausing takes effect between batches — a batch already sent cannot
 * be called back. A rate-limit answer stops the run where the sender stopped;
 * "Reia" continues with everyone not yet sent. Members the sender did not
 * reach within its own time budget go back to the front of the queue. A batch
 * that fails outright marks its Members as errors and pauses, so a dead
 * connection does not burn through the list.
 */
export function useInvitationSender(send: SendBatch) {
  const [rows, setRows] = useState<ReadonlyMap<string, RowSendState>>(
    () => new Map(),
  );
  const [order, setOrder] = useState<readonly string[]>([]);
  const [status, setStatus] = useState<RunStatus>('idle');
  const [batchSize, setBatchSize] = useState<number>(DEFAULT_BATCH_SIZE);
  const [failure, setFailure] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);
  // The loop reads these between awaits; state would be a render behind.
  const pauseRequested = useRef(false);
  const running = useRef(false);
  const rowsRef = useRef(rows);

  function update(changes: Iterable<[string, RowSendState]>) {
    const next = new Map(rowsRef.current);
    for (const [id, state] of changes) next.set(id, state);
    rowsRef.current = next;
    setRows(next);
  }

  async function run(ids: readonly string[], size: number) {
    if (running.current) return;
    running.current = true;
    pauseRequested.current = false;
    setPausing(false);
    setFailure(null);
    setStatus('sending');
    const queue = [...ids];
    try {
      while (queue.length > 0) {
        if (pauseRequested.current) {
          setStatus('paused');
          return;
        }
        const batch = queue.splice(0, size);
        update(batch.map((id) => [id, { status: 'sending' }]));
        let result: SendResult;
        try {
          result = await send(batch);
        } catch (error) {
          const message =
            error instanceof Error && error.message
              ? error.message
              : SEND_FAILED;
          update(batch.map((id) => [id, { status: 'error', message }]));
          setFailure(message);
          setStatus('paused');
          return;
        }
        const answered = new Map(
          result.results.map((row) => [row.memberId, row]),
        );
        const states = batch.map((id): [string, RowSendState] => [
          id,
          rowState(answered.get(id)),
        ]);
        update(states);
        if (result.rateLimited) {
          setStatus('rate_limited');
          return;
        }
        const unsent = states
          .filter(([, state]) => state.status === 'pending')
          .map(([id]) => id);
        // Nobody in a whole batch reached: stop rather than loop forever.
        if (unsent.length === batch.length) {
          update(
            unsent.map((id) => [id, { status: 'error', message: NOT_SENT }]),
          );
          setStatus('paused');
          return;
        }
        queue.unshift(...unsent);
      }
      setStatus('done');
    } finally {
      running.current = false;
    }
  }

  /** Starts a run over `memberIds` (in this order), forgetting the last one. */
  function start(memberIds: readonly string[]) {
    const fresh = new Map<string, RowSendState>(
      memberIds.map((id) => [id, { status: 'pending' }]),
    );
    // Members sent in an earlier run keep their "trimis" until they leave.
    for (const [id, state] of rowsRef.current)
      if (state.status === 'sent' && !fresh.has(id)) fresh.set(id, state);
    rowsRef.current = fresh;
    setRows(fresh);
    setOrder(memberIds);
    void run(memberIds, batchSize);
  }

  function pause() {
    pauseRequested.current = true;
    setPausing(true);
  }

  function resume() {
    void run(remaining(order, rowsRef.current), batchSize);
  }

  const states = order.map((id) => rows.get(id)?.status);
  const count = (wanted: RowSendState['status']) =>
    states.filter((state) => state === wanted).length;
  return {
    rows,
    status,
    batchSize,
    setBatchSize,
    failure,
    total: order.length,
    sent: count('sent'),
    skipped: count('skipped'),
    failed: count('error'),
    left: remaining(order, rows).length,
    /** "Pune pe pauză" was pressed; the batch in flight still finishes. */
    pausing: status === 'sending' && pausing,
    start,
    pause,
    resume,
  };
}

/**
 * The receipt a give-up leaves (Audit D-3). Only a public Task has a queue
 * to choose from; a direct Task's manager just picks someone (F-13).
 */
export function gaveUpReceipt(assignmentMode: 'direct' | 'public' | null) {
  return assignmentMode === 'public'
    ? 'Ai renunțat la task. Taskul revine la „De făcut”; managerul alege alt executor din coadă.'
    : 'Ai renunțat la task. Taskul revine la „De făcut”; managerul alege alt executor.';
}

/** Tells the list which Task was given up and the receipt to show for it. */
export type OnGaveUp = (taskId: number, receipt: string) => void;

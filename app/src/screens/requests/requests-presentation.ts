/**
 * How many Completed-work Requests wait for the viewer's decision, in words
 * for the badge's screen-reader label (#972): the Taskuri entry carries the
 * count the way Notificări and Anunțuri carry theirs.
 */
export function decisionsBadgeLabel(count: number): string {
  return count === 1 ? '1 cerere de decis' : `${count} cereri de decis`;
}

/** `3 cereri de aprobare` — the request icon's accessible name, in words. */
export function approvalRequestsLabel(count: number): string {
  if (count === 1) return '1 cerere de aprobare';
  // Romanian counts from twenty with "de".
  return count >= 20
    ? `${count} de cereri de aprobare`
    : `${count} cereri de aprobare`;
}

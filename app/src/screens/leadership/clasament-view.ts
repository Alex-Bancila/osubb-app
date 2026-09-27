import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';

/** Where this device remembers the Clasament's board (the `theme.ts` pattern). */
export const CLASAMENT_VIEW_STORAGE_KEY = 'osubb-clasament-view';

/** The query-string key and the value that shows the Cup (#823, R27). */
export const CLASAMENT_VIEW_KEY = 'vedere';
export const CUP_VIEW_VALUE = 'cupa';

/** **Clasament** (the members' board) or **Cupa Departamentelor**. */
export type ClasamentView = 'members' | 'cup';

/**
 * The remembered board, the members' Clasament when nothing (or nothing
 * valid) is stored. Storage may be unavailable (private mode, disabled): then
 * nothing is remembered and nothing breaks.
 */
export function readClasamentView(): ClasamentView {
  try {
    return localStorage.getItem(CLASAMENT_VIEW_STORAGE_KEY) === 'cup'
      ? 'cup'
      : 'members';
  } catch {
    return 'members';
  }
}

export function writeClasamentView(view: ClasamentView): void {
  try {
    localStorage.setItem(CLASAMENT_VIEW_STORAGE_KEY, view);
  } catch {
    // Storage write failed: the choice lasts for this visit only.
  }
}

/**
 * The board Clasament shows. The URL decides first — `?vedere=cupa` is the
 * Cup, so a reload, Back and a shared link keep it — and a URL without the
 * key shows the board this device chose last (the members' board on a first
 * visit). Choosing writes both: the URL (replacing the history entry, like
 * the Work Filter, whose keys it keeps) and this device's memory.
 */
export function useClasamentView() {
  const [params, setParams] = useSearchParams();
  const [remembered, setRemembered] =
    useState<ClasamentView>(readClasamentView);
  const raw = params.get(CLASAMENT_VIEW_KEY);
  const view: ClasamentView =
    raw === CUP_VIEW_VALUE ? 'cup' : raw === null ? remembered : 'members';
  const choose = useCallback(
    (next: ClasamentView) => {
      writeClasamentView(next);
      setRemembered(next);
      setParams(
        (current) => {
          const nextParams = new URLSearchParams(current);
          if (next === 'cup')
            nextParams.set(CLASAMENT_VIEW_KEY, CUP_VIEW_VALUE);
          else nextParams.delete(CLASAMENT_VIEW_KEY);
          return nextParams;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [view, choose] as const;
}

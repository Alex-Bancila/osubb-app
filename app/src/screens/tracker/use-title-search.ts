import { useEffect, useMemo, useState } from 'react';
import { searchableTitle } from './manager-task-list';

const SEARCH_DELAY_MS = 200;

/**
 * The Tracker's title search: one text for the four Task lists, so what was
 * typed stays when the tab changes.
 */
export type TitleSearch = {
  /** What the field shows. */
  text: string;
  /** What the lists match: folded for case and diacritics, a short pause behind `text`. */
  needle: string;
  setText: (text: string) => void;
  /** Empties the field and the lists' match at once. */
  clear: () => void;
};

export function useTitleSearch(): TitleSearch {
  const [text, setText] = useState('');
  const [needle, setNeedle] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(
      () => setNeedle(searchableTitle(text.trim())),
      SEARCH_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [text]);
  return useMemo(
    () => ({
      text,
      needle,
      setText,
      clear: () => {
        setText('');
        setNeedle('');
      },
    }),
    [text, needle],
  );
}

/** Whether a title holds the search's `needle`; an empty search matches all. */
export function matchesTitle(title: string, needle: string): boolean {
  return !needle || searchableTitle(title).includes(needle);
}

/**
 * Finding a Member by name (#1100). A Member is shown by their Nickname when
 * they have one (R5), so a search that only read the shown name could not find
 * them by the real one, nor the reverse: every Member search matches both.
 */

/** Case- and diacritic-blind, so "stefan" finds "Ștefan". */
export function normalizeSearch(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('ro');
}

/** The text a Member's name is searched through: Nickname and full name. */
export function memberSearchText(
  nickname: string | null | undefined,
  fullName: string,
): string {
  return normalizeSearch(`${nickname?.trim() ?? ''} ${fullName}`);
}

/** Does `query` appear in the Member's Nickname or full name? */
export function matchesMemberSearch(
  query: string,
  nickname: string | null | undefined,
  fullName: string,
  /** Further words the picker also searches through, e.g. a Role. */
  ...extra: Array<string | null | undefined>
): boolean {
  const needle = normalizeSearch(query.trim());
  if (!needle) return true;
  const haystack = [memberSearchText(nickname, fullName)]
    .concat(extra.map((text) => normalizeSearch(text ?? '')))
    .join(' ');
  return haystack.includes(needle);
}

/**
 * The `filter` of a member Combobox. Base UI otherwise filters on the item's
 * label, which is the Nickname or the full name, never both. The label shown
 * stays as it is; only what typing matches changes.
 */
export function memberComboboxFilter<Item>(
  searchableNames: (item: Item) => {
    nickname?: string | null;
    fullName: string;
    extra?: Array<string | null | undefined>;
  },
) {
  return (item: Item, query: string) => {
    const { nickname, fullName, extra = [] } = searchableNames(item);
    return matchesMemberSearch(query, nickname, fullName, ...extra);
  };
}

import { createContext } from 'react';

/**
 * True inside a `PageGrid` with `equalHeights`: the `Panel` that is a cell
 * (or the one card inside a cell's `li`) fills the row, and its box grows to
 * the tallest box. Each `Panel` resets it to `false` for its own children, so
 * a panel nested in a stretched one keeps to its content.
 */
export const PageGridFillContext = createContext(false);

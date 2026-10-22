import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// The Formatted Text editor (ProseMirror) measures where a press lands and
// scrolls its selection into view; jsdom lays nothing out and has neither
// `elementFromPoint` nor a range's geometry, so they find nothing. (A file
// in the node environment has no document at all.)
if (typeof document !== 'undefined') {
  if (typeof document.elementFromPoint !== 'function')
    document.elementFromPoint = () => null;
  for (const name of ['getClientRects', 'getBoundingClientRect'] as const)
    if (!(name in Range.prototype))
      Object.defineProperty(Range.prototype, name, {
        configurable: true,
        value: name === 'getClientRects' ? () => [] : () => DOMRect.fromRect(),
      });
}

// The ten Difficulty levels are reference data every Difficulty display reads
// (#986); tests get the migration's rows without a request. A test that needs
// the loading or error state mocks the module itself.
vi.mock('../queries/difficulty-levels', async () => {
  const { difficultyLevelsFixture } =
    await import('./difficulty-levels-fixture');
  return {
    useDifficultyLevels: () => ({
      data: difficultyLevelsFixture,
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: () => Promise.resolve(),
    }),
  };
});

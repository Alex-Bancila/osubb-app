import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

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

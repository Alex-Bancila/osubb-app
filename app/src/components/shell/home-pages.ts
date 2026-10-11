import { createContext } from 'react';

/**
 * The paths of the pages a phone reaches only from Acasă's tiles, for this
 * viewer (`navFor(...).elsewhere`). The shell provides it; outside the shell
 * there are none.
 */
export const HomePagesContext = createContext<readonly string[]>([]);

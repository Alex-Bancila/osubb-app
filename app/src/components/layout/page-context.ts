import { createContext, useContext } from 'react';

/** The id `Page` labels itself with; `PageHeader` puts it on the `h1`. */
export const PageTitleContext = createContext<string | undefined>(undefined);

export function usePageTitleId(): string | undefined {
  return useContext(PageTitleContext);
}

import { useLocation, useNavigationType } from 'react-router';

/**
 * Where the router is: the path and the query, and how it got there
 * (`data-navigation` is PUSH, REPLACE or POP). Mount it beside a screen to read
 * its URL, or as the page a link leads to.
 */
export function Where() {
  const { pathname, search } = useLocation();
  return (
    <div data-testid="where" data-navigation={useNavigationType()}>
      {pathname + search}
    </div>
  );
}

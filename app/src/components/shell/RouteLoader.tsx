import { Loading } from '../states';

/**
 * While a page's code is still on its way (a lazy route): the page's shape —
 * a title and its rows — where the page will be, as every list shows its own
 * rows while they load, never a spinner on an empty page.
 */
export function RouteLoader() {
  return (
    <div className="page">
      <Loading variant="page" label="Se încarcă pagina" />
    </div>
  );
}

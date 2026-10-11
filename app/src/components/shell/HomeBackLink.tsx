import { useContext } from 'react';
import { useLocation } from 'react-router';
import { BackLink } from '../layout';
import { HomePagesContext } from './home-pages';

/**
 * The way back to Acasă on a page a phone reaches only from Acasă's tiles
 * (Clasament, Voluntari, Campanii, and Grupuri when Administrare took its
 * tab): the bar marks Acasă as the place this page is under, and this link
 * is the step back. Nothing on a page that has its own tab, nor from `lg`,
 * where the sidebar lists every page.
 */
export function HomeBackLink() {
  const homePages = useContext(HomePagesContext);
  // Outside the shell there are none, and there may be no router either.
  if (!homePages.length) return null;
  return <HomeBackLinkOn paths={homePages} />;
}

function HomeBackLinkOn({ paths }: { paths: readonly string[] }) {
  const { pathname } = useLocation();
  if (!paths.includes(pathname)) return null;
  return <BackLink to="/" label="Acasă" className="lg:hidden" />;
}

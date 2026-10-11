import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { HomeBackLink } from './HomeBackLink';
import { HomePagesContext } from './home-pages';

function renderAt(path: string, homePages?: string[]) {
  const link = <HomeBackLink />;
  return render(
    <MemoryRouter initialEntries={[path]}>
      {homePages ? (
        <HomePagesContext.Provider value={homePages}>
          {link}
        </HomePagesContext.Provider>
      ) : (
        link
      )}
    </MemoryRouter>,
  );
}

describe('HomeBackLink', () => {
  it('leads back to Acasă from a page a phone reaches from its tiles', () => {
    renderAt('/clasament', ['/clasament', '/voluntari']);
    const back = screen.getByRole('link', { name: 'Acasă' });
    expect(back).toHaveAttribute('href', '/');
    // The sidebar lists every page from `lg`.
    expect(back).toHaveClass('lg:hidden');
  });

  it('is not drawn on a page that has its own tab', () => {
    renderAt('/grupuri', ['/clasament']);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('is not drawn outside the shell', () => {
    renderAt('/clasament');
    expect(screen.queryByRole('link')).toBeNull();
  });
});

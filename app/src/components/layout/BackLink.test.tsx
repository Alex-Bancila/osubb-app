import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { BackLink } from './BackLink';
import { backLinkState, readBackLinkState } from './back-link-state';
import { Page } from './Page';
import { PageHeader } from './PageHeader';

function at(state?: unknown) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/tracker/membru/m-1', state }]}>
      <Page>
        <BackLink to="/clasament" label="Înapoi la clasament" />
        <PageHeader title="Trackerul membrului" />
      </Page>
    </MemoryRouter>,
  );
  return screen.getByRole('link');
}

describe('BackLink', () => {
  it("goes to the page's own parent without state", () => {
    const link = at();
    expect(link).toHaveAccessibleName('Înapoi la clasament');
    expect(link).toHaveAttribute('href', '/clasament');
  });

  it('prefers location.state.from over its props (D10)', () => {
    const link = at(
      backLinkState({ pathname: '/voluntari', search: '?grup=8' }),
    );
    expect(link).toHaveAccessibleName('Înapoi');
    expect(link).toHaveAttribute('href', '/voluntari?grup=8');
  });

  it('keeps the search and the hash of where the member came from', () => {
    expect(
      backLinkState(
        { pathname: '/tracker', search: '?lista=gestionat', hash: '#task-12' },
        'Înapoi la Taskuri',
      ),
    ).toEqual({
      from: {
        to: '/tracker?lista=gestionat#task-12',
        label: 'Înapoi la Taskuri',
      },
    });
  });

  it('ignores a state.from that is not an in-app path', () => {
    for (const to of ['https://evil.example', '//evil.example', 'clasament'])
      expect(readBackLinkState({ from: { to, label: 'Înapoi' } })).toBeNull();
    expect(readBackLinkState({ from: { to: '/x', label: ' ' } })).toBeNull();
    expect(readBackLinkState(null)).toBeNull();
    expect(readBackLinkState({ from: '/x' })).toBeNull();
  });

  it('is one style: muted, an arrow, a 44 px target, a visible focus ring, tight above the header (X16)', () => {
    const link = at();
    expect(link).toHaveClass(
      'min-h-11',
      'text-muted-foreground',
      'self-start',
      'focus-visible:outline-solid',
      '[[data-slot=page]>&]:-mb-3',
    );
    expect(link.querySelector('svg')).not.toBeNull();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Page } from './Page';
import { PageHeader } from './PageHeader';

describe('Page', () => {
  it('is one frame: 16 px gutter, 24 px from md, the wide width by default', () => {
    render(
      <Page>
        <PageHeader title="Taskuri" />
      </Page>,
    );
    const page = screen.getByRole('region', { name: 'Taskuri' });
    expect(page).toHaveClass(
      'mx-auto',
      'w-full',
      'min-w-0',
      'px-4',
      'py-4',
      'md:px-6',
      'md:py-6',
      'max-w-(--content-max)',
    );
    expect(page).not.toHaveClass('max-w-3xl');
  });

  it('stacks its blocks with a flex gap, so a child m-0 cannot cancel it (X2)', () => {
    render(
      <Page>
        <PageHeader title="Membru" />
        <dl className="m-0">
          <dt>Rol</dt>
          <dd>Voluntar</dd>
        </dl>
        <section aria-label="Cont">Cont</section>
      </Page>,
    );
    const page = screen.getByRole('region', { name: 'Membru' });
    expect(page).toHaveClass('flex', 'flex-col', 'gap-6');
    expect(page.className).not.toMatch(/space-y-/);
  });

  it('narrows to the reading width', () => {
    render(
      <Page width="reading">
        <PageHeader title="Anunțuri" />
      </Page>,
    );
    const page = screen.getByRole('region', { name: 'Anunțuri' });
    expect(page).toHaveClass('max-w-3xl');
    expect(page).not.toHaveClass('max-w-(--content-max)');
  });
});

describe('PageHeader', () => {
  it('shows an eyebrow only when the page names its section (ruling 2)', () => {
    const { rerender } = render(
      <Page>
        <PageHeader title="Taskuri" />
      </Page>,
    );
    expect(document.querySelector('[data-slot="page-eyebrow"]')).toBeNull();
    expect(screen.queryByText('OSUBB')).toBeNull();
    rerender(
      <Page>
        <PageHeader eyebrow="Calendar" title="Agendă" />
      </Page>,
    );
    expect(screen.getByText('Calendar')).toHaveAttribute(
      'data-slot',
      'page-eyebrow',
    );
  });

  it('renders one h1 at the page-title size, the description and the actions slot', () => {
    render(
      <Page>
        <PageHeader
          title="Taskuri"
          description="Lucrul tău și oportunitățile din OSUBB."
          actions={<button type="button">Task nou</button>}
        />
      </Page>,
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'Taskuri' });
    expect(heading).toHaveClass(
      'text-[length:var(--fs-xl)]',
      'md:text-[length:var(--fs-2xl)]',
      'font-extrabold',
    );
    expect(
      screen.getByText('Lucrul tău și oportunitățile din OSUBB.'),
    ).toBeInTheDocument();
    const actions = screen
      .getByRole('button', { name: 'Task nou' })
      .closest('[data-slot="page-actions"]');
    // Full width and stacked under 640 px, on the right from 640 px.
    expect(actions).toHaveClass('w-full', 'sm:w-auto');
    const header = heading.closest('header');
    expect(header).toHaveClass('flex-col', 'sm:flex-row');
    // The Page's gap spaces it; a margin of its own would double it.
    expect(header?.className).not.toMatch(/mb-/);
  });
});

import { render, screen } from '@testing-library/react';
import { ListChecks } from 'lucide-react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Panel } from './Panel';
import { SectionHeader } from './SectionHeader';

describe('Panel', () => {
  it('renders its header above one box with the panel padding and radius', () => {
    render(
      <Panel eyebrow="Filtre" title="Filtrează taskurile">
        <p>Conținut</p>
      </Panel>,
    );
    const panel = screen.getByRole('region', { name: 'Filtrează taskurile' });
    const [header, box] = Array.from(panel.children);
    expect(header).toHaveAttribute('data-slot', 'section-header');
    expect(box).toHaveAttribute('data-slot', 'panel-box');
    expect(box).toContainElement(screen.getByText('Conținut'));
    expect(header).not.toContainElement(screen.getByText('Conținut'));
    // 16 px at every width, --r-md, never rounded-xl.
    expect(box).toHaveClass(
      'flex-1',
      'rounded-md',
      'border',
      'bg-card',
      'p-4',
      'shadow-(--sh-sm)',
    );
    expect(box).not.toHaveClass('rounded-xl');
    expect(box?.className).not.toMatch(/\b(md|lg|sm):p-/);
    expect(panel).toHaveClass('flex', 'h-full', 'flex-col');
  });

  it('bare renders no box, for a child that is itself a card', () => {
    const { container } = render(
      <Panel title="Următorul task" bare>
        <article>Card</article>
      </Panel>,
    );
    expect(container.querySelector('[data-slot="panel-box"]')).toBeNull();
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it('takes an accessible name when it has only an eyebrow', () => {
    render(
      <Panel eyebrow="Filtre" aria-label="Filtre taskuri">
        x
      </Panel>,
    );
    expect(
      screen.getByRole('region', { name: 'Filtre taskuri' }),
    ).toBeInTheDocument();
  });
});

describe('SectionHeader', () => {
  it('renders the title at the heading level asked for', () => {
    const { rerender } = render(<SectionHeader title="Coordonare" />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Coordonare' }),
    ).toHaveClass('text-[length:var(--fs-lg)]', 'font-bold');
    rerender(<SectionHeader title="Coordonare" level={3} />);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Coordonare' }),
    ).toBeInTheDocument();
  });

  it('leads the eyebrow with a red icon and renders the action as a 44 px link', () => {
    const { container } = render(
      <MemoryRouter>
        <SectionHeader
          eyebrow="Taskuri"
          icon={ListChecks}
          title="De evaluat"
          action={{ label: 'Vezi toate', to: '/tracker' }}
        />
      </MemoryRouter>,
    );
    const eyebrow = screen.getByText('Taskuri');
    expect(eyebrow).toHaveClass('uppercase', 'font-extrabold');
    expect(eyebrow.querySelector('svg')).toHaveClass(
      'size-4',
      'text-(--red-600)',
    );
    const link = screen.getByRole('link', { name: 'Vezi toate' });
    expect(link).toHaveAttribute('href', '/tracker');
    expect(link).toHaveClass('min-h-11', 'min-w-11', 'text-sm', 'font-bold');
    expect(link.querySelector('svg')).not.toBeNull();
    // The header keeps one height with or without an action.
    expect(container.querySelector('[data-slot="section-header"]')).toHaveClass(
      'min-h-11',
      'mb-3',
    );
  });

  it('renders a control on the right instead of a link', () => {
    render(
      <SectionHeader
        title="Campanii"
        control={<button type="button">Campanie nouă</button>}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Campanie nouă' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Calendar, Home, ListTodo, Megaphone, ShieldCheck } from 'lucide-react';
import { TabBar } from './TabBar';
import type { NavItem } from './navItems';

const tabs: NavItem[] = [
  { path: '/tracker', label: 'Taskuri', icon: ListTodo },
  { path: '/calendar', label: 'Calendar', icon: Calendar },
  { path: '/', label: 'Acasă', icon: Home },
  { path: '/anunturi', label: 'Anunțuri', icon: Megaphone },
  {
    path: '/administrare',
    label: 'Administrare',
    shortLabel: 'Admin',
    icon: ShieldCheck,
  },
];

/** jsdom lays nothing out: the track's overflow is whatever the test says. */
function trackOverflows(by: number) {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(300);
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(300 + by);
}
afterEach(() => vi.restoreAllMocks());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TabBar tabs={tabs} badges={{}} />
    </MemoryRouter>,
  );
}
const track = () =>
  screen.getByRole('navigation', { name: 'Navigare rapidă' })
    .firstElementChild as HTMLElement;

describe('the phone bar: fit first, scroll last', () => {
  it("spells the current tab's full name when the five fit", () => {
    trackOverflows(0);
    renderAt('/administrare');
    expect(screen.getByRole('link', { name: 'Administrare' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText('Administrare')).toBeVisible();
    expect(track()).toHaveClass(
      'overflow-x-auto',
      'overflow-y-hidden',
      '[scrollbar-width:none]',
    );
  });
  it('falls back to the short name when the full one overflows the track', () => {
    trackOverflows(40);
    renderAt('/administrare');
    expect(screen.getByText('Admin')).toBeVisible();
    expect(screen.queryByText('Administrare')).toBeNull();
  });
  it('keeps the short name and lets the bar scroll when even that overflows', () => {
    trackOverflows(400);
    renderAt('/administrare');
    expect(screen.getByText('Admin')).toBeVisible();
  });
  it('shows a short name only to the current tab: a page outside the five changes nothing', () => {
    trackOverflows(400);
    expect(() => renderAt('/profil')).not.toThrow();
    for (const name of [
      'Taskuri',
      'Calendar',
      'Acasă',
      'Anunțuri',
      'Administrare',
    ])
      expect(screen.getByRole('link', { name })).not.toHaveAttribute(
        'aria-current',
      );
    expect(screen.queryByText('Admin')).toBeNull();
  });
});
